<script lang="ts">
    // Show tools tab: the playback recordings of this show, one per YouTube version of the song.
    import type { PlaybackSyncEvent } from "../../../types/PlaybackSync"
    import { activeShow, showsCache } from "../../stores"
    import { translateText } from "../../utils/language"
    import Icon from "../helpers/Icon.svelte"
    import T from "../helpers/T.svelte"
    import { _show } from "../helpers/shows"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import MaterialNumberInput from "../inputs/MaterialNumberInput.svelte"
    import MaterialTextInput from "../inputs/MaterialTextInput.svelte"
    import { createSync, deleteSync, openSession, playerControl, recordingEvents, syncSession, updateSync } from "./playbackSync"
    import { formatTime, parseYouTubeId } from "./syncMath"

    $: showId = $activeShow?.id || ""
    $: show = $showsCache[showId]
    $: syncs = Object.values(show?.playbackSyncs || {}).sort((a, b) => a.name.localeCompare(b.name))

    let selectedId = ""
    $: if (syncs.length && !syncs.find((s) => s.id === selectedId)) selectedId = syncs[0].id
    $: if (!syncs.length) selectedId = ""
    $: selected = syncs.find((s) => s.id === selectedId) || null

    // NEW RECORDING

    let adding = false
    let newName = ""
    let newUrl = ""
    $: newVideoId = parseYouTubeId(newUrl)

    function startAdding() {
        adding = true
        newName = syncs.length ? "" : translateText("playback_sync.default_name")
        newUrl = ""
    }

    function add() {
        if (!showId || !newVideoId) return
        selectedId = createSync(showId, newName.trim() || translateText("playback_sync.default_name"), newUrl.trim(), newVideoId)
        adding = false
    }

    function setLink(url: string) {
        if (!selected) return
        const videoId = parseYouTubeId(url)
        if (!videoId) return
        updateSync(showId, selected.id, { url: url.trim(), videoId })
        // a different video means a different timing: reopen the player on it
        if ($syncSession?.syncId === selected.id) openSession(showId, selected.id)
    }

    function remove() {
        if (!selected) return
        deleteSync(showId, selected.id)
    }

    // EVENTS

    $: isOpen = !!selected && $syncSession?.showId === showId && $syncSession?.syncId === selected?.id
    $: isRecording = isOpen && $syncSession?.mode === "recording"
    $: events = isRecording ? $recordingEvents : selected?.events || []

    function slideLabel(event: PlaybackSyncEvent) {
        if (event.clear) return translateText("playback_sync.cleared")
        const layout = event.layout || selected?.layoutId || show?.settings?.activeLayout
        const ref = layout ? _show(showId).layouts([layout]).ref()[0] || [] : []
        const slideRef = ref[event.index]
        const slide = slideRef?.id ? show?.slides?.[slideRef.id] : null
        const parentId = slideRef?.parent?.id
        const parent = parentId ? show?.slides?.[parentId] : null
        const group = slide?.group || parent?.group || ""
        return `${event.index + 1}${group ? " · " + group : ""}${event.line ? " · " + translateText("playback_sync.line") + " " + (event.line + 1) : ""}`
    }

    // the template only calls these while a recording is selected
    function rename(name: string) {
        if (selected) updateSync(showId, selected.id, { name })
    }
    function setAnticipate(seconds: number) {
        if (selected) updateSync(showId, selected.id, { anticipate: seconds })
    }
    function openPlayer() {
        if (selected) openSession(showId, selected.id)
    }

    function removeEvent(index: number) {
        if (!selected) return
        updateSync(showId, selected.id, { events: selected.events.filter((_, i) => i !== index) })
    }

    function nudge(index: number, delta: number) {
        if (!selected) return
        const list = selected.events.map((e, i) => (i === index ? { ...e, t: Math.max(0, Math.round((e.t + delta) * 100) / 100) } : e))
        updateSync(showId, selected.id, { events: list.sort((a, b) => a.t - b.t) })
    }
</script>

<div class="panel">
    <p class="intro"><T id="playback_sync.intro" /></p>

    {#if syncs.length}
        <div class="list" role="radiogroup" aria-label={translateText("playback_sync.recordings")}>
            {#each syncs as sync (sync.id)}
                <button class="sync" class:active={sync.id === selectedId} role="radio" aria-checked={sync.id === selectedId} on:click={() => (selectedId = sync.id)}>
                    <Icon id="youtube" size={1} white />
                    <span class="name">{sync.name}</span>
                    <span class="count">{sync.events?.length || 0}</span>
                </button>
            {/each}
        </div>
    {/if}

    {#if adding}
        <div class="box">
            <MaterialTextInput label="playback_sync.name" value={newName} placeholder={translateText("playback_sync.name_placeholder")} on:input={(e) => (newName = e.detail)} />
            <MaterialTextInput label="playback_sync.youtube_link" value={newUrl} placeholder="https://youtu.be/…" autofocus on:input={(e) => (newUrl = e.detail)} />
            {#if newUrl && !newVideoId}
                <p class="error"><T id="playback_sync.invalid_link" /></p>
            {/if}
            <div class="row">
                <MaterialButton variant="text" style="flex: 1;" on:click={() => (adding = false)}><T id="popup.cancel" /></MaterialButton>
                <MaterialButton variant="contained" style="flex: 1;" icon="add" disabled={!newVideoId} on:click={add}><T id="playback_sync.create" /></MaterialButton>
            </div>
        </div>
    {:else}
        <MaterialButton variant="outlined" icon="add" on:click={startAdding}><T id="playback_sync.new" /></MaterialButton>
    {/if}

    {#if selected && !adding}
        <div class="box">
            <MaterialTextInput label="playback_sync.name" value={selected.name} on:change={(e) => rename(e.detail)} />
            <MaterialTextInput label="playback_sync.youtube_link" value={selected.url} on:change={(e) => setLink(e.detail)} />
            <MaterialNumberInput label="playback_sync.anticipate" value={selected.anticipate ?? 0} defaultValue={0.25} min={0} max={3} step={0.05} on:change={(e) => setAnticipate(e.detail)} />

            <div class="row">
                {#if isOpen}
                    <MaterialButton variant="outlined" style="flex: 1;" icon="up" on:click={() => playerControl.seek(0)}><T id="playback_sync.to_start" /></MaterialButton>
                {:else}
                    <MaterialButton variant="contained" style="flex: 1;" icon="youtube" on:click={openPlayer}><T id="playback_sync.open_player" /></MaterialButton>
                {/if}
                <MaterialButton icon="delete" title="actions.delete" on:click={remove} />
            </div>
            {#if !events.length}
                <p class="hint"><T id="playback_sync.how_to" /></p>
            {/if}
        </div>

        {#if events.length}
            <div class="events" aria-label={translateText("playback_sync.changes")}>
                {#each events as event, i}
                    <div class="event">
                        <button class="time" title={translateText("playback_sync.seek_here")} disabled={!isOpen} on:click={() => playerControl.seek(event.t - 2)}>{formatTime(event.t)}</button>
                        <span class="label">{slideLabel(event)}</span>
                        {#if !isRecording}
                            <MaterialButton title="playback_sync.earlier" on:click={() => nudge(i, -0.1)}>−</MaterialButton>
                            <MaterialButton title="playback_sync.later" on:click={() => nudge(i, 0.1)}>+</MaterialButton>
                            <MaterialButton title="actions.delete" on:click={() => removeEvent(i)}><Icon id="close" size={0.9} white /></MaterialButton>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>

<style>
    .panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
    }
    .intro,
    .hint {
        font-size: 0.85em;
        opacity: 0.8;
        line-height: 1.4;
    }
    .list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .sync {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid var(--primary-lighter);
        background-color: transparent;
        color: var(--text);
        font: inherit;
        cursor: pointer;
        text-align: left;
    }
    .sync.active {
        border-color: var(--secondary);
        background-color: var(--primary-darker);
    }
    .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .count {
        font-size: 0.8em;
        opacity: 0.7;
    }
    .box {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        border-radius: 6px;
        background-color: var(--primary-darker);
    }
    .row {
        display: flex;
        gap: 6px;
        align-items: center;
    }
    .error {
        color: #ff8a8a;
        font-size: 0.85em;
    }
    .events {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .event {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.85em;
    }
    .event .time {
        font-family: monospace;
        min-width: 58px;
        padding: 4px;
        border: none;
        border-radius: 4px;
        background-color: var(--primary-darker);
        color: var(--text);
        cursor: pointer;
    }
    .event .time:disabled {
        cursor: default;
        opacity: 0.8;
    }
    .event .label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
