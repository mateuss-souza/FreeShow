import { describe, expect, it } from "vitest"
import { eventIndexAt, formatTime, keepBefore, parseYouTubeId, sameState, sortEvents } from "./syncMath"

describe("parseYouTubeId", () => {
    it("reads the usual link shapes", () => {
        expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toBe("dQw4w9WgXcQ")
        expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ")
        expect(parseYouTubeId("youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
        expect(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x")).toBe("dQw4w9WgXcQ")
        expect(parseYouTubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
        expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    })
    it("rejects other text", () => {
        expect(parseYouTubeId("https://vimeo.com/123")).toBe("")
        expect(parseYouTubeId("hello")).toBe("")
        expect(parseYouTubeId("")).toBe("")
    })
})

describe("events", () => {
    const events = [
        { t: 2, index: 0 },
        { t: 10, index: 1 },
        { t: 20, index: 2 },
        { t: 30, index: 1 },
        { t: 40, index: 0, clear: true }
    ]
    it("finds the slide for a time, including going back", () => {
        expect(eventIndexAt(events, 0)).toBe(-1)
        expect(eventIndexAt(events, 2)).toBe(0)
        expect(eventIndexAt(events, 25)).toBe(2)
        expect(eventIndexAt(events, 31)).toBe(3)
        expect(eventIndexAt(events, 12)).toBe(1)
        expect(eventIndexAt(events, 999)).toBe(4)
    })
    it("re-recording from a point keeps the start", () => {
        expect(keepBefore(events, 20).map((e) => e.t)).toEqual([2, 10])
        expect(keepBefore(events, 0)).toEqual([])
    })
    it("sorts and compares", () => {
        expect(
            sortEvents([
                { t: 5, index: 1 },
                { t: 1, index: 0 }
            ]).map((e) => e.t)
        ).toEqual([1, 5])
        expect(sameState({ t: 1, index: 2 }, { t: 9, index: 2 })).toBe(true)
        expect(sameState({ t: 1, index: 2, line: 1 }, { t: 9, index: 2 })).toBe(false)
        expect(sameState({ t: 1, index: 0, clear: true }, { t: 9, index: 3, clear: true })).toBe(true)
    })
    it("formats times", () => {
        expect(formatTime(0)).toBe("0:00.0")
        expect(formatTime(75.25)).toBe("1:15.3")
    })
})
