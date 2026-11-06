<script lang="ts">
    import { updateStatus } from "./updateStore"
    import T from "../helpers/T.svelte"

    $: status = $updateStatus
    $: visible = status.state !== "idle"
</script>

{#if visible}
    <div class="update" class:error={status.state === "error"} role="status" aria-live="polite">
        {#if status.state === "checking"}
            <T id="update.checking" />
        {:else if status.state === "downloading"}
            <T id="update.downloading" />
            {status.version ? `v${status.version}` : ""}
            {typeof status.percent === "number" ? `${status.percent}%` : ""}
        {:else if status.state === "ready"}
            <T id="update.ready" />
            {status.version ? `v${status.version}` : ""}
        {:else if status.state === "error"}
            <T id="update.error" />
        {/if}
    </div>
{/if}

<style>
    .update {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 5000;
        max-width: 420px;
        padding: 8px 14px;
        border-radius: 8px;
        background-color: var(--primary-darker);
        border: 2px solid var(--primary-lighter);
        color: var(--text);
        font-size: 13px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    }
    .update.error {
        border-color: #ff8a8a;
    }
</style>
