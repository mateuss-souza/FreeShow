// import { Notification, app } from "electron"
import { autoUpdater } from "electron-updater"
import { isProd } from ".."
import type { UpdateStatus } from "../../types/Update"
import { sendMain } from "../IPC/main"
import { Main } from "../../types/IPC/Main"

// let notification: Notification | null

let listening = false
let lastStatus: UpdateStatus = { state: "idle" }

function setUpdateStatus(status: UpdateStatus) {
    lastStatus = status
    sendMain(Main.UPDATE_STATUS, status)
}

function listenForUpdates() {
    if (listening) return
    listening = true

    autoUpdater.on("checking-for-update", () => setUpdateStatus({ state: "checking" }))
    autoUpdater.on("update-available", (info) => setUpdateStatus({ state: "downloading", version: info.version, percent: 0 }))
    autoUpdater.on("update-not-available", () => setUpdateStatus({ state: "idle" }))
    autoUpdater.on("download-progress", (progress) => {
        setUpdateStatus({ ...lastStatus, state: "downloading", percent: Math.round(progress.percent) })
    })
    autoUpdater.on("update-downloaded", (info) => setUpdateStatus({ state: "ready", version: info.version }))
    autoUpdater.on("error", (err) => {
        console.error("Auto-update error:", err)
        setUpdateStatus({ state: "error", error: err?.message || String(err) })
    })
}

export default async function checkForUpdates() {
    if (!isProd) return

    listenForUpdates()
    try {
        await autoUpdater.checkForUpdatesAndNotify()
    } catch (err) {
        console.error("Auto-update error:", err)
        setUpdateStatus({ state: "error", error: (err as Error)?.message || String(err) })
    }
}
