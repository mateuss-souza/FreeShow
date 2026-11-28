// Edge blending for several projectors that overlap into one wide image.
//
// One wide "canvas" is rendered once, and each projector shows a slice of it. Neighbouring slices
// share the overlap zone, so those pixels are lit by two projectors. Each projector fades its edge
// so the *light* of the two adds up to the light of a single projector.
//
// Projectors are not linear: emitted light ≈ signal^gamma (≈2.2). A linear fade in signal space
// therefore leaves a dark band in the middle of the seam (0.5^2.2 + 0.5^2.2 ≈ 0.44). We fade in
// light space and convert back: mask = weight^(1/gamma).
//
// This file is the reference implementation. blendShader.ts mirrors the same formulas in GLSL;
// keep the two in step (blendMath.test.ts covers both through the shared constants).

import type { BlendCurve, BlendGroupConfig, BlendPattern } from "../../../../types/Output"

export type { BlendCurve, BlendGroupConfig, BlendPattern, BlendProjectorAdjust, BlendGroupMember } from "../../../../types/Output"

export const BLEND_CURVES: BlendCurve[] = ["linear", "smoothstep", "cosine"]

export const DEFAULT_BLEND_GROUP: BlendGroupConfig = {
    projectors: 3,
    projectorWidth: 1920,
    projectorHeight: 1080,
    overlaps: [300, 300],
    gamma: 2.2,
    curve: "smoothstep",
    blackLevel: 0,
    blackFeather: 40,
    adjust: []
}

export interface BlendSlice {
    index: number
    /** where this projector's slice starts in canvas px */
    canvasX: number
    canvasY: number
    width: number
    height: number
    /** overlap with the neighbour on each side (0 at the outer edges) */
    leftOverlap: number
    rightOverlap: number
    brightness: number
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** sanitizes user input so the geometry is always drawable */
export function normalizeBlendGroup(input: Partial<BlendGroupConfig> | undefined | null): BlendGroupConfig {
    const cfg = { ...DEFAULT_BLEND_GROUP, ...(input || {}) }
    const projectors = clamp(Math.round(Number(cfg.projectors) || 2), 2, 8)
    const projectorWidth = Math.max(1, Math.round(Number(cfg.projectorWidth) || DEFAULT_BLEND_GROUP.projectorWidth))
    const projectorHeight = Math.max(1, Math.round(Number(cfg.projectorHeight) || DEFAULT_BLEND_GROUP.projectorHeight))

    // an overlap wider than half a projector would let three projectors cover one pixel
    const maxOverlap = Math.floor(projectorWidth / 2)
    const overlaps: number[] = []
    for (let i = 0; i < projectors - 1; i++) {
        const raw = Number(cfg.overlaps?.[i] ?? cfg.overlaps?.[cfg.overlaps.length - 1] ?? 0)
        overlaps.push(clamp(Math.round(raw) || 0, 0, maxOverlap))
    }

    // the display is at least the used area
    const displayWidth = Math.max(projectorWidth, Math.round(Number(cfg.displayWidth) || projectorWidth))
    const displayHeight = Math.max(projectorHeight, Math.round(Number(cfg.displayHeight) || projectorHeight))

    return {
        projectors,
        projectorWidth,
        projectorHeight,
        displayWidth,
        displayHeight,
        overlaps,
        gamma: clamp(Number(cfg.gamma) || 2.2, 1, 3),
        curve: BLEND_CURVES.includes(cfg.curve) ? cfg.curve : "smoothstep",
        blackLevel: clamp(Number(cfg.blackLevel) || 0, 0, 0.25),
        blackFeather: clamp(Math.round(Number(cfg.blackFeather) || 0), 0, 400),
        adjust: Array.isArray(cfg.adjust) ? cfg.adjust : []
    }
}

/** the size of the one image that gets rendered and spread over all projectors */
export function canvasSize(cfg: BlendGroupConfig) {
    const totalOverlap = cfg.overlaps.reduce((sum, o) => sum + o, 0)
    return { width: cfg.projectors * cfg.projectorWidth - totalOverlap, height: cfg.projectorHeight }
}

export function getSlices(cfg: BlendGroupConfig): BlendSlice[] {
    const slices: BlendSlice[] = []
    let x = 0
    for (let i = 0; i < cfg.projectors; i++) {
        const adjust = cfg.adjust?.[i] || {}
        slices.push({
            index: i,
            canvasX: x + (Number(adjust.offsetX) || 0),
            canvasY: Number(adjust.offsetY) || 0,
            width: cfg.projectorWidth,
            height: cfg.projectorHeight,
            leftOverlap: i > 0 ? cfg.overlaps[i - 1] : 0,
            rightOverlap: i < cfg.projectors - 1 ? cfg.overlaps[i] : 0,
            brightness: clamp(adjust.brightness ?? 1, 0.3, 1)
        })
        x += cfg.projectorWidth - (cfg.overlaps[i] || 0)
    }
    return slices
}

/** 0..1 -> 0..1 ramp with ramp(t) + ramp(1 - t) = 1, so two facing ramps always add to 1 */
export function ramp(t: number, curve: BlendCurve): number {
    const x = clamp(t, 0, 1)
    if (curve === "linear") return x
    if (curve === "cosine") return 0.5 - 0.5 * Math.cos(Math.PI * x)
    return x * x * (3 - 2 * x) // smoothstep
}

/** share of light (0..1) this projector contributes at local pixel x, before gamma */
export function lightWeight(slice: BlendSlice, x: number, curve: BlendCurve): number {
    let weight = 1
    if (slice.leftOverlap > 0 && x < slice.leftOverlap) weight *= ramp(x / slice.leftOverlap, curve)
    const fromRight = slice.width - x
    if (slice.rightOverlap > 0 && fromRight < slice.rightOverlap) weight *= ramp(fromRight / slice.rightOverlap, curve)
    return weight
}

/** signal multiplier for local pixel x: what the output window multiplies each colour channel by */
export function signalMask(slice: BlendSlice, x: number, cfg: BlendGroupConfig): number {
    const light = lightWeight(slice, x, cfg.curve) * slice.brightness
    return Math.pow(light, 1 / cfg.gamma)
}

/**
 * black-level lift at local pixel x (signal 0..blackLevel).
 * Inside an overlap two projectors' black glows add up; elsewhere we add a little light so it matches.
 */
export function blackLift(slice: BlendSlice, x: number, cfg: BlendGroupConfig): number {
    if (!cfg.blackLevel) return 0
    const inLeft = slice.leftOverlap > 0 ? x - slice.leftOverlap : Infinity
    const inRight = slice.rightOverlap > 0 ? slice.width - slice.rightOverlap - x : Infinity
    const distance = Math.min(inLeft, inRight) // px from the nearest overlap edge, negative inside one
    if (distance <= 0) return 0
    const feather = cfg.blackFeather > 0 ? clamp(distance / cfg.blackFeather, 0, 1) : 1
    return cfg.blackLevel * ramp(feather, "smoothstep")
}

/**
 * final signal for one channel: content faded by the mask, never darker than the black lift.
 * A max (CSS "lighten") only raises tones that are darker than the lift, so midtones outside the
 * overlaps stay as they are; adding the lift on top would brighten them too.
 */
export function blendPixel(signal: number, slice: BlendSlice, x: number, cfg: BlendGroupConfig): number {
    const masked = clamp(signal, 0, 1) * signalMask(slice, x, cfg)
    return Math.max(masked, blackLift(slice, x, cfg))
}

/**
 * Light reaching the screen at canvas pixel cx when every projector shows `signal` there.
 * Used to check that seams come out even (tests, and the calibration preview).
 */
export function simulateScreenLight(cfg: BlendGroupConfig, cx: number, signal: number, projectorBlack = 0): number {
    let light = 0
    for (const slice of getSlices(cfg)) {
        const x = cx - slice.canvasX
        if (x < 0 || x >= slice.width) continue
        const out = blendPixel(signal, slice, x + 0.5, cfg)
        // a real projector never reaches zero light
        light += projectorBlack + (1 - projectorBlack) * Math.pow(out, cfg.gamma)
    }
    return light
}

/**
 * one row of the masks for a projector, left to right, one value (0..1) per projector pixel.
 * `mask` multiplies the content; `lift` is the black-level lift, drawn as a grey of that value with
 * the "lighten" blend mode over it (max per channel, which is blendPixel's formula).
 */
export function maskRows(cfg: BlendGroupConfig, index: number) {
    const slice = getSlices(cfg)[index]
    const mask = new Float32Array(slice.width)
    const lift = new Float32Array(slice.width)
    for (let x = 0; x < slice.width; x++) {
        mask[x] = signalMask(slice, x + 0.5, cfg)
        lift[x] = blackLift(slice, x + 0.5, cfg)
    }
    return { mask, lift, slice }
}

// CALIBRATION PATTERNS

/** numeric ids shared with the shader */
export const PATTERN_IDS: Record<BlendPattern, number> = { none: 0, grid: 1, white: 2, gray: 3, black: 4, ramp: 5, guides: 6 }
export const CURVE_IDS: Record<BlendCurve, number> = { linear: 0, smoothstep: 1, cosine: 2 }

/** where a projector's used area sits in its window, as fractions of the window (all of it unless an area is set) */
export function usedArea(cfg: BlendGroupConfig, index: number) {
    const displayWidth = cfg.displayWidth || cfg.projectorWidth
    const displayHeight = cfg.displayHeight || cfg.projectorHeight
    const adjust = cfg.adjust?.[index] || {}
    const x = clamp(Number(adjust.areaX) || 0, 0, displayWidth - cfg.projectorWidth)
    const y = clamp(Number(adjust.areaY) || 0, 0, displayHeight - cfg.projectorHeight)
    return { left: x / displayWidth, top: y / displayHeight, width: cfg.projectorWidth / displayWidth, height: cfg.projectorHeight / displayHeight }
}

// CORNER PIN (keystone fine-tuning per projector)

export const CORNERS = ["tl", "tr", "bl", "br"] as const
export type CornerId = (typeof CORNERS)[number]

/** where each corner of a w×h area ends up; offsets use ProPresenter's sign: positive moves away from the center */
export function cornerPoints(w: number, h: number, corners: { [K in CornerId]?: [number, number] } | undefined) {
    const get = (id: CornerId) => {
        const v = corners?.[id] || [0, 0]
        return [Number(v[0]) || 0, Number(v[1]) || 0]
    }
    const [tlx, tly] = get("tl")
    const [trx, try_] = get("tr")
    const [blx, bly] = get("bl")
    const [brx, bry] = get("br")
    return {
        tl: [-tlx, -tly],
        tr: [w + trx, -try_],
        bl: [-blx, h + bly],
        br: [w + brx, h + bry]
    } as { [K in CornerId]: [number, number] }
}

export function hasCornerPin(corners: { [K in CornerId]?: [number, number] } | undefined) {
    return CORNERS.some((id) => (Number(corners?.[id]?.[0]) || 0) !== 0 || (Number(corners?.[id]?.[1]) || 0) !== 0)
}

/** 3x3 projective transform taking the w×h rectangle to the four corner points (row-major, h33 = 1) */
export function cornerPinHomography(w: number, h: number, corners: { [K in CornerId]?: [number, number] } | undefined): number[] | null {
    if (!w || !h || !hasCornerPin(corners)) return null
    const p = cornerPoints(w, h, corners)
    const src: [number, number][] = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h]
    ]
    const dst = [p.tl, p.tr, p.bl, p.br]
    // solve the 8 unknowns of the homography
    const A: number[][] = []
    const b: number[] = []
    for (let i = 0; i < 4; i++) {
        const [x, y] = src[i]
        const [u, v] = dst[i]
        A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
        b.push(u)
        A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
        b.push(v)
    }
    const s = solve(A, b)
    if (!s) return null
    return [s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], 1]
}

/** CSS matrix3d for an element at the area's top left with transform-origin 0 0 */
export function cornerPinCss(w: number, h: number, corners: { [K in CornerId]?: [number, number] } | undefined): string {
    const m = cornerPinHomography(w, h, corners)
    if (!m) return ""
    const [a, b, c, d, e, f, g, hh, i] = m
    // column-major 4x4, z untouched
    const values = [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, i]
    return `matrix3d(${values.map((v) => +v.toPrecision(15)).join(",")})`
}

export function applyHomography(m: number[], x: number, y: number): [number, number] {
    const w = m[6] * x + m[7] * y + m[8]
    return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

function solve(A: number[][], b: number[]): number[] | null {
    const n = b.length
    const M = A.map((row, i) => [...row, b[i]])
    for (let col = 0; col < n; col++) {
        let pivot = col
        for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
        if (Math.abs(M[pivot][col]) < 1e-12) return null
        ;[M[col], M[pivot]] = [M[pivot], M[col]]
        for (let r = 0; r < n; r++) {
            if (r === col) continue
            const factor = M[r][col] / M[col][col]
            for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k]
        }
    }
    return M.map((row, i) => row[n] / row[i])
}
