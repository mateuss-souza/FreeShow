// Pure helpers for playback recordings (tested without a browser).

import type { PlaybackSyncEvent } from "../../../types/PlaybackSync"

/** YouTube video ID from a pasted link (watch, youtu.be, shorts, live, embed, music) or a bare ID */
export function parseYouTubeId(input: string): string {
    const text = (input || "").trim()
    if (/^[\w-]{11}$/.test(text)) return text
    try {
        const url = new URL(text.startsWith("http") ? text : "https://" + text)
        const host = url.hostname.replace(/^www\.|^m\.|^music\./, "")
        if (host === "youtu.be") return valid(url.pathname.slice(1, 12))
        if (host === "youtube.com" || host === "youtube-nocookie.com") {
            const v = url.searchParams.get("v")
            if (v) return valid(v)
            const match = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/)
            if (match) return match[1]
        }
    } catch {
        // not a link
    }
    return ""
}

const valid = (id: string) => (/^[\w-]{11}$/.test(id) ? id : "")

/** index of the event that should be showing at this video time, -1 before the first one */
export function eventIndexAt(events: PlaybackSyncEvent[], time: number): number {
    let found = -1
    for (let i = 0; i < events.length; i++) {
        if (events[i].t <= time) found = i
        else break
    }
    return found
}

/** recording from "from" onwards replaces what was recorded after that point and keeps what came before */
export function keepBefore(events: PlaybackSyncEvent[], from: number): PlaybackSyncEvent[] {
    return events.filter((e) => e.t < from - 0.05)
}

export function sortEvents(events: PlaybackSyncEvent[]): PlaybackSyncEvent[] {
    return [...events].sort((a, b) => a.t - b.t)
}

/** same slide state (used to skip repeated presses that change nothing) */
export function sameState(a: PlaybackSyncEvent | undefined, b: PlaybackSyncEvent | undefined) {
    if (!a || !b) return false
    if (a.clear || b.clear) return !!a.clear && !!b.clear
    return a.index === b.index && (a.line || 0) === (b.line || 0) && (a.layout || "") === (b.layout || "")
}

export function formatTime(seconds: number): string {
    const s = Math.max(0, seconds)
    const m = Math.floor(s / 60)
    const rest = s - m * 60
    return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`
}
