// Slides that follow a playback (a YouTube video used as the band's audio).
// The operator records the slide changes once, against the video's own clock, then plays it back.

export interface PlaybackSyncEvent {
    /** video time in seconds */
    t: number
    /** layout slide index; ignored when "clear" */
    index: number
    layout?: string
    line?: number
    /** the operator cleared the slide here */
    clear?: boolean
}

export interface PlaybackSync {
    id: string
    name: string
    /** the link as the operator pasted it */
    url: string
    videoId: string
    /** layout used when it was recorded */
    layoutId?: string
    /** seconds the slides change before the recorded time (the operator reacts a little late) */
    anticipate: number
    events: PlaybackSyncEvent[]
    updated: number
}

export type PlaybackSyncMode = "ready" | "recording" | "following" | "manual"
