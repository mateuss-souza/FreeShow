// status of the in-app update download, pushed by the main process
export type UpdateStatus = {
    state: "idle" | "checking" | "downloading" | "ready" | "error"
    version?: string
    percent?: number
    error?: string
}
