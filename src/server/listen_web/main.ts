// Phone page: pick a channel, tap Play, hear the live audio. Receive-only WebRTC (works over plain http).

import "./styles.css"
import { Device, types } from "mediasoup-client"
type Consumer = types.Consumer
type Transport = types.Transport
import { io } from "socket.io-client"
import type { ListenChannelInfo, ListenPageInfo } from "../../types/Listen"

// TEXT

const en = navigator.language?.toLowerCase().startsWith("en")
const t = en
    ? {
          title: "Listen",
          play: "Play",
          stop: "Stop",
          connecting: "Connecting…",
          live: "Live",
          waiting: "Waiting for audio",
          offline: "No connection",
          ready: "Ready",
          tapPlay: "Tap to listen",
          waitingLong: "The audio hasn't started yet. It plays automatically when it does.",
          noServer: "Can't reach the church computer. Make sure you're on the church Wi-Fi.",
          reconnecting: "Reconnecting…",
          full: "Too many listeners right now. Try again in a moment.",
          noChannels: "No audio channel is on right now.",
          keepOn: "<strong>Keep your screen on.</strong> On iPhone the audio stops when the phone locks.",
          headphones: "<strong>Use wired headphones</strong> if you can: Bluetooth adds delay.",
          latency: "Delay",
          latencyHint: "average {avg} ms · worst {max} ms · {n} clicks (excluding headphones)",
          latencyWaiting: "Waiting for the test click…",
          quality: "Lost audio {lost}% · jitter {jitter} ms",
          weak: "Weak Wi-Fi signal: move closer to the router"
      }
    : {
          title: "Ouvir",
          play: "Ouvir",
          stop: "Parar",
          connecting: "Conectando…",
          live: "Ao vivo",
          waiting: "Aguardando áudio",
          offline: "Sem conexão",
          ready: "Pronto",
          tapPlay: "Toque para ouvir",
          waitingLong: "O áudio ainda não começou. Ele toca sozinho quando começar.",
          noServer: "Não foi possível falar com o computador da igreja. Confira se você está no Wi-Fi da igreja.",
          reconnecting: "Reconectando…",
          full: "Muitas pessoas ouvindo agora. Tente de novo em instantes.",
          noChannels: "Nenhum canal de áudio está ligado agora.",
          keepOn: "<strong>Mantenha a tela ligada.</strong> No iPhone o áudio para quando o celular bloqueia.",
          headphones: "<strong>Use fone com fio</strong> se puder: o Bluetooth adiciona atraso.",
          latency: "Atraso",
          latencyHint: "média {avg} ms · pior {max} ms · {n} cliques (sem contar o fone)",
          latencyWaiting: "Aguardando o clique de teste…",
          quality: "Áudio perdido {lost}% · variação {jitter} ms",
          weak: "Sinal de Wi-Fi fraco: chegue mais perto do roteador"
      }

// PAGE

const icons = {
    play: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`
}

document.body.innerHTML = `
<main>
  <header>
    <h1 id="title"></h1>
    <span class="status" id="status" data-state="connecting" role="status"><span class="dot"></span><span id="statusText"></span></span>
  </header>
  <div class="channels" id="channels" role="radiogroup"></div>
  <section class="stage">
    <button class="play" id="play" aria-pressed="false"></button>
    <p class="message" id="message" aria-live="polite"></p>
    <p class="quality" id="quality"></p>
  </section>
  <section class="test" id="test" hidden>
    <span>${t.latency}</span>
    <b id="latency">–</b>
    <span id="latencyHint">${t.latencyWaiting}</span>
  </section>
  <div class="notes">
    <p class="note">${t.keepOn}</p>
    <p class="note">${t.headphones}</p>
  </div>
  <audio id="audio" playsinline autoplay></audio>
  <video class="keepawake" id="keepawake" src="keepawake.mp4" playsinline muted loop></video>
</main>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const titleEl = $("title")
const statusEl = $("status")
const statusText = $("statusText")
const channelsEl = $("channels")
const playButton = $<HTMLButtonElement>("play")
const message = $("message")
const audio = $<HTMLAudioElement>("audio")
const keepAwakeVideo = $<HTMLVideoElement>("keepawake")
const testEl = $("test")
const qualityEl = $("quality")
const latencyEl = $("latency")
const latencyHint = $("latencyHint")

type State = "connecting" | "ready" | "live" | "waiting" | "offline"
function setState(state: State, text?: string) {
    statusEl.dataset.state = state
    statusText.textContent = { connecting: t.connecting, ready: t.ready, live: t.live, waiting: t.waiting, offline: t.offline }[state]
    if (text !== undefined) message.textContent = text
}

// STATE

let info: ListenPageInfo = { title: "", channels: [], testMode: false }
let playing = false
let selected = localStorage.getItem("listen.channel") || ""
let device: Device | null = null
let transport: Transport | null = null
let consumer: Consumer | null = null
let clockOffset = 0 // server time - local time

const socket = io({ transports: ["websocket"], reconnectionDelay: 500, reconnectionDelayMax: 3000 })

function request<T = any>(event: string, data: any = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        socket.timeout(8000).emit(event, data, (err: any, response: any) => {
            if (err) return reject(err)
            if (response?.error) return reject(new Error(response.error))
            resolve(response)
        })
    })
}

function render() {
    titleEl.textContent = info.title || t.title
    document.title = info.title || t.title

    const live = info.channels
    // a channel the person picked stays picked while it's off (an interpretation listener must never
    // be moved to the original language); otherwise pick the first channel that's on
    const chosen = localStorage.getItem("listen.channel")
    const missing = !live.find((c) => c.id === selected)
    if (missing && !(selected && selected === chosen)) selected = (live.find((c) => c.live) || live[0])?.id || ""

    channelsEl.innerHTML = ""
    if (live.length > 1 || (live.length && !live.find((c) => c.id === selected))) {
        live.forEach((channel) => {
            const button = document.createElement("button")
            button.type = "button"
            button.textContent = channel.name
            button.setAttribute("role", "radio")
            button.setAttribute("aria-checked", String(channel.id === selected))
            button.dataset.live = String(channel.live)
            button.onclick = () => selectChannel(channel.id)
            channelsEl.appendChild(button)
        })
    }

    playButton.innerHTML = playing ? icons.stop : icons.play
    playButton.setAttribute("aria-pressed", String(playing))
    playButton.setAttribute("aria-label", playing ? t.stop : t.play)
    testEl.hidden = !(info.testMode && playing)
}

const currentChannel = (): ListenChannelInfo | undefined => info.channels.find((c) => c.id === selected)

// CONNECTION

socket.on("connect", async () => {
    syncClock()
    if (playing) await startStream()
    else setState("ready", info.channels.length ? t.tapPlay : t.noChannels)
})

socket.on("disconnect", () => {
    dropTransport()
    setState("connecting", playing ? t.reconnecting : "")
})

socket.io.on("reconnect_attempt", (attempt) => {
    if (attempt >= 4) setState("offline", t.noServer)
})

socket.on("full", () => setState("offline", t.full))

socket.on("info", (next: ListenPageInfo) => {
    const wasLive = !!currentChannel()?.live
    info = next
    render()
    const channel = currentChannel()
    if (!playing) {
        if (socket.connected) setState("ready", info.channels.length ? t.tapPlay : t.noChannels)
        return
    }
    // the selected channel came on: start it
    if (channel?.live && (!wasLive || !consumer)) startStream()
    if (!channel?.live) setState("waiting", t.waitingLong)
})

socket.on("offline", () => {
    closeConsumer()
    if (playing) setState("waiting", t.waitingLong)
})

function dropTransport() {
    closeConsumer()
    transport?.close()
    transport = null
    device = null
}

function closeConsumer() {
    consumer?.close()
    consumer = null
    detachDetector()
}

async function ensureTransport() {
    if (transport && !transport.closed) return transport
    device = createDevice()
    await device.load({ routerRtpCapabilities: await request("caps") })
    const recv = device.createRecvTransport(await request("createTransport"))
    recv.on("connect", ({ dtlsParameters }, callback, errback) => {
        request("connectTransport", { dtlsParameters })
            .then(() => callback())
            .catch(errback)
    })
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null
    recv.on("connectionstatechange", (state) => {
        if (disconnectTimer) clearTimeout(disconnectTimer)
        if (state === "connected" && playing && consumer) setState("live", "")
        // Wi-Fi hiccup: give it a moment, then build a new connection
        if (state === "disconnected") disconnectTimer = setTimeout(rebuild, 3000)
        if (state === "failed") rebuild()
    })
    transport = recv
    return recv
}

// mediasoup-client picks its WebRTC handler from browser info that some browsers only give on https;
// on this plain-http page fall back to choosing it from the user agent
function createDevice(): Device {
    try {
        return new Device()
    } catch {
        const ua = navigator.userAgent
        const handlerName = /firefox/i.test(ua) ? "Firefox120" : /chrom(e|ium)/i.test(ua) && !/iphone|ipad|ipod/i.test(ua) ? "Chrome111" : "Safari12"
        return new Device({ handlerName })
    }
}

let rebuilding = false
async function rebuild() {
    if (rebuilding || !playing || !socket.connected) return
    rebuilding = true
    setState("connecting", t.reconnecting)
    dropTransport()
    await new Promise((r) => setTimeout(r, 500))
    rebuilding = false
    startStream()
}

let starting: Promise<void> | null = null
function startStream() {
    if (!starting) starting = doStart().finally(() => (starting = null))
    return starting
}

async function doStart() {
    if (!playing || !socket.connected) return
    const channel = currentChannel()
    if (!channel) {
        setState("waiting", info.channels.length ? t.waitingLong : t.noChannels)
        return
    }

    setState("connecting", "")
    try {
        const recv = await ensureTransport()
        closeConsumer()
        const params = await request("consume", { channelId: channel.id, rtpCapabilities: device!.rtpCapabilities })
        if (params.offline) {
            setState("waiting", t.waitingLong)
            return
        }

        consumer = await recv.consume(params)
        const stream = new MediaStream([consumer.track])
        audio.srcObject = stream
        await request("resume")
        await audio.play().catch(() => {})
        attachDetector(stream)
        setState(recv.connectionState === "connected" ? "live" : "connecting", "")
    } catch (err: any) {
        console.error(err)
        setState("offline", String(err?.message || err))
        setTimeout(rebuild, 2000)
    }
}

// CONTROLS

playButton.addEventListener("click", () => {
    if (playing) {
        stop()
        return
    }
    playing = true
    // must happen inside the tap: browsers only allow audio that a user started
    audio.play().catch(() => {})
    unlockAudioContext()
    keepScreenOn()
    render()
    startStream()
})

async function stop() {
    playing = false
    closeConsumer()
    audio.srcObject = null
    releaseScreen()
    request("stop").catch(() => {})
    render()
    setState("ready", t.tapPlay)
}

function selectChannel(id: string) {
    if (id === selected) return
    selected = id
    localStorage.setItem("listen.channel", id)
    render()
    if (playing) startStream()
}

// KEEP THE SCREEN ON (iOS pauses web audio when the phone locks)

let wakeLock: any = null
async function keepScreenOn() {
    try {
        if ("wakeLock" in navigator) {
            // only on https; on the plain-http LAN page this is skipped
            wakeLock = await (navigator as any).wakeLock.request("screen")
            return
        }
    } catch {}
    // fallback: a playing (silent, invisible) video keeps most phones awake
    keepAwakeVideo.play().catch(() => {})
}

function releaseScreen() {
    wakeLock?.release?.().catch(() => {})
    wakeLock = null
    keepAwakeVideo.pause()
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !playing) return
    keepScreenOn()
    // returning from a locked screen: make sure audio is flowing again
    audio.play().catch(() => {})
    if (!consumer || transport?.connectionState !== "connected") rebuild()
})

// LATENCY TEST

let audioCtx: AudioContext | null = null
function unlockAudioContext() {
    try {
        const AC = window.AudioContext || (window as any).webkitAudioContext
        if (!audioCtx && AC) audioCtx = new AC()
        audioCtx?.resume()
    } catch {}
}

// server time = local time + offset, from the lowest-delay of a few pings
async function syncClock() {
    let best = { rtt: Infinity, offset: 0 }
    for (let i = 0; i < 6; i++) {
        const sent = Date.now()
        try {
            const { now } = await request<{ now: number }>("time")
            const received = Date.now()
            const rtt = received - sent
            if (rtt < best.rtt) best = { rtt, offset: now - (sent + received) / 2 }
        } catch {}
    }
    if (best.rtt !== Infinity) clockOffset = best.offset
}
setInterval(() => socket.connected && info.testMode && syncClock(), 15000)

const expected: number[] = [] // local times clicks left the computer
const results: number[] = []
socket.on("click", ({ channelId, at }: { channelId: string; at: number }) => {
    if (channelId !== selected) return
    expected.push(at - clockOffset)
    while (expected.length > 10) expected.shift()
})

let processor: ScriptProcessorNode | null = null
let detectorSource: MediaStreamAudioSourceNode | null = null
function attachDetector(stream: MediaStream) {
    detachDetector()
    if (!info.testMode || !audioCtx) return
    // AudioWorklet needs https; ScriptProcessor works on the http page
    detectorSource = audioCtx.createMediaStreamSource(stream)
    processor = audioCtx.createScriptProcessor(256, 1, 1)
    let lastHit = 0
    processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        event.outputBuffer.getChannelData(0).fill(0)
        const now = Date.now()
        for (let i = 0; i < input.length; i++) {
            if (Math.abs(input[i]) < 0.3) continue
            // this sample arrived (length - i) samples before the callback
            const hit = now - ((input.length - i) / event.inputBuffer.sampleRate) * 1000
            if (hit - lastHit > 1000) {
                lastHit = hit
                registerHit(hit)
            }
            break
        }
    }
    detectorSource.connect(processor)
    processor.connect(audioCtx.destination)
}

function detachDetector() {
    processor?.disconnect()
    detectorSource?.disconnect()
    processor = null
    detectorSource = null
}

function registerHit(hit: number) {
    // the click this beep belongs to: sent before it, within 1.5 s
    const index = expected.findIndex((sent) => hit - sent > 0 && hit - sent < 1500)
    if (index < 0) return
    const delay = Math.round(hit - expected[index])
    expected.splice(0, index + 1)
    results.push(delay)
    while (results.length > 30) results.shift()
    const avg = Math.round(results.reduce((a, b) => a + b, 0) / results.length)
    const max = Math.max(...results)
    latencyEl.textContent = `${delay} ms`
    latencyHint.textContent = t.latencyHint.replace("{avg}", String(avg)).replace("{max}", String(max)).replace("{n}", String(results.length))
}

render()
setState("connecting", "")

// CONNECTION QUALITY: how much audio the phone had to fill in (sounds robotic) and how uneven packets arrive
let lastStats: { concealed: number; total: number } | null = null
setInterval(async () => {
    if (!playing || !consumer || consumer.closed) {
        qualityEl.textContent = ""
        lastStats = null
        return
    }
    try {
        const report = await consumer.getStats()
        let inbound: any = null
        report.forEach((r: any) => {
            if (r.type === "inbound-rtp" && r.kind === "audio") inbound = r
        })
        if (!inbound) return
        const now = { concealed: Number(inbound.concealedSamples) || 0, total: Number(inbound.totalSamplesReceived) || 0 }
        const prev = lastStats
        lastStats = now
        if (!prev || now.total <= prev.total) return
        const lost = Math.max(0, Math.min(100, ((now.concealed - prev.concealed) / (now.total - prev.total)) * 100))
        const jitter = Math.round((Number(inbound.jitter) || 0) * 1000)
        const text = t.quality.replace("{lost}", lost < 1 ? lost.toFixed(1) : String(Math.round(lost))).replace("{jitter}", String(jitter))
        qualityEl.textContent = lost >= 3 ? `${text} · ${t.weak}` : text
        qualityEl.dataset.bad = String(lost >= 3)
    } catch {
        // stats are optional
    }
}, 2000)
