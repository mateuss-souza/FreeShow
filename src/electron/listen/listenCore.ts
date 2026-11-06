// Listen core: web server for the phone page, socket.io signaling and a mediasoup SFU.
// The capture page (hidden window on this computer) sends one Opus track per channel; every phone
// receives a copy from mediasoup. All listeners share one media port (WebRtcServer), so the
// firewall needs one rule. Nothing here depends on Electron, so it can be tested in plain Node.

import { randomBytes } from "crypto"
import express from "express"
import http from "http"
import * as mediasoup from "mediasoup"
import type { types as ms } from "mediasoup"
import { Server, type Socket } from "socket.io"
import type { ListenConfig, ListenDevice, ListenPageInfo } from "../../types/Listen"
import type { LanAddress } from "./network"

export interface ListenCoreOptions {
    /** built phone page */
    listenerDir: string
    /** built capture page */
    captureDir: string
    onChange: () => void
}

interface ListenerState {
    transport?: ms.WebRtcTransport
    consumer?: ms.Consumer
    channelId?: string
}

const OPUS: ms.RouterRtpCodecCapability = { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 }

const isLoopback = (address?: string) => !!address && (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1")

export class ListenCore {
    readonly token = randomBytes(16).toString("hex")
    config: ListenConfig | null = null
    addresses: LanAddress[] = []
    running = false
    error = ""

    levels: { [channelId: string]: number } = {}
    channelErrors: { [channelId: string]: string } = {}
    devices: ListenDevice[] = []

    private worker: ms.Worker | null = null
    private router: ms.Router | null = null
    private webRtcServer: ms.WebRtcServer | null = null
    private httpServer: http.Server | null = null
    private io: Server | null = null
    private captureSocket: Socket | null = null
    private captureTransport: ms.WebRtcTransport | null = null
    private producers = new Map<string, ms.Producer>()
    private listeners = new Map<string, ListenerState>()

    constructor(private options: ListenCoreOptions) {}

    async start(config: ListenConfig, addresses: LanAddress[]) {
        await this.stop()
        this.config = config
        this.addresses = addresses
        this.error = ""

        try {
            this.worker = await mediasoup.createWorker({ logLevel: "warn", workerBin: workerBinary() })
            this.worker.on("died", () => {
                this.error = "Audio engine stopped unexpectedly"
                this.running = false
                this.options.onChange()
            })
            this.router = await this.worker.createRouter({ mediaCodecs: [OPUS] })

            // one port for every listener; loopback for the capture page, LAN addresses for phones
            const ips = ["127.0.0.1", ...addresses.map((a) => a.address)]
            const listenInfos: ms.TransportListenInfo[] = []
            ips.forEach((ip) => {
                listenInfos.push({ protocol: "udp", ip, port: config.mediaPort })
                listenInfos.push({ protocol: "tcp", ip, port: config.mediaPort })
            })
            this.webRtcServer = await this.worker.createWebRtcServer({ listenInfos })

            await this.startHttp(config.port)
            this.running = true
        } catch (err: any) {
            this.error = err?.code === "EADDRINUSE" ? `Port ${config.port} or ${config.mediaPort} is already in use` : String(err?.message || err)
            await this.stop(true)
        }
        this.options.onChange()
    }

    async stop(keepError = false) {
        this.running = false
        if (!keepError) this.error = ""
        this.captureSocket = null
        this.captureTransport = null
        this.producers.clear()
        this.listeners.clear()
        this.levels = {}

        const io = this.io
        this.io = null
        if (io) await new Promise<void>((resolve) => io.close(() => resolve()))
        if (this.httpServer?.listening) await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()))
        this.httpServer = null

        this.worker?.close()
        this.worker = null
        this.router = null
        this.webRtcServer = null
    }

    /** channel names, test mode and title change without a restart */
    updateConfig(config: ListenConfig) {
        this.config = config
        if (!this.io) return
        this.io.of("/capture").emit("config", this.captureConfig())
        this.io.of("/").emit("info", this.pageInfo())
        // channels that no longer exist
        for (const [channelId, producer] of this.producers) {
            if (!config.channels.find((c) => c.id === channelId)) {
                producer.close()
                this.producers.delete(channelId)
            }
        }
        this.options.onChange()
    }

    requestDevices(): Promise<ListenDevice[]> {
        const socket = this.captureSocket
        if (!socket) return Promise.resolve(this.devices)
        return new Promise((resolve) => {
            socket.timeout(5000).emit("listDevices", {}, (err: any, list: ListenDevice[]) => {
                if (!err && Array.isArray(list)) this.devices = list
                resolve(this.devices)
            })
        })
    }

    get captureConnected() {
        return !!this.captureSocket
    }

    channelStats() {
        const stats: { [channelId: string]: { live: boolean; level: number; listeners: number; error?: string } } = {}
        for (const channel of this.config?.channels || []) {
            stats[channel.id] = { live: this.producers.has(channel.id), level: this.levels[channel.id] || 0, listeners: 0, error: this.channelErrors[channel.id] }
        }
        for (const listener of this.listeners.values()) {
            if (listener.channelId && stats[listener.channelId]) stats[listener.channelId].listeners++
        }
        return stats
    }

    get totalListeners() {
        let total = 0
        for (const listener of this.listeners.values()) if (listener.channelId) total++
        return total
    }

    // HTTP + SIGNALING

    private startHttp(port: number) {
        const app = express()
        app.disable("x-powered-by")

        // the capture page only ever loads on this computer
        app.use("/capture", (req, res, next) => (isLoopback(req.socket.remoteAddress) ? next() : res.status(403).end()))
        app.use("/capture", express.static(this.options.captureDir))
        app.use(express.static(this.options.listenerDir))

        const server = http.createServer(app)
        const io = new Server(server, { serveClient: false, pingInterval: 5000, pingTimeout: 8000 })
        this.httpServer = server
        this.io = io

        io.of("/capture").use((socket, next) => {
            if (isLoopback(socket.handshake.address) && socket.handshake.auth?.token === this.token) return next()
            next(new Error("forbidden"))
        })
        io.of("/capture").on("connection", (socket) => this.onCapture(socket))
        io.of("/").on("connection", (socket) => this.onListener(socket))

        return new Promise<void>((resolve, reject) => {
            server.once("error", reject)
            server.listen(port, () => {
                server.off("error", reject)
                resolve()
            })
        })
    }

    private captureConfig() {
        return { channels: this.config?.channels || [], testMode: !!this.config?.testMode }
    }

    private pageInfo(): ListenPageInfo {
        const channels = (this.config?.channels || []).filter((c) => c.source !== "none").map((c) => ({ id: c.id, name: c.name, live: this.producers.has(c.id) }))
        return { title: this.config?.title || "", channels, testMode: !!this.config?.testMode }
    }

    private broadcastChannels() {
        this.io?.of("/").emit("info", this.pageInfo())
        this.options.onChange()
    }

    private async createTransport(forCapture: boolean) {
        const transport = await this.router!.createWebRtcTransport({ webRtcServer: this.webRtcServer!, enableUdp: true, enableTcp: true, preferUdp: true })
        // the capture page only needs loopback, phones never can use it
        const iceCandidates = transport.iceCandidates.filter((c) => isLoopback(c.address) === forCapture)
        return { transport, params: { id: transport.id, iceParameters: transport.iceParameters, iceCandidates, dtlsParameters: transport.dtlsParameters } }
    }

    private onCapture(socket: Socket) {
        // only one capture page at a time
        if (this.captureSocket && this.captureSocket.id !== socket.id) this.captureSocket.disconnect(true)
        this.captureSocket = socket
        socket.emit("config", this.captureConfig())

        handle(socket, "caps", () => this.router!.rtpCapabilities)
        handle(socket, "createTransport", async () => {
            this.captureTransport?.close()
            const { transport, params } = await this.createTransport(true)
            this.captureTransport = transport
            return params
        })
        handle(socket, "connectTransport", async ({ dtlsParameters }) => {
            await this.captureTransport!.connect({ dtlsParameters })
            return {}
        })
        handle(socket, "produce", async ({ channelId, kind, rtpParameters }) => {
            if (!this.config?.channels.find((c) => c.id === channelId)) throw new Error("unknown channel")
            this.producers.get(channelId)?.close()
            const producer = await this.captureTransport!.produce({ kind, rtpParameters, appData: { channelId } })
            producer.on("transportclose", () => this.dropProducer(channelId, producer))
            this.producers.set(channelId, producer)
            delete this.channelErrors[channelId]
            this.broadcastChannels()
            return { id: producer.id }
        })
        handle(socket, "closeProducer", ({ channelId }) => {
            const producer = this.producers.get(channelId)
            if (producer) {
                producer.close()
                this.dropProducer(channelId, producer)
            }
            return {}
        })

        socket.on("levels", (levels: { [id: string]: number }) => {
            this.levels = levels || {}
            this.options.onChange()
        })
        socket.on("channelError", ({ channelId, error }: { channelId: string; error?: string }) => {
            if (error) this.channelErrors[channelId] = error
            else delete this.channelErrors[channelId]
            this.options.onChange()
        })
        socket.on("devices", (list: ListenDevice[]) => {
            if (Array.isArray(list)) this.devices = list
            this.options.onChange()
        })
        // latency test: tell the phones on that channel when the click left this computer
        socket.on("click", ({ channelId, at }: { channelId: string; at: number }) => {
            this.io
                ?.of("/")
                .to("ch:" + channelId)
                .emit("click", { channelId, at })
        })

        socket.on("disconnect", () => {
            if (this.captureSocket?.id !== socket.id) return
            this.captureSocket = null
            this.captureTransport?.close()
            this.captureTransport = null
            this.levels = {}
            this.broadcastChannels()
        })
        this.options.onChange()
    }

    private dropProducer(channelId: string, producer: ms.Producer) {
        if (this.producers.get(channelId) !== producer) return
        this.producers.delete(channelId)
        this.broadcastChannels()
    }

    private onListener(socket: Socket) {
        const max = this.config?.maxListeners || 300
        if (this.listeners.size >= max) {
            socket.emit("full", { max })
            socket.disconnect(true)
            return
        }

        const state: ListenerState = {}
        this.listeners.set(socket.id, state)
        socket.emit("info", this.pageInfo())

        const closeConsumer = () => {
            state.consumer?.close()
            state.consumer = undefined
            if (state.channelId) socket.leave("ch:" + state.channelId)
        }

        // clock sync for the latency test
        handle(socket, "time", () => ({ now: Date.now() }))
        handle(socket, "caps", () => this.router!.rtpCapabilities)
        handle(socket, "createTransport", async () => {
            state.transport?.close()
            state.consumer = undefined
            const { transport, params } = await this.createTransport(false)
            state.transport = transport
            return params
        })
        handle(socket, "connectTransport", async ({ dtlsParameters }) => {
            if (!state.transport) throw new Error("no transport")
            await state.transport.connect({ dtlsParameters })
            return {}
        })
        handle(socket, "consume", async ({ channelId, rtpCapabilities }) => {
            if (!state.transport) throw new Error("no transport")
            closeConsumer()
            state.channelId = channelId
            socket.join("ch:" + channelId)
            this.options.onChange()

            const producer = this.producers.get(channelId)
            if (!producer) return { offline: true }
            if (!this.router!.canConsume({ producerId: producer.id, rtpCapabilities })) throw new Error("This phone can't play this audio")

            const consumer = await state.transport.consume({ producerId: producer.id, rtpCapabilities, paused: true })
            consumer.on("producerclose", () => {
                if (state.consumer !== consumer) return
                state.consumer = undefined
                socket.emit("offline", { channelId })
            })
            state.consumer = consumer
            return { id: consumer.id, producerId: producer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters }
        })
        handle(socket, "resume", async () => {
            await state.consumer?.resume()
            return {}
        })
        handle(socket, "stop", () => {
            closeConsumer()
            state.channelId = undefined
            this.options.onChange()
            return {}
        })

        socket.on("disconnect", () => {
            state.transport?.close()
            this.listeners.delete(socket.id)
            this.options.onChange()
        })
    }
}

// in the installed app the worker binary is unpacked next to app.asar (a packed file can't be executed)
function workerBinary() {
    const bin = mediasoup.workerBin
    return bin.replace(/app\.asar([\\/])/, "app.asar.unpacked$1")
}

// request/response over socket.io acks, errors returned as { error }
function handle(socket: Socket, event: string, fn: (data: any) => any) {
    socket.on(event, async (data: any, ack?: (response: any) => void) => {
        if (typeof ack !== "function") return
        try {
            ack(await fn(data || {}))
        } catch (err: any) {
            ack({ error: String(err?.message || err) })
        }
    })
}
