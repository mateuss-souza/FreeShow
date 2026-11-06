import { writable } from "svelte/store"
import type { ListenStatus } from "../../../types/Listen"

// live status of "Listen" (audio to phones), pushed by the main process
export const listenStatus = writable<ListenStatus | null>(null)
