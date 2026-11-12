import { get } from "svelte/store"
import { beforeEach, describe, expect, it, vi } from "vitest"

// the engine with FreeShow's stores and output helpers replaced by small fakes
const fake = vi.hoisted(() => {
    const { writable } = require("svelte/store")
    return { shown: [] as any[], cleared: 0, now: 0, outputs: writable({}), showsCache: writable({}) }
})

vi.mock("../../stores", () => ({ outputs: fake.outputs, showsCache: fake.showsCache }))
vi.mock("../output/clear", () => ({ clearSlide: () => fake.cleared++ }))
vi.mock("../helpers/showActions", () => ({ checkActionTrigger: () => {}, updateOut: () => {} }))
vi.mock("../helpers/output", () => ({
    getActiveOutputs: (all: any) => Object.keys(all),
    setOutput: (_type: string, slide: any) => {
        fake.shown.push(slide)
        fake.outputs.set({ main: { out: { slide } } })
    }
}))
vi.mock("../helpers/shows", () => ({
    _show: (id: string) => ({
        set: ({ key, value }: any) => fake.showsCache.update((a: any) => ({ ...a, [id]: { ...a[id], [key]: value } })),
        layouts: () => ({ ref: () => [Array.from({ length: 6 }, (_, i) => ({ id: "s" + i, data: {} }))] })
    })
}))

import * as stores from "../../stores"
import * as engine from "./playbackSync"

const SHOW = "show1"
const operator = (index: number) => (stores as any).outputs.set({ main: { out: { slide: { id: SHOW, layout: "L", index, line: 0 } } } })
const playerAt = (t: number) => {
    fake.now += 1000
    engine.onPlayerTime(t, false, 200)
}

beforeEach(() => {
    vi.spyOn(performance, "now").mockImplementation(() => fake.now)
    fake.shown = []
    fake.cleared = 0
    ;(stores as any).outputs.set({})
    ;(stores as any).showsCache.set({ [SHOW]: { name: "Rio de Graça", settings: { activeLayout: "L" }, slides: {} } })
    engine.closeSession()
})

describe("playback recording", () => {
    it("records the operator's changes at the video's time and saves them", () => {
        const id = engine.createSync(SHOW, "Ao vivo", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ")
        engine.openSession(SHOW, id)
        playerAt(0)
        engine.startRecording()
        playerAt(5)
        operator(0)
        playerAt(12.5)
        operator(1)
        playerAt(12.6)
        operator(1) // same slide again: not a change
        playerAt(20)
        operator(2)
        engine.stopRecording()
        const saved = engine.getSyncs(SHOW)[id]
        expect(saved.events.map((e) => [e.t, e.index, !!e.clear])).toEqual([
            [0, 0, true], // nothing on screen when recording started
            [5, 0, false],
            [12.5, 1, false],
            [20, 2, false]
        ])
        expect(saved.layoutId).toBe("L")
    })

    it("re-recording from the middle keeps what came before", () => {
        const id = engine.createSync(SHOW, "v", "", "dQw4w9WgXcQ")
        engine.updateSync(SHOW, id, {
            events: [
                { t: 5, index: 0 },
                { t: 10, index: 1 },
                { t: 20, index: 2 },
                { t: 30, index: 3 }
            ]
        })
        engine.openSession(SHOW, id)
        playerAt(15)
        operator(1)
        engine.startRecording()
        playerAt(25)
        operator(4)
        engine.stopRecording()
        expect(engine.getSyncs(SHOW)[id].events.map((e) => [e.t, e.index])).toEqual([
            [5, 0],
            [10, 1],
            [15, 1],
            [25, 4]
        ])
    })
})

describe("following the video", () => {
    async function following(events: any[], anticipate = 0) {
        const id = engine.createSync(SHOW, "v", "", "dQw4w9WgXcQ")
        engine.updateSync(SHOW, id, { events, anticipate, layoutId: "L" })
        engine.openSession(SHOW, id)
        engine.startFollowing()
        return id
    }
    const flush = () => new Promise((r) => setTimeout(r, 0))

    it("shows each slide at its time, early by the anticipation, and goes back on seek", async () => {
        await following(
            [
                { t: 5, index: 0 },
                { t: 10, index: 1 },
                { t: 20, index: 2 }
            ],
            0.25
        )
        playerAt(2)
        expect(fake.shown).toEqual([])
        playerAt(4.8) // 4.8 + 0.25 >= 5
        await flush()
        playerAt(9.5)
        playerAt(9.8)
        await flush()
        expect(fake.shown.map((s) => s.index)).toEqual([0, 1])
        playerAt(21)
        await flush()
        playerAt(6) // seek back
        await flush()
        expect(fake.shown.map((s) => s.index)).toEqual([0, 1, 2, 0])
        expect(get(engine.syncSession)?.mode).toBe("following")
    })

    it("stops following when the operator changes the slide, and resumes on request", async () => {
        await following([
            { t: 5, index: 0 },
            { t: 10, index: 1 },
            { t: 20, index: 2 }
        ])
        playerAt(6)
        await flush()
        fake.now += 2000 // after the engine's own change has settled
        operator(4)
        expect(get(engine.syncSession)?.mode).toBe("manual")
        playerAt(12) // video keeps going: no slide change while manual
        await flush()
        expect(fake.shown.map((s) => s.index)).toEqual([0])
        engine.resumeFollowing()
        playerAt(12.1)
        await flush()
        expect(fake.shown.map((s) => s.index)).toEqual([0, 1])
        expect(get(engine.syncSession)?.mode).toBe("following")
    })

    it("a recorded clear clears the screen", async () => {
        await following([
            { t: 5, index: 0 },
            { t: 9, index: 0, clear: true }
        ])
        playerAt(10)
        await flush()
        expect(fake.cleared).toBe(1)
    })
})
