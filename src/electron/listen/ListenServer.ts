// Listen in FreeShow: settings, the hidden capture window and the link to the operator UI.

import { app, BrowserWindow, desktopCapturer, session } from "electron"
import fs from "fs"
import { join } from "path"
import { Main } from "../../types/IPC/Main"
import { DEFAULT_LISTEN_CONFIG, MAX_LISTEN_CHANNELS, type ListenConfig, type ListenStatus } from "../../types/Listen"
import { getMainWindow } from "../index"
import { sendMain } from "../IPC/main"
import { ListenCore } from "./listenCore"
import { addressesKey, getLanAddresses } from "./network"

// persistent, so audio device IDs stay the same across restarts
const CAPTURE_PARTITION = "persist:listen-capture"
const configPath = () => join(app.getPath("userData"), "listen.json")

let config: ListenConfig = loadConfig()
let captureWindow: BrowserWindow | null = null
let networkTimer: NodeJS.Timeout | null = null
let networkKey = ""
let sessionReady = false

const core = new ListenCore({
    listenerDir: join(__dirname, "..", "listen_web"),
    captureDir: join(__dirname, "..", "listen_capture"),
    onChange: () => queueStatus()
})

function loadConfig(): ListenConfig {
    try {
        const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"))
        return sanitize({ ...DEFAULT_LISTEN_CONFIG, ...saved })
    } catch {
        return { ...DEFAULT_LISTEN_CONFIG, channels: DEFAULT_LISTEN_CONFIG.channels.map((c) => ({ ...c })) }
    }
}

function sanitize(c: ListenConfig): ListenConfig {
    const port = (v: any, fallback: number) => (Number.isInteger(Number(v)) && Number(v) > 1023 && Number(v) < 65536 ? Number(v) : fallback)
    const channels = (Array.isArray(c.channels) ? c.channels : DEFAULT_LISTEN_CONFIG.channels).slice(0, MAX_LISTEN_CHANNELS).filter((ch) => ch?.id)
    return {
        ...c,
        enabled: !!c.enabled,
        port: port(c.port, DEFAULT_LISTEN_CONFIG.port),
        mediaPort: port(c.mediaPort, DEFAULT_LISTEN_CONFIG.mediaPort),
        maxListeners: Math.max(1, Math.min(1000, Number(c.maxListeners) || DEFAULT_LISTEN_CONFIG.maxListeners)),
        channels: channels.map((ch) => ({ ...ch, name: String(ch.name || ch.id).slice(0, 40), source: ["none", "device", "loopback"].includes(ch.source) ? ch.source : "none" }))
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
    } catch (err) {
        console.error("[listen] could not save settings", err)
    }
}

// START / STOP

export function initListen() {
    app.on("before-quit", () => stopListen())
    getMainWindow()?.once("closed", () => stopListen())
    if (config.enabled) startListen()
}

async function startListen() {
    const addresses = getLanAddresses()
    networkKey = addressesKey(addresses)
    await core.start(config, addresses)
    if (!core.running) return queueStatus()

    openCaptureWindow()

    // phones reach this computer by its LAN address: follow changes (Wi-Fi switch, new DHCP lease)
    if (networkTimer) clearInterval(networkTimer)
    networkTimer = setInterval(() => {
        const next = getLanAddresses()
        if (addressesKey(next) === networkKey) return
        console.info("[listen] network changed, restarting")
        restartListen()
    }, 15000)
}

export async function stopListen() {
    if (networkTimer) clearInterval(networkTimer)
    networkTimer = null
    closeCaptureWindow()
    await core.stop()
    queueStatus()
}

async function restartListen() {
    await stopListen()
    if (config.enabled) await startListen()
}

// CAPTURE WINDOW

function prepareSession() {
    if (sessionReady) return
    sessionReady = true
    const ses = session.fromPartition(CAPTURE_PARTITION)
    // only the capture page lives in this session: it may use audio inputs and system audio
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "media" || permission === "display-capture"))
    ses.setPermissionCheckHandler((_wc, permission) => permission === "media" || permission === "display-capture")
    ses.setDisplayMediaRequestHandler(
        (_request, callback) => {
            desktopCapturer
                .getSources({ types: ["screen"] })
                .then((sources) => {
                    // "loopback" is the whole system mix (Windows); the screen is required by Chromium and discarded
                    if (!sources[0]) return callback({})
                    callback({ video: sources[0], audio: "loopback" })
                })
                .catch(() => callback({}))
        },
        { useSystemPicker: false }
    )
}

function openCaptureWindow() {
    closeCaptureWindow()
    prepareSession()
    const window = new BrowserWindow({
        show: false,
        width: 320,
        height: 240,
        skipTaskbar: true,
        webPreferences: {
            partition: CAPTURE_PARTITION,
            backgroundThrottling: false,
            autoplayPolicy: "no-user-gesture-required",
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    })
    captureWindow = window
    window.webContents.on("render-process-gone", () => {
        if (captureWindow !== window) return
        console.error("[listen] capture page crashed, reopening")
        setTimeout(() => core.running && captureWindow === window && openCaptureWindow(), 2000)
    })
    window.on("closed", () => {
        if (captureWindow === window) captureWindow = null
    })
    window.loadURL(`http://127.0.0.1:${config.port}/capture/?token=${core.token}`).catch((err) => console.error("[listen] capture page", err))
}

function closeCaptureWindow() {
    const window = captureWindow
    captureWindow = null
    if (window && !window.isDestroyed()) window.destroy()
}

// OPERATOR UI

export function getListenState() {
    return { config, status: buildStatus() }
}

export async function setListenConfig(change: Partial<ListenConfig>) {
    const previous = config
    config = sanitize({ ...config, ...change })
    saveConfig()

    const restartNeeded = previous.port !== config.port || previous.mediaPort !== config.mediaPort
    if (!config.enabled) await stopListen()
    else if (!core.running || restartNeeded || !previous.enabled) await restartListen()
    else core.updateConfig(config)

    return getListenState()
}

export async function refreshListenDevices() {
    await core.requestDevices()
    return buildStatus()
}

function buildStatus(): ListenStatus {
    const addresses = core.addresses.map((a) => a.address)
    const preferred = config.preferredAddress && addresses.includes(config.preferredAddress) ? config.preferredAddress : addresses[0]
    const ordered = preferred ? [preferred, ...addresses.filter((a) => a !== preferred)] : addresses
    return {
        running: core.running,
        error: core.error || (core.running && !core.captureConnected ? "Starting audio capture…" : undefined),
        urls: ordered.map((a) => `http://${a}:${config.port}`),
        addresses,
        total: core.totalListeners,
        channels: core.channelStats(),
        devices: core.devices,
        loopbackSupported: process.platform === "win32"
    }
}

// levels arrive 10x per second: at most that many updates to the UI
let statusTimer: NodeJS.Timeout | null = null
function queueStatus() {
    if (statusTimer) return
    statusTimer = setTimeout(() => {
        statusTimer = null
        sendMain(Main.LISTEN_STATUS, buildStatus())
    }, 100)
}
