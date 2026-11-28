<script lang="ts">
    import { CORNERS, type CornerId } from "../output/blend/blendMath"
    import { translateText } from "../../utils/language"
    import type { BlendCurve } from "../../../types/Output"
    import { outputs } from "../../stores"
    import { blendCandidates, blendGroupOf, createBlendGroup, removeBlendGroup, setBlendAdjust, setBlendConfig, setBlendOverlap } from "../output/blend/blendGroups"
    import { canvasSize, normalizeBlendGroup } from "../output/blend/blendMath"
    import T from "../helpers/T.svelte"
    import InputRow from "../input/InputRow.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import MaterialCheckbox from "../inputs/MaterialCheckbox.svelte"
    import MaterialDropdown from "../inputs/MaterialDropdown.svelte"
    import MaterialNumberInput from "../inputs/MaterialNumberInput.svelte"
    import Tip from "../main/Tip.svelte"
    import BlendVisualSetup from "./BlendVisualSetup.svelte"

    export let outputId: string

    $: group = blendGroupOf($outputs[outputId])
    $: groupId = group?.groupId || ""
    $: config = group ? normalizeBlendGroup(group.config) : null
    $: size = config ? canvasSize(config) : null

    // creating a group
    $: candidates = blendCandidates($outputs).filter((c) => !c.inGroup)
    let selected: string[] = []
    $: if (!selected.length && outputId && candidates.some((c) => c.id === outputId)) selected = [outputId]
    function toggle(id: string, checked: boolean) {
        selected = checked ? [...new Set([...selected, id])] : selected.filter((s) => s !== id)
    }
    function create() {
        createBlendGroup(selected)
        selected = []
    }

    const curveOptions: { value: BlendCurve; label: string }[] = [
        { value: "smoothstep", label: translateText("screen.blend_curve_smooth") },
        { value: "cosine", label: translateText("screen.blend_curve_cosine") },
        { value: "linear", label: translateText("screen.blend_curve_linear") }
    ]

    // the projector being adjusted
    let projector = 0
    $: if (group && projector >= group.members.length) projector = 0
    $: projectorOptions = group ? group.members.map((id, i) => ({ value: String(i), label: `${i + 1} · ${$outputs[id]?.name || ""}` })) : []
    $: adjust = config?.adjust?.[projector] || {}

    // corner pin of the selected projector
    const cornerIds = CORNERS
    $: corners = (adjust?.corners || {}) as { [K in CornerId]?: [number, number] }
    function setCorner(id: CornerId, axis: 0 | 1, value: number) {
        const next = { ...corners }
        const current: [number, number] = [...(next[id] || [0, 0])] as [number, number]
        current[axis] = Number(value) || 0
        next[id] = current
        setBlendAdjust(groupId, projector, { corners: next })
    }
</script>

{#if !group || !config || !size}
    <Tip value="screen.blend_group_tip" bottom={20} />

    {#each candidates as candidate}
        <MaterialCheckbox label={candidate.name} checked={selected.includes(candidate.id)} on:change={(e) => toggle(candidate.id, e.detail)} />
    {/each}

    <MaterialButton variant="contained" style="width: 100%; margin-top: 10px;" icon="add" disabled={selected.length < 2} on:click={create}>
        <p><T id="screen.blend_group_create" /></p>
    </MaterialButton>
{:else}
    <BlendVisualSetup {group} {config} bind:projector />

    {#each config.overlaps as overlap, seam}
        <MaterialNumberInput label="screen.blend_overlap ({seam + 1}–{seam + 2})" value={overlap} defaultValue={Math.round(config.projectorWidth * 0.15)} max={Math.floor(config.projectorWidth / 2)} on:change={(e) => setBlendOverlap(groupId, seam, e.detail)} showSlider />
    {/each}

    <MaterialDropdown label="screen.blend_curve" value={config.curve} options={curveOptions} on:change={(e) => setBlendConfig(groupId, { curve: e.detail })} />
    <MaterialNumberInput label="screen.blend_gamma" value={config.gamma} defaultValue={2.2} min={1} max={3} step={0.1} maxDecimals={1} on:change={(e) => setBlendConfig(groupId, { gamma: e.detail })} showSlider />
    <MaterialNumberInput label="screen.blend_black_level (%)" value={Math.round(config.blackLevel * 1000) / 10} defaultValue={0} max={25} step={0.5} maxDecimals={1} on:change={(e) => setBlendConfig(groupId, { blackLevel: e.detail / 100 })} showSlider />
    <MaterialNumberInput label="screen.blend_black_feather (px)" value={config.blackFeather} defaultValue={40} max={400} on:change={(e) => setBlendConfig(groupId, { blackFeather: e.detail })} />

    <br />

    <MaterialDropdown label="screen.blend_projector" value={String(projector)} options={projectorOptions} on:change={(e) => (projector = Number(e.detail) || 0)} />
    <MaterialNumberInput label="screen.blend_brightness (%)" value={Math.round((adjust.brightness ?? 1) * 100)} defaultValue={100} min={30} max={100} on:change={(e) => setBlendAdjust(groupId, projector, { brightness: e.detail / 100 })} showSlider />
    <InputRow>
        <MaterialNumberInput label="screen.blend_offset_x (px)" value={adjust.offsetX || 0} defaultValue={0} min={-500} max={500} on:change={(e) => setBlendAdjust(groupId, projector, { offsetX: e.detail })} />
        <MaterialNumberInput label="screen.blend_offset_y (px)" value={adjust.offsetY || 0} defaultValue={0} min={-500} max={500} on:change={(e) => setBlendAdjust(groupId, projector, { offsetY: e.detail })} />
    </InputRow>
    <p class="sectionTip"><T id="screen.blend_corners_tip" /></p>
    <div class="corners">
        {#each cornerIds as id}
            <div class="corner">
                <span>{translateText("screen.blend_corner_" + id)}</span>
                <InputRow>
                    <MaterialNumberInput label="ΔX" value={corners[id]?.[0] || 0} defaultValue={0} min={-300} max={300} on:change={(e) => setCorner(id, 0, e.detail)} />
                    <MaterialNumberInput label="ΔY" value={corners[id]?.[1] || 0} defaultValue={0} min={-300} max={300} on:change={(e) => setCorner(id, 1, e.detail)} />
                </InputRow>
            </div>
        {/each}
    </div>
    <MaterialButton variant="outlined" icon="reset" on:click={() => setBlendAdjust(groupId, projector, { corners: {} })}><T id="screen.blend_corners_reset" /></MaterialButton>
    <InputRow>
        <MaterialNumberInput label="screen.blend_area_x (px)" value={adjust.areaX || 0} defaultValue={0} min={0} max={(config.displayWidth || config.projectorWidth) - config.projectorWidth} on:change={(e) => setBlendAdjust(groupId, projector, { areaX: e.detail })} />
        <MaterialNumberInput label="screen.blend_area_y (px)" value={adjust.areaY || 0} defaultValue={0} min={0} max={(config.displayHeight || config.projectorHeight) - config.projectorHeight} on:change={(e) => setBlendAdjust(groupId, projector, { areaY: e.detail })} />
    </InputRow>

    <br />

    <p class="sectionTip"><T id="screen.blend_area_tip" /></p>
    <InputRow>
        <MaterialNumberInput label="screen.blend_area_width (px)" value={config.projectorWidth} min={320} max={config.displayWidth || 8192} on:change={(e) => setBlendConfig(groupId, { projectorWidth: e.detail })} />
        <MaterialNumberInput label="screen.blend_area_height (px)" value={config.projectorHeight} min={240} max={config.displayHeight || 8192} on:change={(e) => setBlendConfig(groupId, { projectorHeight: e.detail })} />
    </InputRow>
    <InputRow>
        <MaterialNumberInput label="screen.blend_display_width (px)" value={config.displayWidth || config.projectorWidth} min={320} max={8192} on:change={(e) => setBlendConfig(groupId, { displayWidth: e.detail })} />
        <MaterialNumberInput label="screen.blend_display_height (px)" value={config.displayHeight || config.projectorHeight} min={240} max={8192} on:change={(e) => setBlendConfig(groupId, { displayHeight: e.detail })} />
    </InputRow>

    <MaterialButton variant="outlined" style="width: 100%; margin-top: 10px;" icon="delete" red on:click={() => removeBlendGroup(groupId)}>
        <p><T id="screen.blend_group_remove" /></p>
    </MaterialButton>
{/if}

<style>
    .corners {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 12px;
        margin: 4px 0;
    }
    .corner span {
        font-size: 0.85em;
        opacity: 0.8;
    }
    .sectionTip {
        font-size: 0.85em;
        opacity: 0.8;
        margin: 4px 0;
    }
</style>
