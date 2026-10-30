import { describe, expect, it } from "vitest"
import { BLEND_CURVES, blackLift, blendPixel, canvasSize, getSlices, normalizeBlendGroup, ramp, signalMask, simulateScreenLight } from "./blendMath"

const three = normalizeBlendGroup({ projectors: 3, projectorWidth: 1920, projectorHeight: 1080, overlaps: [300, 300] })

describe("geometry", () => {
    it("removes each overlap once from the canvas width", () => {
        expect(canvasSize(three)).toEqual({ width: 3 * 1920 - 600, height: 1080 })
    })

    it("places slices so neighbours share exactly the overlap", () => {
        const [a, b, c] = getSlices(three)
        expect(a.canvasX).toBe(0)
        expect(b.canvasX).toBe(1920 - 300)
        expect(c.canvasX).toBe(2 * 1920 - 600)
        expect(c.canvasX + c.width).toBe(canvasSize(three).width)
        expect([a.leftOverlap, a.rightOverlap, b.leftOverlap, b.rightOverlap, c.leftOverlap, c.rightOverlap]).toEqual([0, 300, 300, 300, 300, 0])
    })

    it("sanitizes bad input", () => {
        const cfg = normalizeBlendGroup({ projectors: 12, overlaps: [5000], gamma: 0, curve: "nope" as any })
        expect(cfg.projectors).toBe(8)
        expect(cfg.overlaps).toHaveLength(7)
        expect(Math.max(...cfg.overlaps)).toBeLessThanOrEqual(cfg.projectorWidth / 2)
        expect(cfg.curve).toBe("smoothstep")
        expect(cfg.gamma).toBe(2.2)
    })
})

describe("ramps", () => {
    it.each(BLEND_CURVES)("%s: facing ramps add up to one", (curve) => {
        for (let t = 0; t <= 1; t += 0.05) expect(ramp(t, curve) + ramp(1 - t, curve)).toBeCloseTo(1, 10)
    })
})

describe("seams", () => {
    it.each(BLEND_CURVES)("%s: screen light is even across the whole canvas", (curve) => {
        const cfg = normalizeBlendGroup({ ...three, curve })
        const { width } = canvasSize(cfg)
        for (const signal of [1, 0.5, 0.2]) {
            const expected = Math.pow(signal, cfg.gamma)
            for (let x = 0; x < width; x += 7) expect(simulateScreenLight(cfg, x, signal)).toBeCloseTo(expected, 2)
        }
    })

    it("a plain linear fade in signal space would leave a dark band (why gamma matters)", () => {
        // what a naive mask does at the middle of a seam
        const naive = Math.pow(0.5, 2.2) * 2
        expect(naive).toBeLessThan(0.5)
        // ours: the middle of the seam gives the same light as a single projector
        const middle = 1920 - 150
        expect(simulateScreenLight(three, middle, 1)).toBeCloseTo(1, 3)
    })

    it("fades to true black at the slice edge inside an overlap", () => {
        const [, b] = getSlices(three)
        expect(signalMask(b, 0, three)).toBe(0)
        expect(signalMask(b, 960, three)).toBe(1)
    })
})

describe("black level", () => {
    it("lifts only outside the overlaps, with a soft edge", () => {
        const cfg = normalizeBlendGroup({ ...three, blackLevel: 0.05, blackFeather: 40 })
        const [, b] = getSlices(cfg)
        expect(blackLift(b, 100, cfg)).toBe(0) // in the left overlap
        expect(blackLift(b, 310, cfg)).toBeGreaterThan(0) // just outside: partly lifted
        expect(blackLift(b, 310, cfg)).toBeLessThan(0.05)
        expect(blackLift(b, 960, cfg)).toBeCloseTo(0.05, 10) // centre: fully lifted
    })

    it("evens out black when projectors leak light", () => {
        const leak = 0.004 // ~250:1 contrast
        const cfg = normalizeBlendGroup({ ...three, blackLevel: Math.pow(leak, 1 / 2.2), blackFeather: 0 })
        const overlap = simulateScreenLight(cfg, 1920 - 150, 0, leak)
        const centre = simulateScreenLight(cfg, 960, 0, leak)
        expect(centre).toBeCloseTo(overlap, 3)
    })

    it("leaves midtones alone outside the overlaps", () => {
        const cfg = normalizeBlendGroup({ ...three, blackLevel: 0.1, blackFeather: 0 })
        const [, b] = getSlices(cfg)
        expect(blendPixel(0.5, b, 960, cfg)).toBe(0.5)
        expect(blendPixel(0, b, 960, cfg)).toBeCloseTo(0.1, 10)
    })
})
