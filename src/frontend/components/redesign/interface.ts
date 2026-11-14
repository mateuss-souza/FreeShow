import { derived } from "svelte/store"
import { special } from "../../stores"

// "Interface: Classic / New" (Settings › General). Classic is upstream FreeShow; New turns on the redesign.
export const newInterface = derived(special, (s) => s?.interface === "new")
