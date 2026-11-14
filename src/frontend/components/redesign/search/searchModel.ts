// Library search for the redesigned Search palette: titles, lyrics and artists, accent- and case-insensitive.
// Pure functions (no stores), so they are tested on their own.

import type { ShowMetaCache, ShowMetaEntry } from "../../../../types/ShowMetaCache"

export interface SearchShow {
    id: string
    name: string
    category?: string | null
    private?: boolean
    timestamps?: { used?: number | null; modified?: number | null }
}

/** a piece of text, highlighted when it matched */
export interface Part {
    text: string
    hit: boolean
}

export interface TitleResult {
    id: string
    name: string
    parts: Part[]
    meta: ShowMetaEntry
    used: number
}

export interface LyricsResult {
    id: string
    name: string
    /** the lyrics around the match */
    parts: Part[]
    /** the match in normalized form, to find the slide once the show is loaded */
    needle: string
}

export type ArtistRole = "artist" | "author"

export interface ArtistResult {
    key: string
    name: string
    parts: Part[]
    role: ArtistRole
    showIds: string[]
}

export interface LibrarySearch {
    titles: TitleResult[]
    lyrics: LyricsResult[]
    artists: ArtistResult[]
    counts: { titles: number; lyrics: number; artists: number }
}

export const MAX_RESULTS = 25

// NORMALIZING

const specialChars = /[.,\/#!?$%\^&\*;:{}=\-_'"´`~()[\]«»“”‘’¿¡]/g

/** lower case, no accents, no punctuation, single spaces */
export function normalize(value: string): string {
    return (value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(specialChars, "")
        .replace(/\s+/g, " ")
}

/** normalized text with, for each of its characters, the index of the source character it came from */
export function normalizeWithMap(raw: string): { text: string; map: number[] } {
    let text = ""
    const map: number[] = []
    let lastSpace = false
    for (let i = 0; i < raw.length; i++) {
        let piece = raw[i]
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .replace(specialChars, "")
        if (/\s/.test(piece)) {
            if (lastSpace) continue
            piece = " "
        }
        for (const char of piece) {
            text += char
            map.push(i)
        }
        if (piece) lastSpace = piece === " "
    }
    return { text, map }
}

export function tokens(query: string): string[] {
    return normalize(query).split(" ").filter(Boolean)
}

/** splits text into parts, marking every place where one of the tokens occurs */
export function highlight(raw: string, queryTokens: string[]): Part[] {
    if (!raw) return []
    if (!queryTokens.length) return [{ text: raw, hit: false }]
    const { text, map } = normalizeWithMap(raw)
    const marked = new Array(raw.length).fill(false)
    for (const token of queryTokens) {
        let from = 0
        let found = text.indexOf(token, from)
        while (found >= 0) {
            const start = map[found]
            const end = map[found + token.length - 1]
            for (let i = start; i <= end; i++) marked[i] = true
            from = found + token.length
            found = text.indexOf(token, from)
        }
    }
    const parts: Part[] = []
    for (let i = 0; i < raw.length; i++) {
        const last = parts[parts.length - 1]
        if (last && last.hit === marked[i]) last.text += raw[i]
        else parts.push({ text: raw[i], hit: marked[i] })
    }
    return parts
}

// keep normalized lyrics until the text changes (the whole library is scanned on every keystroke)
const lyricsCache = new Map<string, { raw: string; text: string }>()
function normalizedLyrics(id: string, raw: string) {
    const cached = lyricsCache.get(id)
    if (cached && cached.raw === raw) return cached.text
    const text = normalize(raw)
    lyricsCache.set(id, { raw, text })
    return text
}

// ARTISTS

/** one credit field can hold several people: "A, B & C" */
export function splitNames(value: string): string[] {
    return (value || "")
        .split(/\s*(?:[,;|\/&]|\s+feat\.?\s+|\s+ft\.?\s+)\s*/i)
        .map((n) => n.trim())
        .filter((n) => n.length > 1)
}

export function buildArtistIndex(shows: SearchShow[], meta: ShowMetaCache) {
    const index = new Map<string, { name: string; artist: number; author: number; showIds: Set<string> }>()
    for (const show of shows) {
        const entry = meta[show.id]
        if (!entry) continue
        const credits: [string | undefined, ArtistRole][] = [
            [entry.artist, "artist"],
            [entry.author, "author"],
            [entry.composer, "author"]
        ]
        for (const [value, role] of credits) {
            for (const name of splitNames(value || "")) {
                const key = normalize(name)
                if (!key) continue
                let item = index.get(key)
                if (!item) {
                    item = { name, artist: 0, author: 0, showIds: new Set() }
                    index.set(key, item)
                }
                item[role]++
                item.showIds.add(show.id)
            }
        }
    }
    return index
}

// SEARCH

function titleScore(name: string, queryTokens: string[], phrase: string) {
    if (name === phrase) return 4
    if (name.startsWith(phrase)) return 3
    if (name.split(" ").some((word) => word.startsWith(queryTokens[0]))) return 2
    return 1
}

export function searchLibrary(input: { query: string; shows: SearchShow[]; text: { [id: string]: string }; meta: ShowMetaCache; artistKey?: string | null }): LibrarySearch {
    const { shows, text, meta } = input
    const queryTokens = tokens(input.query)
    const phrase = queryTokens.join(" ")
    const visible = shows.filter((s) => s?.id && s.name && !s.private)
    const artistIndex = buildArtistIndex(visible, meta)
    const byId = new Map(visible.map((s) => [s.id, s]))

    const toTitle = (show: SearchShow): TitleResult => ({ id: show.id, name: show.name, parts: highlight(show.name, queryTokens), meta: meta[show.id] || {}, used: show.timestamps?.used || 0 })

    // all songs of one artist ("See all songs")
    if (input.artistKey) {
        const artist = artistIndex.get(input.artistKey)
        const list = [...(artist?.showIds || [])]
            .map((id) => byId.get(id))
            .filter((s): s is SearchShow => !!s && (!queryTokens.length || queryTokens.every((t) => normalize(s.name).includes(t))))
            .sort((a, b) => a.name.localeCompare(b.name))
        return { titles: list.map(toTitle), lyrics: [], artists: [], counts: { titles: list.length, lyrics: 0, artists: 0 } }
    }

    if (!queryTokens.length) return { titles: [], lyrics: [], artists: [], counts: { titles: 0, lyrics: 0, artists: 0 } }

    // titles: every word of the query in the title
    const titleMatches: { show: SearchShow; score: number }[] = []
    for (const show of visible) {
        const name = normalize(show.name)
        if (queryTokens.every((t) => name.includes(t))) titleMatches.push({ show, score: titleScore(name, queryTokens, phrase) })
    }
    titleMatches.sort((a, b) => b.score - a.score || (b.show.timestamps?.used || 0) - (a.show.timestamps?.used || 0) || a.show.name.localeCompare(b.show.name))

    // lyrics: the query as a phrase (two letters is too short to mean anything in a song)
    const lyricsMatches: { show: SearchShow; position: number }[] = []
    if (phrase.length >= 3) {
        for (const show of visible) {
            const raw = text[show.id]
            if (!raw) continue
            const position = normalizedLyrics(show.id, raw).indexOf(phrase)
            if (position >= 0) lyricsMatches.push({ show, position })
        }
        lyricsMatches.sort((a, b) => (b.show.timestamps?.used || 0) - (a.show.timestamps?.used || 0) || a.show.name.localeCompare(b.show.name))
    }

    // artists and bands
    const artistMatches: ArtistResult[] = []
    for (const [key, item] of artistIndex) {
        if (!queryTokens.every((t) => key.includes(t))) continue
        artistMatches.push({ key, name: item.name, parts: highlight(item.name, queryTokens), role: item.artist >= item.author ? "artist" : "author", showIds: [...item.showIds] })
    }
    artistMatches.sort((a, b) => Number(b.key.startsWith(phrase)) - Number(a.key.startsWith(phrase)) || b.showIds.length - a.showIds.length || a.name.localeCompare(b.name))

    return {
        titles: titleMatches.slice(0, MAX_RESULTS).map((m) => toTitle(m.show)),
        lyrics: lyricsMatches.slice(0, MAX_RESULTS).map((m) => ({ id: m.show.id, name: m.show.name, parts: snippet(text[m.show.id], queryTokens, phrase), needle: phrase })),
        artists: artistMatches.slice(0, MAX_RESULTS),
        counts: { titles: titleMatches.length, lyrics: lyricsMatches.length, artists: artistMatches.length }
    }
}

/** the lyrics around the first match, cut at word boundaries */
export function snippet(raw: string, queryTokens: string[], phrase: string, around = 42): Part[] {
    const { text, map } = normalizeWithMap(raw)
    const found = text.indexOf(phrase)
    if (found < 0) return highlight(raw.slice(0, around * 2), queryTokens)
    let start = Math.max(0, map[found] - around)
    let end = Math.min(raw.length, map[found + phrase.length - 1] + 1 + around)
    if (start > 0) start = raw.indexOf(" ", start) + 1 || start
    if (end < raw.length) end = raw.lastIndexOf(" ", end) > map[found] ? raw.lastIndexOf(" ", end) : end
    const piece = raw.slice(start, end).trim()
    const parts = highlight(piece, [phrase])
    if (start > 0) parts.unshift({ text: "…", hit: false })
    if (end < raw.length) parts.push({ text: "…", hit: false })
    return parts
}

/** the slide whose text holds the match, once the show is loaded */
export function findSlideIndex(slideTexts: string[], needle: string): number {
    const target = normalize(needle)
    if (!target) return -1
    return slideTexts.findIndex((t) => normalize(t).includes(target))
}

export function initials(name: string): string {
    const words = name.split(/\s+/).filter((w) => /\p{L}/u.test(w))
    return ((words[0]?.[0] || "") + (words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] || "")).toUpperCase()
}
