import type { Cropping, Resolution } from "./Settings"
import type { OutBackground, OutScene, OutSlide, OutTransition } from "./Show"

export interface Outputs {
    [key: string]: Output
}

export interface Output {
    id?: string
    hideFromPreview?: boolean
    stageOutput?: string
    enabled: boolean
    active: boolean
    name: string
    color: string
    bounds: { x: number; y: number; width: number; height: number }
    boundsLocked?: boolean
    cropping?: Cropping
    blending?: { left: number; right: number; rotate: number; opacity: number; centered: boolean; offset: number }
    /** one projector of several overlapping into one wide, edge-blended image */
    blendGroup?: BlendGroupMember
    screen: string | null
    alwaysOnTop?: boolean
    transparent?: boolean
    ndi?: boolean
    ndiData?: any
    omt?: boolean
    omtData?: any
    blackmagic?: boolean
    blackmagicData?: any
    webrtc?: boolean
    webrtcData?: { url?: string; token?: string; streaming?: boolean; startedAt?: number; fps?: string | number; bitrate?: string | number }
    rtmp?: boolean
    rtmpData?: RtmpData
    forcedResolution?: Resolution
    invisible?: boolean
    taskbar?: boolean
    style?: string
    show?: any
    out?: OutData
}

export interface SyncedOutputs {
    [id: string]: string
}

// RTMP
export interface RtmpDestination {
    id: string
    url: string
    key: string
    enabled: boolean
    /** url is a file path: the encoded stream is recorded there instead of being sent */
    file?: boolean
}
export interface RtmpData {
    streaming?: boolean
    startedAt?: number
    fps?: string | number
    bitrate?: string | number
    rateControl?: "cbr" | "vbr"
    encoder?: string
    destinations?: RtmpDestination[]
    url?: string // deprecated, only used in v1.6.4
    key?: string // deprecated, only used in v1.6.4
}
export type RtmpDestinationState = "idle" | "connecting" | "live" | "reconnecting" | "error"
export interface RtmpStatus {
    /**
     * `restarts`/`lastIssue` persist for the whole stream rather than clearing on recovery: a
     * destination that keeps dropping and reconnecting reads as healthy from `state` alone.
     */
    [destinationId: string]: { state: RtmpDestinationState; error?: string; restarts?: number; lastIssue?: string }
}

export interface OutData {
    refresh?: number
    background?: null | OutBackground
    slide?: null | OutSlide
    effects?: string[]
    overlays?: string[]
    transition?: null | OutTransition
    scene?: null | OutScene
}

export interface Animation {
    actions: AnimationAction[]
    repeat?: boolean
    easing?: string
}

export interface AnimationAction {
    type: "change" | "set" | "wait"
    id?: "background" | "text" | "item"
    key?: string
    extension?: string
    value?: number
    duration: number
}

// EDGE BLEND GROUPS

export type BlendCurve = "linear" | "smoothstep" | "cosine"
export type BlendPattern = "none" | "grid" | "white" | "gray" | "black" | "ramp" | "guides"

export interface BlendProjectorAdjust {
    /** extra horizontal shift of this projector's slice in canvas px (fine alignment) */
    offsetX?: number
    /** extra vertical shift in canvas px */
    offsetY?: number
    /** light multiplier to match a brighter projector to a dimmer one (0.3..1) */
    brightness?: number
}

export interface BlendGroupConfig {
    /** number of projectors side by side (2..8) */
    projectors: number
    /** pixel size of one projector output */
    projectorWidth: number
    projectorHeight: number
    /** overlap in px between projector i and i+1 (length projectors - 1) */
    overlaps: number[]
    /** projector gamma, usually 2.2 */
    gamma: number
    curve: BlendCurve
    /** black-level lift (signal 0..0.25) outside the overlaps, so dark scenes match the brighter overlap */
    blackLevel: number
    /** px over which the black lift fades in from the overlap edge */
    blackFeather: number
    adjust?: BlendProjectorAdjust[]
}

/** stored on every output in a group, so each output window has what it needs on its own */
export interface BlendGroupMember {
    groupId: string
    /** this output's position, left to right */
    index: number
    /** output ids, left to right */
    members: string[]
    config: BlendGroupConfig
    /** calibration pattern shown instead of content */
    pattern?: BlendPattern
    /** the style the group made for its wide resolution, and the style each output had before */
    styleId?: string
    previousStyle?: string
}
