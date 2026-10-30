<script lang="ts">
    // One projector of an edge blend group: the slide is laid out on the whole wide canvas, this window
    // shows its slice of it, faded at the overlaps (mask), with dark tones raised to the black level elsewhere.
    import { onDestroy } from "svelte"
    import type { BlendGroupMember } from "../../../../types/Output"
    import Output from "../Output.svelte"
    import { getStyleResolution } from "../../slide/getStyleResolution"
    import { canvasSize, maskRows, normalizeBlendGroup } from "./blendMath"
    import { BlendRenderer } from "./blendShader"

    export let outputId: string
    export let group: BlendGroupMember

    let width = 0
    let height = 0

    $: config = normalizeBlendGroup(group.config)
    $: index = Math.min(Math.max(0, group.index || 0), config.projectors - 1)
    $: canvas = canvasSize(config)
    $: rows = maskRows(config, index)
    $: slice = rows.slice

    // the window may not be exactly the projector's pixel size (display scaling): stretch the slice to fill it
    $: scaleX = width ? width / slice.width : 1
    $: scaleY = height ? height / slice.height : 1
    $: contentStyle = `width: ${canvas.width}px; height: ${canvas.height}px; transform: scale(${scaleX}, ${scaleY}) translate(${-slice.canvasX}px, ${-slice.canvasY}px);`

    $: maskUrl = rowToDataUrl(rows.mask, "alpha")
    $: liftUrl = config.blackLevel > 0 ? rowToDataUrl(rows.lift, "grey") : ""

    // a 1px-high image, stretched over the window: as alpha, the mask's multiplier at that column;
    // as an opaque grey, the black level that "lighten" raises darker pixels to
    function rowToDataUrl(row: Float32Array, kind: "alpha" | "grey"): string {
        const c = document.createElement("canvas")
        c.width = row.length
        c.height = 1
        const ctx = c.getContext("2d")
        if (!ctx) return ""
        const img = ctx.createImageData(row.length, 1)
        for (let x = 0; x < row.length; x++) {
            const v = Math.round(Math.min(1, Math.max(0, row[x])) * 255)
            img.data[x * 4] = kind === "grey" ? v : 255
            img.data[x * 4 + 1] = kind === "grey" ? v : 255
            img.data[x * 4 + 2] = kind === "grey" ? v : 255
            img.data[x * 4 + 3] = kind === "grey" ? 255 : v
        }
        ctx.putImageData(img, 0, 0)
        return c.toDataURL("image/png")
    }

    // calibration patterns are drawn by the blend shader, which applies the same mask itself
    $: pattern = group.pattern && group.pattern !== "none" ? group.pattern : null
    let patternCanvas: HTMLCanvasElement | null = null
    const renderer = new BlendRenderer()
    $: if (pattern && patternCanvas) drawPattern(patternCanvas, group, pattern)
    function drawPattern(target: HTMLCanvasElement, g: BlendGroupMember, p: string) {
        if (!renderer.attach(target)) return
        renderer.setConfig(g.config, g.index)
        renderer.setPattern(p as any)
        renderer.drawPattern()
    }
    onDestroy(() => renderer.destroy())
</script>

<div class="blendWindow" bind:offsetWidth={width} bind:offsetHeight={height}>
    {#if pattern}
        <canvas class="pattern" bind:this={patternCanvas}></canvas>
    {:else}
        <div class="masked" style="-webkit-mask-image: url({maskUrl}); mask-image: url({maskUrl});">
            <div class="canvas" style={contentStyle}>
                <Output {outputId} style={getStyleResolution(canvas, canvas.width, canvas.height, "fit")} />
            </div>
        </div>
        {#if liftUrl}
            <div class="lift" style="background-image: url({liftUrl});"></div>
        {/if}
    {/if}
</div>

<style>
    .blendWindow {
        position: relative;
        isolation: isolate;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background-color: black;
    }

    .masked {
        position: absolute;
        inset: 0;
        -webkit-mask-size: 100% 100%;
        mask-size: 100% 100%;
        -webkit-mask-repeat: no-repeat;
        mask-repeat: no-repeat;
    }

    /* max(content, lift) per channel: raises only what is darker than the black level */
    .lift {
        position: absolute;
        inset: 0;
        background-size: 100% 100%;
        background-repeat: no-repeat;
        mix-blend-mode: lighten;
        pointer-events: none;
    }

    .canvas {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: 0 0;
        display: flex;
    }

    .pattern {
        width: 100%;
        height: 100%;
        display: block;
    }
</style>
