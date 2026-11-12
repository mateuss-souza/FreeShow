// Playback recordings: record the operator's slide changes against a YouTube video's clock, then let the
// slides follow the video. Times always come from the player, so pauses, buffering, ads and seeking never
// put the slides out of step.

import { get, writable } from "svelte/store"
import { uid } from "uid"
import type { PlaybackSync, PlaybackSyncEvent, PlaybackSyncMode } from "../../../types/PlaybackSync"
import type { OutSlide } from "../../../types/Show"
import { outputs, showsCache } from "../../stores"
import { clearSlide } from "../output/clear"
import { getActiveOutputs, setOutput } from "../helpers/output"
import { checkActionTrigger, updateOut } from "../helpers/showActions"
import { _show } from "../helpers/shows"
import { eventIndexAt, keepBefore, sameState, sortEvents } from "./syncMath"

export const DEFAULT_ANTICIPATE = 0.25

export interface SyncSession {
    showId: string
    syncId: string
    videoId: string
    mode: PlaybackSyncMode
}

/** the open recording, null when the player is closed */
export const syncSession = writable<SyncSession | null>(null)
/** video clock, for the UI */
export const syncClock = writable({ time: 0, duration: 0, playing: false })
/** events being recorded (shown live in the panel) */
export const recordingEvents = writable<PlaybackSyncEvent[]>([])

// STORED RECORDINGS

export function getSyncs(showId: string): { [key: string]: PlaybackSync } {
    return get(showsCache)[showId]?.playbackSyncs || {}
}

function saveSync(showId: string, sync: PlaybackSync) {
    const syncs = { ...getSyncs(showId), [sync.id]: { ...sync, updated: Date.now() } }
    _show(showId).set({ key: "playbackSyncs", value: syncs })
}

export function createSync(showId: string, name: string, url: string, videoId: string): string {
    const id = uid(8)
    saveSync(showId, { id, name, url, videoId, anticipate: DEFAULT_ANTICIPATE, events: [], updated: Date.now() })
    return id
}

export function updateSync(showId: string, syncId: string, change: Partial<PlaybackSync>) {
    const sync = getSyncs(showId)[syncId]
    if (!sync) return
    saveSync(showId, { ...sync, ...change })
}

export function deleteSync(showId: string, syncId: string) {
    const session = get(syncSession)
    if (session?.showId === showId && session.syncId === syncId) closeSession()
    const syncs = { ...getSyncs(showId) }
    delete syncs[syncId]
    _show(showId).set({ key: "playbackSyncs", value: syncs })
}

// PLAYER (registered by the floating player)

interface PlayerLike {
    playVideo: () => any
    pauseVideo: () => any
    seekTo: (seconds: number, allowSeekAhead: boolean) => any
}
let player: PlayerLike | null = null
export function registerPlayer(p: PlayerLike | null) {
    player = p
}
export const playerControl = {
    play: () => player?.playVideo(),
    pause: () => player?.pauseVideo(),
    seek: (seconds: number) => player?.seekTo(Math.max(0, seconds), true)
}

// the API's reported time only moves a few times per second: between updates it is extrapolated
let clockBase = { video: 0, at: 0, playing: false, reported: -1 }
export function videoTime(): number {
    return clockBase.playing ? clockBase.video + (performance.now() - clockBase.at) / 1000 : clockBase.video
}

/** called by the player about ten times per second */
export function onPlayerTime(reported: number, playing: boolean, duration: number) {
    const now = performance.now()
    if (reported !== clockBase.reported || playing !== clockBase.playing) {
        // a fresh value (or play/pause): restart the extrapolation from it
        clockBase = { video: reported, at: now, playing, reported }
    }
    syncClock.set({ time: videoTime(), duration, playing })
    tick()
}

// SESSION

export function openSession(showId: string, syncId: string) {
    const sync = getSyncs(showId)[syncId]
    if (!sync?.videoId) return
    const current = get(syncSession)
    if (current?.mode === "recording") stopRecording()
    clockBase = { video: 0, at: performance.now(), playing: false, reported: -1 }
    lastApplied = -2
    syncSession.set({ showId, syncId, videoId: sync.videoId, mode: "ready" })
}

export function closeSession() {
    if (get(syncSession)?.mode === "recording") stopRecording()
    playerControl.pause()
    syncSession.set(null)
}

function setMode(mode: PlaybackSyncMode) {
    syncSession.update((s) => (s ? { ...s, mode } : s))
}

// RECORDING

let recordingFrom = 0
let recordingLayout = ""

export function startRecording() {
    const session = get(syncSession)
    if (!session) return
    const sync = getSyncs(session.showId)[session.syncId]
    if (!sync) return

    // recording from here replaces what came after: start at 0 to record everything again
    recordingFrom = videoTime()
    const kept = keepBefore(sortEvents(sync.events || []), recordingFrom)
    recordingEvents.set(kept)
    lastOutputKey = outputKey(currentOutSlide())

    // what is on screen when recording starts is the first state
    const first = toEvent(currentOutSlide(), recordingFrom, session.showId)
    if (first) addRecorded(first)

    setMode("recording")
    playerControl.play()
}

export function stopRecording() {
    const session = get(syncSession)
    if (!session || session.mode !== "recording") return
    const events = sortEvents(get(recordingEvents))
    updateSync(session.showId, session.syncId, { events, layoutId: recordingLayout || getSyncs(session.showId)[session.syncId]?.layoutId })
    setMode("ready")
}

function addRecorded(event: PlaybackSyncEvent) {
    recordingEvents.update((list) => {
        if (sameState(list[list.length - 1], event)) return list
        return [...list, event]
    })
    if (event.layout) recordingLayout = event.layout
}

// FOLLOWING

let lastApplied = -2
let expectedKey = ""
let ignoreChangesUntil = 0

export function startFollowing() {
    if (!get(syncSession)) return
    lastApplied = -2
    setMode("following")
    playerControl.play()
}

/** back from manual: the slide for the current moment is shown again */
export function resumeFollowing() {
    lastApplied = -2
    setMode("following")
    tick()
}

export function stopFollowing() {
    setMode("ready")
}

function tick() {
    const session = get(syncSession)
    if (!session || session.mode !== "following") return
    const sync = getSyncs(session.showId)[session.syncId]
    if (!sync?.events?.length) return

    const events = sync.events
    const index = eventIndexAt(events, videoTime() + (sync.anticipate || 0))
    if (index === lastApplied) return
    lastApplied = index
    if (index < 0) return
    applyEvent(session.showId, events[index], sync.layoutId)
}

function applyEvent(showId: string, event: PlaybackSyncEvent, fallbackLayout?: string) {
    ignoreChangesUntil = performance.now() + 600
    if (event.clear) {
        expectedKey = ""
        clearSlide()
        return
    }
    const layout = event.layout || fallbackLayout || get(showsCache)[showId]?.settings?.activeLayout
    if (!layout) return
    const layoutRef = _show(showId).layouts([layout]).ref()[0] || []
    if (!layoutRef[event.index]) return

    expectedKey = outputKey({ id: showId, layout, index: event.index, line: event.line })
    checkActionTrigger(layoutRef[event.index]?.data, event.index)
    setOutput("slide", { id: showId, layout, index: event.index, line: event.line || 0 })
    updateOut(showId, event.index, layoutRef)
}

// WATCHING THE OUTPUT (recording, and noticing the operator taking over)

let lastOutputKey = ""

function currentOutSlide(all = get(outputs)): OutSlide | null {
    const outputId = getActiveOutputs(all, true, true, true)[0]
    return (outputId && all[outputId]?.out?.slide) || null
}

function outputKey(slide: Partial<OutSlide> | null): string {
    if (!slide?.id) return ""
    return [slide.id, slide.layout || "", slide.index ?? "", slide.line || 0].join("|")
}

function toEvent(slide: OutSlide | null, t: number, showId: string): PlaybackSyncEvent | null {
    if (!slide?.id) return { t, index: 0, clear: true }
    if (slide.id !== showId || slide.index === undefined) return null
    return { t, index: slide.index, layout: slide.layout, line: slide.line || 0 }
}

outputs.subscribe((all) => {
    const session = get(syncSession)
    if (!session) return
    const slide = currentOutSlide(all)
    const key = outputKey(slide)
    if (key === lastOutputKey) return
    lastOutputKey = key

    if (session.mode === "recording") {
        const event = toEvent(slide, videoTime(), session.showId)
        if (event) addRecorded(event)
        return
    }

    // someone changed the slide by hand while following: stop following until they resume
    if (session.mode === "following" && performance.now() > ignoreChangesUntil && key !== expectedKey) {
        setMode("manual")
    }
})
