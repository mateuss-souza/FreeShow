// Edge blend groups: several outputs, one per projector, that together show one wide image.
//
// Every member output carries the whole group (BlendGroupMember), because each output window only
// receives its own output's data. Changes are always written to all members at once.
// The group also owns a style whose resolution is the full blended canvas, so slides are laid out
// for the wide screen; members switch to it, and get their previous style back when the group is removed.

import { get } from "svelte/store"
import { uid } from "uid"
import type { BlendGroupConfig, BlendGroupMember, BlendPattern, BlendProjectorAdjust, Output, Outputs } from "../../../../types/Output"
import { outputs, styles } from "../../../stores"
import { clone } from "../../helpers/array"
import { canvasSize, DEFAULT_BLEND_GROUP, normalizeBlendGroup } from "./blendMath"

export function blendGroupOf(output: Output | undefined | null): BlendGroupMember | null {
    const group = output?.blendGroup
    if (!group?.groupId || !Array.isArray(group.members)) return null
    return group
}

/** outputs that can join a group: enabled, on a real screen, not a stage display */
export function blendCandidates(all: Outputs = get(outputs)) {
    return Object.entries(all)
        .filter(([, o]) => !o.stageOutput && !o.invisible)
        .map(([id, o]) => ({ id, name: o.name, x: o.bounds?.x ?? 0, inGroup: !!blendGroupOf(o) }))
        .sort((a, b) => a.x - b.x)
}

/** members are ordered left to right by where their screens are */
export function createBlendGroup(memberIds: string[]): string | null {
    const all = get(outputs)
    const members = memberIds.filter((id) => all[id]).sort((a, b) => (all[a].bounds?.x ?? 0) - (all[b].bounds?.x ?? 0))
    if (members.length < 2) return null

    const first = all[members[0]]
    const config = normalizeBlendGroup({
        ...DEFAULT_BLEND_GROUP,
        projectors: members.length,
        projectorWidth: first.bounds?.width || DEFAULT_BLEND_GROUP.projectorWidth,
        projectorHeight: first.bounds?.height || DEFAULT_BLEND_GROUP.projectorHeight,
        // a starting guess: 15% overlap, tuned on site
        overlaps: members.slice(1).map(() => Math.round((first.bounds?.width || 1920) * 0.15)),
        adjust: members.map(() => ({}))
    })

    const groupId = uid()
    const styleId = createCanvasStyle(first.style, config)

    outputs.update((a) => {
        members.forEach((id, index) => {
            if (!a[id]) return
            const group: BlendGroupMember = { groupId, index, members, config: clone(config), pattern: "none", styleId, previousStyle: a[id].style }
            a[id].blendGroup = group
            a[id].style = styleId
            // the old single-output fade would apply on top of the real blend
            delete a[id].blending
        })
        return a
    })

    return groupId
}

export function removeBlendGroup(groupId: string) {
    let styleId = ""
    outputs.update((a) => {
        Object.values(a).forEach((output) => {
            const group = blendGroupOf(output)
            if (group?.groupId !== groupId) return
            styleId = group.styleId || styleId
            if (output.style === group.styleId) {
                if (group.previousStyle) output.style = group.previousStyle
                else delete output.style
            }
            delete output.blendGroup
        })
        return a
    })

    // the group's own style goes with it, unless something else started using it
    if (!styleId) return
    const stillUsed = Object.values(get(outputs)).some((o) => o.style === styleId)
    if (stillUsed) return
    styles.update((a) => {
        delete a[styleId]
        return a
    })
}

export function setBlendConfig(groupId: string, change: Partial<BlendGroupConfig>) {
    updateGroup(groupId, (group) => {
        group.config = normalizeBlendGroup({ ...group.config, ...change })
    })
}

export function setBlendOverlap(groupId: string, seam: number, value: number) {
    updateGroup(groupId, (group) => {
        const overlaps = [...group.config.overlaps]
        overlaps[seam] = value
        group.config = normalizeBlendGroup({ ...group.config, overlaps })
    })
}

export function setBlendAdjust(groupId: string, index: number, change: Partial<BlendProjectorAdjust>) {
    updateGroup(groupId, (group) => {
        const adjust = [...(group.config.adjust || [])]
        adjust[index] = { ...(adjust[index] || {}), ...change }
        group.config = normalizeBlendGroup({ ...group.config, adjust })
    })
}

export function setBlendPattern(groupId: string, pattern: BlendPattern) {
    updateGroup(groupId, (group) => {
        group.pattern = pattern
    })
}

// writes the same change to every member, then keeps the group's style at the canvas size
function updateGroup(groupId: string, change: (group: BlendGroupMember) => void) {
    let config: BlendGroupConfig | null = null
    let styleId = ""
    outputs.update((a) => {
        Object.values(a).forEach((output) => {
            const group = blendGroupOf(output)
            if (group?.groupId !== groupId) return
            change(group)
            config = group.config
            styleId = group.styleId || ""
        })
        return a
    })
    if (config && styleId) fitCanvasStyle(styleId, config)
}

function createCanvasStyle(baseStyleId: string | undefined, config: BlendGroupConfig): string {
    const id = uid()
    const size = canvasSize(config)
    styles.update((a) => {
        const base = baseStyleId && a[baseStyleId] ? clone(a[baseStyleId]) : { name: "" }
        a[id] = { ...base, name: `Edge blend ${size.width}×${size.height}`, aspectRatio: { width: size.width, height: size.height } }
        return a
    })
    return id
}

function fitCanvasStyle(styleId: string, config: BlendGroupConfig) {
    const size = canvasSize(config)
    const current = get(styles)[styleId]
    if (!current) return
    const ratio = current.aspectRatio
    if (ratio?.width === size.width && ratio?.height === size.height) return
    styles.update((a) => {
        if (!a[styleId]) return a
        a[styleId].aspectRatio = { ...(a[styleId].aspectRatio || {}), width: size.width, height: size.height, outputResolutionAsRatio: false }
        a[styleId].name = `Edge blend ${size.width}×${size.height}`
        return a
    })
}
