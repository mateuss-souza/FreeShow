<script lang="ts">
    // Visual setup of a blend group, in the spirit of ProPresenter's screen configuration:
    // the Windows displays as they are arranged, the blended image with its projectors and overlaps
    // (drag to change an overlap), and one-click test patterns.
    import { onMount } from "svelte"
    import { OUTPUT } from "../../../types/Channels"
    import { Main } from "../../../types/IPC/Main"
    import type { BlendGroupConfig, BlendGroupMember, BlendPattern } from "../../../types/Output"
    import { requestMain } from "../../IPC/main"
    import { outputs } from "../../stores"
    import { translateText } from "../../utils/language"
    import { send } from "../../utils/request"
    import T from "../helpers/T.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import { assignBlendDisplay, setBlendOverlap, setBlendPattern, syncBlendSize, type DisplayInfo } from "../output/blend/blendGroups"
    import { canvasSize, getSlices } from "../output/blend/blendMath"

    export let group: BlendGroupMember
    export let config: BlendGroupConfig
    /** the projector being adjusted (shared with the fields below) */
    export let projector = 0

    // WINDOWS DISPLAYS

    let displays: (DisplayInfo & { primary?: boolean })[] = []
    async function loadDisplays() {
        const list: any[] = (await requestMain(Main.GET_DISPLAYS)) || []
        displays = list.map((d) => ({ id: d.id, label: d.label, bounds: d.bounds, scaleFactor: d.scaleFactor }))
    }
    onMount(loadDisplays)

    $: memberIds = group.members
    $: displayOf = (index: number) => {
        const output = $outputs[memberIds[index]]
        return displays.find((d) => String(d.id) === String(output?.screen)) || displays.find((d) => sameBounds(d.bounds, output?.bounds)) || null
    }
    const sameBounds = (a: any, b: any) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
    $: projectorOn = (display: DisplayInfo) => memberIds.findIndex((_, i) => displayOf(i)?.id === display.id)

    // the displays drawn to scale in a box
    const MAP_W = 520
    const MAP_H = 150
    $: mapBox = (() => {
        if (!displays.length) return { minX: 0, minY: 0, scale: 1 }
        const minX = Math.min(...displays.map((d) => d.bounds.x))
        const minY = Math.min(...displays.map((d) => d.bounds.y))
        const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width))
        const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height))
        return { minX, minY, scale: Math.min(MAP_W / (maxX - minX), MAP_H / (maxY - minY)) }
    })()
    const physical = (d: DisplayInfo) => `${Math.round(d.bounds.width * (d.scaleFactor || 1))} × ${Math.round(d.bounds.height * (d.scaleFactor || 1))}`

    function pickDisplay(display: DisplayInfo) {
        assignBlendDisplay(group.groupId, projector, display)
        // next click goes to the next projector, so 1-2-3 is three clicks
        if (projector < memberIds.length - 1) projector++
    }

    function identify() {
        send(
            OUTPUT,
            ["IDENTIFY_SCREENS"],
            displays.map((d) => ({ bounds: d.bounds }))
        )
    }

    // projectors on a display scaled by Windows land in the wrong place
    $: scaled = memberIds.map((_, i) => displayOf(i)).filter((d) => d && (d.scaleFactor || 1) !== 1) as DisplayInfo[]
    // the group's projector size doesn't match its displays (e.g. after changing Windows scale)
    $: firstDisplay = displayOf(0)
    $: sizeMismatch = !!firstDisplay && (firstDisplay.bounds.width !== (config.displayWidth || config.projectorWidth) || firstDisplay.bounds.height !== (config.displayHeight || config.projectorHeight))

    // BLENDED IMAGE

    $: size = canvasSize(config)
    $: slices = getSlices(config)
    const STRIP_W = 520
    $: stripScale = STRIP_W / size.width
    $: stripH = Math.max(60, Math.round(size.height * stripScale))

    let dragging: { seam: number; startX: number; start: number } | null = null
    function startDrag(e: PointerEvent, seam: number) {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        dragging = { seam, startX: e.clientX, start: config.overlaps[seam] }
    }
    let frame = 0
    function moveDrag(e: PointerEvent) {
        if (!dragging) return
        const { seam, startX, start } = dragging
        // dragging the next projector to the left makes the overlap wider
        const value = Math.round(Math.max(0, Math.min(config.projectorWidth / 2, start - (e.clientX - startX) / stripScale)))
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => setBlendOverlap(group.groupId, seam, value))
    }
    function endDrag() {
        dragging = null
    }

    // TEST PATTERNS

    const patterns: { id: BlendPattern; label: string }[] = [
        { id: "none", label: "screen.blend_pattern_none" },
        { id: "grid", label: "screen.blend_pattern_grid" },
        { id: "white", label: "screen.blend_pattern_white" },
        { id: "gray", label: "screen.blend_pattern_gray" },
        { id: "black", label: "screen.blend_pattern_black" },
        { id: "guides", label: "screen.blend_pattern_guides" }
    ]
</script>

<section class="setup">
    <!-- 1. displays -->
    <div class="head">
        <span class="title"><T id="screen.blend_displays" /></span>
        <MaterialButton variant="text" icon="refresh" title="screen.blend_refresh_displays" on:click={loadDisplays} />
        <MaterialButton variant="outlined" on:click={identify}><T id="settings.identify_screens" /></MaterialButton>
    </div>
    <p class="hint"><T id="screen.blend_displays_tip" /> <b>{translateText("screen.blend_projector")} {projector + 1}</b></p>

    <div class="map" style="width: {MAP_W}px; height: {MAP_H}px;">
        {#each displays as display (display.id)}
            {@const on = projectorOn(display)}
            <button class="display" class:assigned={on >= 0} class:scaled={(display.scaleFactor || 1) !== 1} style="left: {(display.bounds.x - mapBox.minX) * mapBox.scale}px; top: {(display.bounds.y - mapBox.minY) * mapBox.scale}px; width: {display.bounds.width * mapBox.scale - 4}px; height: {display.bounds.height * mapBox.scale - 4}px;" title={display.label || ""} on:click={() => pickDisplay(display)}>
                {#if on >= 0}<span class="badge">{on + 1}</span>{/if}
                <span class="name">{display.label || translateText("screen.blend_display")}</span>
                <span class="res">{physical(display)}{(display.scaleFactor || 1) !== 1 ? ` · ${Math.round((display.scaleFactor || 1) * 100)}%` : ""}</span>
            </button>
        {/each}
    </div>

    {#if scaled.length}
        <p class="warning"><T id="screen.blend_scale_warning" /> ({Math.round((scaled[0].scaleFactor || 1) * 100)}%)</p>
    {/if}
    {#if sizeMismatch && firstDisplay}
        <div class="warning row">
            <span><T id="screen.blend_size_mismatch" /> {firstDisplay.bounds.width} × {firstDisplay.bounds.height}</span>
            <MaterialButton variant="outlined" on:click={() => firstDisplay && syncBlendSize(group.groupId, firstDisplay.bounds.width, firstDisplay.bounds.height)}><T id="screen.blend_use_display_size" /></MaterialButton>
        </div>
    {/if}

    <!-- 2. blended image -->
    <div class="head">
        <span class="title"><T id="screen.blend_canvas" />: {size.width} × {size.height}</span>
    </div>
    <p class="hint"><T id="screen.blend_strip_tip" /></p>

    <div class="strip" style="width: {STRIP_W}px; height: {stripH}px;" on:pointermove={moveDrag} on:pointerup={endDrag} on:pointercancel={endDrag}>
        {#each slices as slice, i}
            {@const display = displayOf(i)}
            <button class="projector" class:selected={projector === i} style="left: {slice.canvasX * stripScale}px; width: {slice.width * stripScale}px; top: {i % 2 ? 8 : 0}px; height: {stripH - 8}px;" on:click={() => (projector = i)}>
                <b>{i + 1}</b>
                <span>{$outputs[memberIds[i]]?.name || ""}</span>
                <span class="small">{display ? display.label || physical(display) : translateText("screen.blend_no_display")}</span>
            </button>
        {/each}
        {#each config.overlaps as overlap, seam}
            {@const next = slices[seam + 1]}
            {#if next}
                <div class="overlap" style="left: {next.canvasX * stripScale}px; width: {Math.max(2, overlap * stripScale)}px;"></div>
                <button class="handle" class:active={dragging?.seam === seam} style="left: {next.canvasX * stripScale - 9}px;" aria-label="{translateText('screen.blend_overlap')} {seam + 1}–{seam + 2}: {overlap}px" on:pointerdown={(e) => startDrag(e, seam)}></button>
                <span class="overlapValue" style="left: {(next.canvasX + overlap / 2) * stripScale}px;">{overlap}px</span>
            {/if}
        {/each}
    </div>

    <!-- 3. test patterns -->
    <div class="head">
        <span class="title"><T id="screen.blend_pattern" /></span>
    </div>
    <div class="patterns" role="radiogroup" aria-label={translateText("screen.blend_pattern")}>
        {#each patterns as pattern}
            <button role="radio" aria-checked={(group.pattern || "none") === pattern.id} class:active={(group.pattern || "none") === pattern.id} on:click={() => setBlendPattern(group.groupId, pattern.id)}>
                {translateText(pattern.label)}
            </button>
        {/each}
    </div>
</section>

<style>
    .setup {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 14px;
    }
    .head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
    }
    .title {
        flex: 1;
        font-weight: 600;
    }
    .hint {
        font-size: 0.85em;
        opacity: 0.8;
    }
    .map,
    .strip {
        position: relative;
        max-width: 100%;
        align-self: center;
        margin: 4px 0 8px;
    }
    .display {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 2px;
        border-radius: 4px;
        border: 2px solid var(--primary-lighter);
        background-color: var(--primary-darker);
        color: var(--text);
        font: inherit;
        font-size: 0.7em;
        overflow: hidden;
        cursor: pointer;
    }
    .display:hover {
        border-color: var(--secondary);
    }
    .display.assigned {
        background-color: var(--secondary-opacity, rgba(240, 0, 140, 0.25));
        border-color: var(--secondary);
    }
    .display.scaled .res {
        color: #f5b544;
    }
    .badge {
        font-size: 1.6em;
        font-weight: 700;
        line-height: 1;
    }
    .name,
    .res {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }
    .res {
        opacity: 0.8;
    }
    .warning {
        font-size: 0.85em;
        color: #f5b544;
        line-height: 1.4;
    }
    .warning.row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .warning.row span {
        flex: 1;
    }
    .strip {
        touch-action: none;
    }
    .projector {
        position: absolute;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        border-radius: 4px;
        border: 2px solid var(--primary-lighter);
        background-color: rgba(255, 255, 255, 0.06);
        color: var(--text);
        font: inherit;
        font-size: 0.75em;
        cursor: pointer;
        overflow: hidden;
    }
    .projector.selected {
        border-color: var(--secondary);
        background-color: rgba(255, 255, 255, 0.12);
    }
    .projector b {
        font-size: 1.6em;
    }
    .projector .small {
        opacity: 0.75;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 95%;
    }
    .overlap {
        position: absolute;
        top: 0;
        bottom: 0;
        pointer-events: none;
        background: repeating-linear-gradient(45deg, rgba(245, 181, 68, 0.35) 0 4px, rgba(245, 181, 68, 0.1) 4px 8px);
        border-left: 1px solid #f5b544;
        border-right: 1px solid #f5b544;
    }
    .handle {
        position: absolute;
        top: 50%;
        width: 18px;
        height: 34px;
        transform: translateY(-50%);
        border-radius: 5px;
        border: 2px solid #f5b544;
        background-color: var(--primary-darkest);
        cursor: ew-resize;
        z-index: 2;
        padding: 0;
    }
    .handle.active,
    .handle:hover {
        background-color: #f5b544;
    }
    .overlapValue {
        position: absolute;
        bottom: -18px;
        transform: translateX(-50%);
        font-size: 0.75em;
        color: #f5b544;
        white-space: nowrap;
    }
    .patterns {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .patterns button {
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--primary-lighter);
        background-color: transparent;
        color: var(--text);
        font: inherit;
        cursor: pointer;
    }
    .patterns button.active {
        border-color: var(--secondary);
        background-color: var(--primary-darker);
        font-weight: 600;
    }
</style>
