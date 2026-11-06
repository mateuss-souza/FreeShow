<script lang="ts">
    // Operator controls for "Listen": live church audio to phones in the room.
    import qrcode from "qrcode-generator"
    import { onMount } from "svelte"
    import { uid } from "uid"
    import { Main } from "../../../types/IPC/Main"
    import { MAX_LISTEN_CHANNELS, type ListenChannelConfig, type ListenConfig } from "../../../types/Listen"
    import type { Item } from "../../../types/Show"
    import { requestMain, sendMain } from "../../IPC/main"
    import { overlays } from "../../stores"
    import { newToast } from "../../utils/common"
    import { translateText } from "../../utils/language"
    import T from "../helpers/T.svelte"
    import InputRow from "../input/InputRow.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import MaterialDropdown from "../inputs/MaterialDropdown.svelte"
    import MaterialNumberInput from "../inputs/MaterialNumberInput.svelte"
    import MaterialTextInput from "../inputs/MaterialTextInput.svelte"
    import MaterialToggleSwitch from "../inputs/MaterialToggleSwitch.svelte"
    import { listenStatus } from "./listenStore"

    let config: ListenConfig | null = null

    onMount(() => {
        requestMain(Main.LISTEN_GET, undefined, (state) => {
            if (!state) return
            config = state.config
            listenStatus.set(state.status)
        })
    })

    function update(change: Partial<ListenConfig>) {
        if (!config) return
        config = { ...config, ...change }
        requestMain(Main.LISTEN_SET_CONFIG, change, (state) => {
            if (!state) return
            config = state.config
            listenStatus.set(state.status)
        })
    }

    function updateChannel(id: string, change: Partial<ListenChannelConfig>) {
        if (!config) return
        update({ channels: config.channels.map((c) => (c.id === id ? { ...c, ...change } : c)) })
    }

    function addChannel() {
        if (!config || config.channels.length >= MAX_LISTEN_CHANNELS) return
        update({ channels: [...config.channels, { id: uid(6), name: translateText("listen.channel") + " " + (config.channels.length + 1), source: "none" }] })
    }

    function removeChannel(id: string) {
        if (!config || config.channels.length <= 1) return
        update({ channels: config.channels.filter((c) => c.id !== id) })
    }

    function refreshDevices() {
        requestMain(Main.LISTEN_DEVICES, undefined, (status) => status && listenStatus.set(status))
    }

    // SOURCES

    $: status = $listenStatus
    $: sourceOptions = [{ value: "none", label: translateText("listen.source_off") }, ...(status?.devices || []).map((d) => ({ value: "device:" + d.deviceId, label: d.label })), ...(status?.loopbackSupported ? [{ value: "loopback", label: translateText("listen.source_loopback") }] : [])]
    // no device chosen means the system default input
    const sourceValue = (c: ListenChannelConfig) => (c.source === "device" ? "device:" + (c.deviceId || "default") : c.source)

    function setSource(channel: ListenChannelConfig, value: string) {
        if (value.startsWith("device:")) {
            const deviceId = value.slice(7)
            const label = status?.devices.find((d) => d.deviceId === deviceId)?.label || ""
            updateChannel(channel.id, { source: "device", deviceId, deviceLabel: label })
        } else updateChannel(channel.id, { source: value as any, deviceId: undefined })
    }

    // a saved device that isn't connected right now still shows by name
    function optionsFor(channel: ListenChannelConfig) {
        const value = sourceValue(channel)
        if (channel.source !== "device" || sourceOptions.find((o) => o.value === value)) return sourceOptions
        return [...sourceOptions, { value, label: (channel.deviceLabel || translateText("listen.device")) + " (" + translateText("listen.not_connected") + ")" }]
    }

    // LEVEL

    function levelColor(level: number) {
        if (level > 0.9) return "#ff5a5a"
        if (level > 0.6) return "#f5b544"
        return "#5bd49a"
    }

    // QR

    $: url = status?.urls?.[0] || ""
    $: addressOptions = (status?.addresses || []).map((a) => ({ value: a, label: a }))
    let qrSvg = ""
    $: qrSvg = url ? makeQr(url) : ""
    function makeQr(text: string) {
        try {
            const qr = qrcode(0, "M")
            qr.addData(text)
            qr.make()
            return qr.createSvgTag({ scalable: true, margin: 2 })
        } catch {
            return ""
        }
    }

    // an overlay the operator can put on any output or stage screen
    function createQrOverlay() {
        if (!url) return
        const items: Item[] = [
            {
                type: "text",
                style: "top:600px;left:1440px;height:90px;width:420px;",
                align: "align-items:center;",
                lines: [{ align: "text-align:center;", text: [{ value: translateText("listen.overlay_text"), style: "font-size:44px;font-weight:bold;color:#FFFFFF;" }] }]
            },
            { type: "qr_code", style: "top:700px;left:1500px;height:300px;width:300px;", qr_code: { text: url, color: "#000000", background: "#FFFFFF" } }
        ]
        overlays.update((a) => {
            const existing = Object.keys(a).find((id) => (a[id] as any).listenQr)
            const id = existing || uid()
            a[id] = { ...(a[id] || {}), name: translateText("listen.overlay_name"), color: null, category: null, items, listenQr: true } as any
            return a
        })
        newToast("listen.overlay_created")
    }

    $: running = !!status?.running
</script>

{#if config}
    <InputRow>
        <MaterialToggleSwitch label="listen.enabled" checked={config.enabled} defaultValue={false} on:change={(e) => update({ enabled: e.detail })} />
    </InputRow>

    {#if config.enabled}
        {#if status?.error}
            <p class="error">{status.error}</p>
        {/if}

        {#each config.channels as channel (channel.id)}
            {@const stats = status?.channels?.[channel.id]}
            <div class="channel">
                <div class="head">
                    <span class="dot" class:live={stats?.live} title={stats?.live ? translateText("listen.live") : ""}></span>
                    <MaterialTextInput label="listen.channel_name" value={channel.name} on:change={(e) => updateChannel(channel.id, { name: e.detail })} />
                    <span class="count" title={translateText("listen.listeners")}>{stats?.listeners || 0}</span>
                    {#if config.channels.length > 1}
                        <MaterialButton icon="delete" title="actions.delete" on:click={() => removeChannel(channel.id)} />
                    {/if}
                </div>

                <MaterialDropdown label="listen.source" value={sourceValue(channel)} options={optionsFor(channel)} on:change={(e) => setSource(channel, e.detail)} />
                <MaterialToggleSwitch label="listen.stereo" checked={!!channel.stereo} defaultValue={false} on:change={(e) => updateChannel(channel.id, { stereo: e.detail })} />

                {#if channel.source !== "none"}
                    <div class="meter" aria-label={translateText("listen.level")}>
                        <div class="bar" style="width: {Math.round((stats?.level || 0) * 100)}%; background-color: {levelColor(stats?.level || 0)};"></div>
                    </div>
                {/if}
                {#if stats?.error}
                    <p class="error">{stats.error}</p>
                {/if}
            </div>
        {/each}

        <InputRow>
            <MaterialButton variant="outlined" style="flex: 1;" icon="add" disabled={config.channels.length >= MAX_LISTEN_CHANNELS} on:click={addChannel}>
                <T id="listen.add_channel" />
            </MaterialButton>
            <MaterialButton variant="outlined" style="flex: 1;" icon="refresh" on:click={refreshDevices}>
                <T id="listen.refresh_devices" />
            </MaterialButton>
        </InputRow>

        {#if running && url}
            <div class="share">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                <div class="qr">{@html qrSvg}</div>
                <div class="shareInfo">
                    <p class="total"><b>{status?.total || 0}</b> <T id="listen.listeners" /></p>
                    <MaterialButton variant="text" title={url} on:click={() => sendMain(Main.URL, url)}>
                        <p class="url">{url}</p>
                    </MaterialButton>
                    <MaterialButton variant="outlined" icon="overlays" on:click={createQrOverlay}>
                        <T id="listen.create_overlay" />
                    </MaterialButton>
                </div>
            </div>
        {/if}

        <MaterialToggleSwitch label="listen.test_mode" checked={!!config.testMode} defaultValue={false} on:change={(e) => update({ testMode: e.detail })} />
        <MaterialTextInput label="listen.page_title" value={config.title || ""} placeholder={translateText("listen.default_title")} on:change={(e) => update({ title: e.detail })} />

        {#if addressOptions.length > 1}
            <MaterialDropdown label="listen.address" value={config.preferredAddress || addressOptions[0].value} options={addressOptions} on:change={(e) => update({ preferredAddress: e.detail })} />
        {/if}
        <InputRow>
            <MaterialNumberInput label="listen.port" value={config.port} defaultValue={5514} min={1024} max={65535} on:change={(e) => update({ port: e.detail })} />
            <MaterialNumberInput label="listen.media_port" value={config.mediaPort} defaultValue={5515} min={1024} max={65535} on:change={(e) => update({ mediaPort: e.detail })} />
        </InputRow>
        <MaterialNumberInput label="listen.max_listeners" value={config.maxListeners} defaultValue={300} min={1} max={1000} on:change={(e) => update({ maxListeners: e.detail })} />
    {/if}
{/if}

<style>
    .channel {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        margin: 6px 0;
        border-radius: 6px;
        background-color: var(--primary-darker);
    }
    .head {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .head :global(.textfield) {
        flex: 1;
    }
    .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background-color: var(--primary-lighter);
        flex: none;
    }
    .dot.live {
        background-color: #5bd49a;
    }
    .count {
        min-width: 32px;
        text-align: center;
        font-weight: bold;
        opacity: 0.8;
    }
    .meter {
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        background-color: var(--primary-darkest);
    }
    .bar {
        height: 100%;
        transition: width 0.08s linear;
    }
    .error {
        color: #ff8a8a;
        font-size: 0.9em;
        padding: 4px 2px;
    }
    .share {
        display: flex;
        gap: 14px;
        align-items: center;
        margin: 10px 0;
    }
    .qr {
        width: 150px;
        height: 150px;
        flex: none;
        background-color: white;
        border-radius: 6px;
        overflow: hidden;
    }
    .qr :global(svg) {
        width: 100%;
        height: 100%;
        display: block;
    }
    .shareInfo {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .total b {
        font-size: 1.6em;
    }
    .url {
        text-decoration: underline;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
