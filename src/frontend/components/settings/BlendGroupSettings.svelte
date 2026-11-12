<script lang="ts">
    import { translateText } from "../../utils/language"
    import type { BlendCurve, BlendPattern } from "../../../types/Output"
    import { outputs } from "../../stores"
    import { blendCandidates, blendGroupOf, createBlendGroup, removeBlendGroup, setBlendAdjust, setBlendConfig, setBlendOverlap, setBlendPattern } from "../output/blend/blendGroups"
    import { canvasSize, normalizeBlendGroup } from "../output/blend/blendMath"
    import T from "../helpers/T.svelte"
    import InputRow from "../input/InputRow.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import MaterialCheckbox from "../inputs/MaterialCheckbox.svelte"
    import MaterialDropdown from "../inputs/MaterialDropdown.svelte"
    import MaterialNumberInput from "../inputs/MaterialNumberInput.svelte"
    import Tip from "../main/Tip.svelte"

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

    const patternOptions: { value: BlendPattern; label: string }[] = [
        { value: "none", label: translateText("screen.blend_pattern_none") },
        { value: "grid", label: translateText("screen.blend_pattern_grid") },
        { value: "white", label: translateText("screen.blend_pattern_white") },
        { value: "gray", label: translateText("screen.blend_pattern_gray") },
        { value: "black", label: translateText("screen.blend_pattern_black") },
        { value: "ramp", label: translateText("screen.blend_pattern_ramp") },
        { value: "guides", label: translateText("screen.blend_pattern_guides") }
    ]
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
    <p style="opacity: 0.8; margin-bottom: 10px;">
        <T id="screen.blend_canvas" />: {size.width} × {size.height}
    </p>

    <MaterialDropdown label="screen.blend_pattern" value={group.pattern || "none"} options={patternOptions} on:change={(e) => setBlendPattern(groupId, e.detail)} />

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

    <br />

    <InputRow>
        <MaterialNumberInput label="screen.width (px)" value={config.projectorWidth} min={320} max={8192} on:change={(e) => setBlendConfig(groupId, { projectorWidth: e.detail })} />
        <MaterialNumberInput label="screen.height (px)" value={config.projectorHeight} min={240} max={8192} on:change={(e) => setBlendConfig(groupId, { projectorHeight: e.detail })} />
    </InputRow>

    <MaterialButton variant="outlined" style="width: 100%; margin-top: 10px;" icon="delete" red on:click={() => removeBlendGroup(groupId)}>
        <p><T id="screen.blend_group_remove" /></p>
    </MaterialButton>
{/if}
