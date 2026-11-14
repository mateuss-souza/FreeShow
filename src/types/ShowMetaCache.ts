// Song credits of every show, cached by the main process so search can find songs by artist, author or
// composer without loading each show (the shows list only carries name, category and timestamps).
export interface ShowMetaEntry {
    artist?: string
    author?: string
    composer?: string
    key?: string
}

export type ShowMetaCache = { [showId: string]: ShowMetaEntry }

/** the credits of a show (empty object when it has none, so it isn't read again on every startup) */
export function getShowMetaEntry(show: { meta?: { [key: string]: any } } | null | undefined): ShowMetaEntry {
    const meta = show?.meta || {}
    const entry: ShowMetaEntry = {}
    for (const key of ["artist", "author", "composer", "key"] as const) {
        const value = typeof meta[key] === "string" ? meta[key].trim() : ""
        if (value) entry[key] = value.slice(0, 200)
    }
    return entry
}
