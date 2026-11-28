<script lang="ts">
    // Timeline under the playback video: one dot per slide change (slide number inside), the playhead,
    // click to seek, drag a dot to move that change.
    import type { PlaybackSyncEvent } from "../../../types/PlaybackSync"
    import { translateText } from "../../utils/language"
    import { playerControl, recordingEvents, syncClock, syncSession, updateSync } from "./playbackSync"
    import { formatTime } from "./syncMath"

    export let showId: string
    export let syncId: string
    export let events: PlaybackSyncEvent[] = []

    $: recording = $syncSession?.mode === "recording"
    $: list = recording ? $recordingEvents : events
    $: duration = Math.max($syncClock.duration || 0, ...list.map((e) => e.t + 1), 1)
    $: pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`

    let bar: HTMLElement
    const timeAt = (clientX: number) => {
        const rect = bar.getBoundingClientRect()
        return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
    }

    function seek(e: PointerEvent) {
        if (dragging) return
        playerControl.seek(timeAt(e.clientX))
    }

    // DRAG
    let dragging: { index: number; t: number; moved: boolean } | null = null
    function startDrag(e: PointerEvent, index: number) {
        e.stopPropagation()
        if (recording) return
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        dragging = { index, t: list[index].t, moved: false }
    }
    function moveDrag(e: PointerEvent) {
        if (!dragging) return
        dragging = { ...dragging, t: Math.round(timeAt(e.clientX) * 20) / 20, moved: true }
    }
    function endDrag() {
        if (!dragging) return
        const { index, t, moved } = dragging
        dragging = null
        if (!moved) {
            // a click on a dot: hear it from just before that change
            playerControl.seek(Math.max(0, list[index].t - 2))
            return
        }
        const next = list.map((e, i) => (i === index ? { ...e, t } : e)).sort((a, b) => a.t - b.t)
        updateSync(showId, syncId, { events: next })
    }

    const label = (e: PlaybackSyncEvent) => (e.clear ? "×" : String(e.index + 1))
    $: shownTime = (i: number) => (dragging?.index === i ? dragging.t : list[i].t)
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="timeline" bind:this={bar} on:pointerdown={seek} on:pointermove={moveDrag} on:pointerup={endDrag} on:pointercancel={endDrag} title={translateText("playback_sync.timeline_tip")}>
    <div class="track"></div>
    <div class="played" style="width: {pct($syncClock.time)};"></div>
    {#each list as event, i}
        <button class="dot" class:clear={event.clear} class:active={dragging?.index === i} style="left: {pct(shownTime(i))};" title="{label(event)} · {formatTime(shownTime(i))}" aria-label="{translateText('playback_sync.change')} {label(event)}, {formatTime(shownTime(i))}" on:pointerdown={(e) => startDrag(e, i)}>
            {label(event)}
        </button>
    {/each}
    <div class="playhead" style="left: {pct($syncClock.time)};"></div>
    {#if dragging}
        <span class="dragTime" style="left: {pct(dragging.t)};">{formatTime(dragging.t)}</span>
    {/if}
</div>

<style>
    .timeline {
        position: relative;
        height: 40px;
        margin: 4px 10px 2px;
        cursor: pointer;
        touch-action: none;
    }
    .track,
    .played {
        position: absolute;
        left: 0;
        top: 50%;
        height: 4px;
        transform: translateY(-50%);
        border-radius: 2px;
    }
    .track {
        right: 0;
        background-color: var(--primary-lighter);
    }
    .played {
        background-color: #ff4444;
    }
    .playhead {
        position: absolute;
        top: 50%;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: #ff4444;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 3;
    }
    .dot {
        position: absolute;
        top: 50%;
        min-width: 22px;
        height: 22px;
        padding: 0 4px;
        transform: translate(-50%, -50%);
        border-radius: 11px;
        border: 2px solid var(--primary-darkest);
        background-color: var(--secondary);
        color: var(--secondary-text, white);
        font-size: 0.7em;
        font-weight: 700;
        line-height: 1;
        cursor: grab;
        z-index: 2;
    }
    .dot.clear {
        background-color: var(--primary-lighter);
        color: var(--text);
    }
    .dot.active {
        cursor: grabbing;
        z-index: 4;
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.35);
    }
    .dragTime {
        position: absolute;
        top: -6px;
        transform: translateX(-50%);
        font-family: monospace;
        font-size: 0.75em;
        background-color: var(--primary-darkest);
        padding: 1px 4px;
        border-radius: 4px;
        pointer-events: none;
        z-index: 5;
    }
</style>
