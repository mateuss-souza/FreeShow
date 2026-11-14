<script lang="ts">
    // Redesign › Search: one box for song titles, lyrics, and artists and bands.
    // Ctrl+F (new interface) or the magnifying glass in the top bar opens it.
    import { tick } from "svelte"
    import { fade, scale } from "svelte/transition"
    import { shows, textCache } from "../../../stores"
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import T from "../../helpers/T.svelte"
    import { timeAgo } from "../../helpers/time"
    import { showMetaCache } from "./metaStore"
    import { addToRundown, openAtSlide, searchPaletteOpen, showNow } from "./searchActions"
    import { initials, searchLibrary, type Part } from "./searchModel"

    type Filter = "all" | "titles" | "lyrics" | "artists"

    let query = ""
    let filter: Filter = "all"
    let artist: { key: string; name: string } | null = null
    let input: HTMLInputElement
    let selectedIndex = 0
    let listEl: HTMLElement

    $: if ($searchPaletteOpen) focusInput()
    async function focusInput() {
        await tick()
        input?.focus()
        input?.select()
    }

    // debounce a little: the whole library is scanned
    let debounced = ""
    let timer: NodeJS.Timeout | null = null
    $: scheduleSearch(query)
    function scheduleSearch(value: string) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => (debounced = value), 80)
    }

    $: showList = Object.entries($shows).map(([id, s]) => ({ id, name: s.name, category: s.category, private: s.private, timestamps: s.timestamps }))
    $: results = searchLibrary({ query: debounced, shows: showList, text: $textCache || {}, meta: $showMetaCache || {}, artistKey: artist?.key })

    $: showTitles = filter === "all" || filter === "titles" || !!artist
    $: showLyrics = !artist && (filter === "all" || filter === "lyrics")
    $: showArtists = !artist && (filter === "all" || filter === "artists")

    // one flat list for the arrow keys
    type Row = { kind: "title"; id: string } | { kind: "lyrics"; id: string; needle: string } | { kind: "artist"; key: string; name: string }
    $: rows = [...(showTitles ? results.titles.map((r) => ({ kind: "title", id: r.id }) as Row) : []), ...(showLyrics ? results.lyrics.map((r) => ({ kind: "lyrics", id: r.id, needle: r.needle }) as Row) : []), ...(showArtists ? results.artists.map((r) => ({ kind: "artist", key: r.key, name: r.name }) as Row) : [])]
    $: if (rows) selectedIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1))
    $: titleOffset = 0
    $: lyricsOffset = showTitles ? results.titles.length : 0
    $: artistOffset = lyricsOffset + (showLyrics ? results.lyrics.length : 0)

    const filters: { id: Filter; label: string; count: () => number }[] = [
        { id: "all", label: "redesign.search_all", count: () => results.counts.titles + results.counts.lyrics + results.counts.artists },
        { id: "titles", label: "redesign.search_titles", count: () => results.counts.titles },
        { id: "lyrics", label: "redesign.search_lyrics", count: () => results.counts.lyrics },
        { id: "artists", label: "redesign.search_artists", count: () => results.counts.artists }
    ]

    function close() {
        searchPaletteOpen.set(false)
    }

    function run(row: Row | undefined, now = false) {
        if (!row) return
        if (row.kind === "artist") {
            seeAll(row.key, row.name)
            return
        }
        if (row.kind === "lyrics" && !now) {
            openAtSlide(row.id, row.needle)
            close()
            return
        }
        if (now) {
            showNow(row.id)
            close()
            return
        }
        addToRundown(row.id)
    }

    function seeAll(key: string, name: string) {
        artist = { key, name }
        query = ""
        debounced = ""
        selectedIndex = 0
        focusInput()
    }

    function keydown(e: KeyboardEvent) {
        // the app's own shortcuts (arrows change slides, Enter...) must not see keys typed here
        if (["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(e.key)) e.stopPropagation()
        if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            if (artist) artist = null
            else close()
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            selectedIndex = Math.min(rows.length - 1, selectedIndex + 1)
            scrollToSelected()
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            selectedIndex = Math.max(0, selectedIndex - 1)
            scrollToSelected()
        } else if (e.key === "Enter") {
            e.preventDefault()
            run(rows[selectedIndex], e.shiftKey)
        } else if (e.key === "Backspace" && !query && artist) {
            artist = null
        }
    }

    async function scrollToSelected() {
        await tick()
        listEl?.querySelector(".row.selected")?.scrollIntoView({ block: "nearest" })
    }

    function metaLine(meta: { artist?: string; author?: string; key?: string }, used: number) {
        const pieces = [meta.artist || meta.author || "", meta.key ? translateText("redesign.search_key") + " " + meta.key : "", used ? translateText("redesign.search_used") + " " + timeAgo(used) : ""]
        return pieces.filter(Boolean).join(" · ")
    }
    const plain = (parts: Part[]) => parts.map((p) => p.text).join("")
</script>

{#if $searchPaletteOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="backdrop" transition:fade={{ duration: 100 }} on:click={close}></div>
    <section class="palette" role="dialog" aria-modal="true" aria-label={translateText("redesign.search_label")} transition:scale={{ start: 0.98, duration: 120 }} on:keydown={keydown}>
        <div class="searchbar">
            <Icon id="search" size={1.4} white />
            {#if artist}
                <button class="tag" title={translateText("redesign.search_clear_artist")} on:click={() => (artist = null)}>{artist.name} ×</button>
            {/if}
            <label class="sr" for="redesign-search">{translateText("redesign.search_label")}</label>
            <input id="redesign-search" bind:this={input} bind:value={query} placeholder={artist ? translateText("redesign.search_in_artist") : translateText("redesign.search_label")} autocomplete="off" spellcheck="false" />
            <kbd>Esc</kbd>
        </div>

        {#if !artist}
            <div class="chips" role="tablist" aria-label={translateText("redesign.search_in")}>
                {#each filters as f (f.id)}
                    <button role="tab" aria-selected={filter === f.id} class:active={filter === f.id} on:click={() => ((filter = f.id), (selectedIndex = 0), input?.focus())}>
                        <T id={f.label} />
                        {#if debounced.trim()}<span class="count">{f.count()}</span>{/if}
                    </button>
                {/each}
            </div>
        {/if}

        <div class="results" bind:this={listEl}>
            {#if !debounced.trim() && !artist}
                <p class="empty"><T id="redesign.search_hint" /></p>
            {:else if !rows.length}
                <p class="empty"><T id="redesign.search_nothing" /></p>
            {/if}

            {#if showTitles && results.titles.length}
                <h2>{artist ? artist.name : translateText("redesign.search_titles")}</h2>
                {#each results.titles as r, i (r.id)}
                    <!-- svelte-ignore a11y-no-static-element-interactions a11y-mouse-events-have-key-events -->
                    <div class="row" class:selected={selectedIndex === titleOffset + i} on:mouseenter={() => (selectedIndex = titleOffset + i)}>
                        <span class="icon"><Icon id="music" size={1} white /></span>
                        <span class="body">
                            <span class="main"
                                >{#each r.parts as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span
                            >
                            <span class="sub">{metaLine(r.meta, r.used)}</span>
                        </span>
                        <button class="secondary" on:click={() => addToRundown(r.id)}><T id="redesign.search_add" /></button>
                        <button class="present" on:click={() => (showNow(r.id), close())}><T id="redesign.search_show_now" /></button>
                    </div>
                {/each}
            {/if}

            {#if showLyrics && results.lyrics.length}
                <h2><T id="redesign.search_in_lyrics" /></h2>
                {#each results.lyrics as r, i (r.id)}
                    <!-- svelte-ignore a11y-no-static-element-interactions a11y-mouse-events-have-key-events -->
                    <div class="row" class:selected={selectedIndex === lyricsOffset + i} on:mouseenter={() => (selectedIndex = lyricsOffset + i)}>
                        <span class="icon"><Icon id="lyrics" size={1} white /></span>
                        <span class="body">
                            <span class="main">{r.name}</span>
                            <span class="quote" title={plain(r.parts)}
                                >“{#each r.parts as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}”</span
                            >
                        </span>
                        <button class="secondary" on:click={() => (openAtSlide(r.id, r.needle), close())}><T id="redesign.search_open_slide" /></button>
                    </div>
                {/each}
            {/if}

            {#if showArtists && results.artists.length}
                <h2><T id="redesign.search_artists" /></h2>
                {#each results.artists as r, i (r.key)}
                    <!-- svelte-ignore a11y-no-static-element-interactions a11y-mouse-events-have-key-events -->
                    <div class="row" class:selected={selectedIndex === artistOffset + i} on:mouseenter={() => (selectedIndex = artistOffset + i)}>
                        <span class="avatar" aria-hidden="true">{initials(r.name)}</span>
                        <span class="body">
                            <span class="main"
                                >{#each r.parts as p}{#if p.hit}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span
                            >
                            <span class="sub">{translateText(r.role === "artist" ? "redesign.search_band" : "redesign.search_author")} · {r.showIds.length} {translateText("redesign.search_songs_in_library")}</span>
                        </span>
                        <button class="secondary" on:click={() => seeAll(r.key, r.name)}><T id="redesign.search_see_all" /></button>
                    </div>
                {/each}
            {/if}
        </div>

        <footer>
            <span><kbd>↑ ↓</kbd> <T id="redesign.search_move" /></span>
            <span><kbd>Enter</kbd> <T id="redesign.search_add" /></span>
            <span><kbd>Shift Enter</kbd> <T id="redesign.search_show_now" /></span>
        </footer>
    </section>
{/if}

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 5500;
        background-color: rgba(0, 0, 0, 0.5);
    }
    .palette {
        position: fixed;
        z-index: 5501;
        top: 9vh;
        left: 50%;
        transform: translateX(-50%);
        width: min(820px, calc(100vw - 32px));
        max-height: 78vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-radius: 14px;
        background-color: var(--primary);
        border: 1px solid var(--primary-lighter);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
        color: var(--text);
    }
    .searchbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 18px;
        border-bottom: 1px solid var(--primary-lighter);
    }
    .searchbar input {
        flex: 1;
        min-width: 0;
        height: 40px;
        border: none;
        outline: none;
        background: transparent;
        color: var(--text);
        font-size: 1.35em;
        font-family: inherit;
    }
    .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
    }
    kbd {
        font-family: monospace;
        font-size: 0.8em;
        padding: 2px 6px;
        border-radius: 5px;
        border: 1px solid var(--primary-lighter);
        opacity: 0.8;
    }
    .tag {
        padding: 4px 10px;
        border-radius: 8px;
        border: 1px solid var(--secondary);
        background-color: var(--primary-darker);
        color: var(--text);
        font: inherit;
        white-space: nowrap;
        cursor: pointer;
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 10px 18px;
        border-bottom: 1px solid var(--primary-lighter);
    }
    .chips button {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border-radius: 8px;
        border: 1px solid var(--primary-lighter);
        background: transparent;
        color: var(--text);
        font: inherit;
        opacity: 0.8;
        cursor: pointer;
    }
    .chips button.active {
        opacity: 1;
        background-color: var(--primary-darker);
        border-color: var(--secondary);
    }
    .count {
        font-family: monospace;
        font-size: 0.85em;
        opacity: 0.75;
    }
    .results {
        flex: 1;
        overflow-y: auto;
        padding: 6px 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    h2 {
        margin: 12px 8px 4px;
        font-size: 0.75em;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        opacity: 0.7;
    }
    .empty {
        padding: 24px 12px;
        text-align: center;
        opacity: 0.7;
    }
    .row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 48px;
        padding: 6px 8px;
        border-radius: 10px;
        border: 1px solid transparent;
    }
    .row.selected {
        background-color: var(--primary-darker);
        border-color: var(--secondary);
    }
    .icon,
    .avatar {
        width: 34px;
        height: 34px;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background-color: var(--primary-darkest);
    }
    .avatar {
        border-radius: 50%;
        font-size: 0.8em;
        font-weight: 600;
    }
    .body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .main {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .sub,
    .quote {
        font-size: 0.85em;
        opacity: 0.75;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .quote {
        opacity: 0.9;
    }
    mark {
        background-color: var(--secondary-opacity, rgba(240, 0, 140, 0.3));
        color: inherit;
        border-radius: 3px;
        padding: 0 1px;
        font-weight: 600;
    }
    .row button {
        height: 34px;
        padding: 0 12px;
        border-radius: 8px;
        font: inherit;
        font-size: 0.85em;
        cursor: pointer;
        white-space: nowrap;
        color: var(--text);
    }
    .secondary {
        border: 1px solid var(--primary-lighter);
        background: transparent;
    }
    .present {
        border: 1px solid var(--secondary);
        background-color: var(--secondary);
        color: var(--secondary-text, var(--text)) !important;
        font-weight: 600;
    }
    footer {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        padding: 10px 18px;
        border-top: 1px solid var(--primary-lighter);
        font-size: 0.8em;
        opacity: 0.8;
    }
</style>
