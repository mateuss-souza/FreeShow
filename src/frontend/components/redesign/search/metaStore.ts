import { writable } from "svelte/store"
import type { ShowMetaCache } from "../../../../types/ShowMetaCache"

// song credits of every show (artist, author, composer, key), kept by the main process with the text cache
export const showMetaCache = writable<ShowMetaCache>({})
