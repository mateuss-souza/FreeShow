// "Listen": live church audio to phones in the room (assistive listening, interpretation).

export type ListenSourceType = "none" | "device" | "loopback"

export interface ListenChannelConfig {
    id: string
    name: string
    source: ListenSourceType
    /** audio input device (source "device") */
    deviceId?: string
    deviceLabel?: string
    stereo?: boolean
}

export interface ListenConfig {
    enabled: boolean
    /** web page + signaling (TCP) */
    port: number
    /** WebRTC media for all listeners (UDP and TCP) */
    mediaPort: number
    maxListeners: number
    channels: ListenChannelConfig[]
    /** LAN address to put in the QR code, if the automatic choice is wrong */
    preferredAddress?: string
    /** injects a click every 2 s and shows the measured delay on phones */
    testMode?: boolean
    /** shown at the top of the phone page */
    title?: string
}

export const DEFAULT_LISTEN_CONFIG: ListenConfig = {
    enabled: false,
    port: 5514,
    mediaPort: 5515,
    maxListeners: 300,
    channels: [
        { id: "main", name: "Principal", source: "none" },
        { id: "interpretation", name: "Interpretação", source: "none" }
    ],
    testMode: false,
    title: ""
}

export const MAX_LISTEN_CHANNELS = 4

export interface ListenDevice {
    deviceId: string
    label: string
}

export interface ListenChannelStatus {
    live: boolean
    /** 0..1 peak level of the last 100 ms */
    level: number
    listeners: number
    error?: string
}

export interface ListenStatus {
    running: boolean
    error?: string
    /** listener page URLs, preferred first */
    urls: string[]
    addresses: string[]
    total: number
    channels: { [channelId: string]: ListenChannelStatus }
    devices: ListenDevice[]
    loopbackSupported: boolean
}

// messages between the server and the pages it serves (socket.io)

export interface ListenChannelInfo {
    id: string
    name: string
    live: boolean
}

export interface ListenPageInfo {
    title: string
    channels: ListenChannelInfo[]
    testMode: boolean
}
