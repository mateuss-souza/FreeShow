// Runs in a hidden window on the presentation computer. Captures each channel's source, sends it to
// the SFU as Opus over WebRTC (loopback), and reports levels, devices and errors.

import { Device, types } from "mediasoup-client"
type Producer = types.Producer
type Transport = types.Transport
import { io } from "socket.io-client"
import type { ListenChannelConfig, ListenDevice } from "../../types/Listen"

interface Pipe {
    key: string
    channelId: string
    stream: MediaStream
    source: MediaStreamAudioSourceNode
    analyser: AnalyserNode
    output: MediaStreamAudioDestinationNode
    producer: Producer | null
}

const token = new URLSearchParams(location.search).get("token") || ""
const socket = io("/capture", { auth: { token }, transports: ["websocket"] })

let config: { channels: ListenChannelConfig[]; testMode: boolean } = { channels: [], testMode: false }
let device: Device | null = null
let transport: Transport | null = null
let ctx: AudioContext | null = null
const pipes = new Map<string, Pipe>()

function request<T = any>(event: string, data: any = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        socket.timeout(10000).emit(event, data, (err: any, response: any) => {
            if (err) return reject(err)
            if (response?.error) return reject(new Error(response.error))
            resolve(response)
        })
    })
}

// changes are applied one at a time, in order
let queue: Promise<void> = Promise.resolve()
const enqueue = (fn: () => Promise<void>) => (queue = queue.then(fn).catch((err) => console.error("[listen]", err)))

socket.on("connect", () =>
    enqueue(async () => {
        closeAll()
        await setupTransport()
        await applyConfig()
        pushDevices()
    })
)
socket.on("disconnect", () => enqueue(async () => closeAll()))
socket.on("config", (next) => {
    config = next
    enqueue(applyConfig)
})
socket.on("listDevices", async (_data: any, ack: (list: ListenDevice[]) => void) => ack(await listDevices()))
navigator.mediaDevices.addEventListener("devicechange", () => {
    pushDevices()
    // a device that came back (USB replugged) is picked up again
    enqueue(applyConfig)
})

async function setupTransport() {
    device = new Device()
    await device.load({ routerRtpCapabilities: await request("caps") })
    transport = device.createSendTransport(await request("createTransport"))
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        request("connectTransport", { dtlsParameters })
            .then(() => callback())
            .catch(errback)
    })
    transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        request<{ id: string }>("produce", { kind, rtpParameters, channelId: appData.channelId })
            .then(({ id }) => callback({ id }))
            .catch(errback)
    })
    transport.on("connectionstatechange", (state) => {
        if (state === "failed") location.reload()
    })
}

const pipeKey = (c: ListenChannelConfig) => [c.source, c.deviceId || "", c.stereo ? "s" : "m"].join("|")

async function applyConfig() {
    if (!transport) return
    const wanted = config.channels.filter((c) => c.source !== "none")

    for (const [id, pipe] of pipes) {
        const channel = wanted.find((c) => c.id === id)
        if (!channel || pipeKey(channel) !== pipe.key) closePipe(id)
    }
    for (const channel of wanted) {
        if (pipes.has(channel.id)) continue
        try {
            await openPipe(channel)
            socket.emit("channelError", { channelId: channel.id })
        } catch (err: any) {
            console.error("[listen]", channel.id, err)
            socket.emit("channelError", { channelId: channel.id, error: describeError(err, channel) })
        }
    }
}

function describeError(err: any, channel: ListenChannelConfig) {
    const name = err?.name || ""
    if (name === "NotFoundError" || name === "OverconstrainedError") return channel.source === "device" ? "Audio device not found (is it connected?)" : "No audio to capture"
    if (name === "NotReadableError") return "The audio device is in use by another program or unavailable"
    if (name === "NotAllowedError") return "Access to audio was blocked"
    return String(err?.message || err)
}

async function getSourceStream(channel: ListenChannelConfig): Promise<MediaStream> {
    if (channel.source === "loopback") {
        // Windows: Electron answers this with the whole system mix ("loopback"); the video part is required, then dropped
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } })
        stream.getVideoTracks().forEach((track) => {
            track.stop()
            stream.removeTrack(track)
        })
        if (!stream.getAudioTracks().length) throw new Error("System audio capture is not available on this computer")
        return stream
    }

    const deviceId = await resolveDeviceId(channel)
    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            // a mixer feed must reach listeners untouched
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: { ideal: channel.stereo ? 2 : 1 },
            sampleRate: { ideal: 48000 },
            // @ts-ignore: Chromium supports a latency hint for capture
            latency: { ideal: 0 }
        }
    })
}

// device IDs can change (new browser storage, driver update): fall back to the device's name
async function resolveDeviceId(channel: ListenChannelConfig) {
    if (!channel.deviceId) return undefined
    const devices = await listDevices()
    if (devices.find((d) => d.deviceId === channel.deviceId)) return channel.deviceId
    const byName = channel.deviceLabel && devices.find((d) => d.label === channel.deviceLabel)
    return byName ? byName.deviceId : channel.deviceId
}

async function openPipe(channel: ListenChannelConfig) {
    const stream = await getSourceStream(channel)
    if (!ctx) ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 })
    if (ctx.state !== "running") await ctx.resume()

    const source = ctx.createMediaStreamSource(stream)
    const output = ctx.createMediaStreamDestination()
    output.channelCount = channel.stereo ? 2 : 1
    output.channelCountMode = "explicit"
    source.connect(output)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    const pipe: Pipe = { key: pipeKey(channel), channelId: channel.id, stream, source, analyser, output, producer: null }
    pipes.set(channel.id, pipe)

    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (pipes.get(channel.id) !== pipe) return
        socket.emit("channelError", { channelId: channel.id, error: "The audio source stopped (device disconnected?)" })
        closePipe(channel.id)
        setTimeout(() => enqueue(applyConfig), 3000)
    })

    pipe.producer = await transport!.produce({
        track: output.stream.getAudioTracks()[0],
        stopTracks: false,
        // 10 ms packets and no DTX: lowest delay, steady stream
        codecOptions: { opusStereo: !!channel.stereo, opusDtx: false, opusFec: true, opusPtime: 10, opusMaxAverageBitrate: channel.stereo ? 128000 : 64000 },
        appData: { channelId: channel.id }
    })
}

function closePipe(channelId: string) {
    const pipe = pipes.get(channelId)
    if (!pipe) return
    pipes.delete(channelId)
    if (pipe.producer && !pipe.producer.closed) {
        pipe.producer.close()
        request("closeProducer", { channelId }).catch(() => {})
    }
    pipe.source.disconnect()
    pipe.stream.getTracks().forEach((t) => t.stop())
}

function closeAll() {
    ;[...pipes.keys()].forEach(closePipe)
    transport?.close()
    transport = null
}

async function listDevices(): Promise<ListenDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications").map((d) => ({ deviceId: d.deviceId, label: d.label || "Audio input" }))
}

async function pushDevices() {
    try {
        socket.emit("devices", await listDevices())
    } catch (err) {
        console.error("[listen]", err)
    }
}

// LEVELS (peak, 10x per second)

const buffer = new Float32Array(2048)
setInterval(() => {
    if (!socket.connected) return
    const levels: { [id: string]: number } = {}
    for (const [id, pipe] of pipes) {
        pipe.analyser.getFloatTimeDomainData(buffer)
        let peak = 0
        for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]))
        levels[id] = Math.min(1, peak)
    }
    socket.emit("levels", levels)
}, 100)

// LATENCY TEST: a 5 ms 2 kHz click every 2 s, mixed into each channel, with the time it was sent

setInterval(() => {
    if (!config.testMode || !ctx || !socket.connected) return
    for (const [channelId, pipe] of pipes) {
        if (!pipe.producer) continue
        const at = ctx.currentTime + 0.1
        const osc = ctx.createOscillator()
        osc.frequency.value = 2000
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(0.9, at + 0.0005)
        gain.gain.setValueAtTime(0.9, at + 0.0045)
        gain.gain.linearRampToValueAtTime(0, at + 0.005)
        osc.connect(gain).connect(pipe.output)
        osc.start(at)
        osc.stop(at + 0.01)
        // the click enters the stream when the context renders "at"
        socket.emit("click", { channelId, at: Date.now() + (at - ctx.currentTime) * 1000 })
    }
}, 2000)
