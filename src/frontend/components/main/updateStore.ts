import { writable } from "svelte/store"
import type { UpdateStatus } from "../../../types/Update"

// download status of the in-app update, pushed by the main process
export const updateStatus = writable<UpdateStatus>({ state: "idle" })
