<script lang="ts">
    import { Main } from "../../../../types/IPC/Main"
    import { sendMain } from "../../../IPC/main"
    import { activePopup, popupData, special } from "../../../stores"
    import T from "../../helpers/T.svelte"
    import HRule from "../../input/HRule.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import { registerPopupSubmit } from "../../../utils/popup"
    import { FORK_RELEASES_URL } from "../../../utils/forkInfo"
    import { newToast } from "../../../utils/common"

    registerPopupSubmit(download)

    let changelog = ($popupData.changelog || "").replaceAll("\r\n", "<br>").replaceAll("-", "•")

    // downloads in the background and installs when FreeShow is closed, so a running service is never interrupted
    function download() {
        sendMain(Main.AUTO_UPDATE)
        newToast("about.fork_update_downloading")

        activePopup.set(null)
        popupData.set({})
    }
</script>

{#if $special.autoUpdates}
    <div class="auto_update">
        <T id="about.download_auto" />
    </div>

    <HRule title="setup.or" />
{/if}

<MaterialButton variant="contained" icon="download" on:click={download}>
    <T id="about.fork_update_install" />
</MaterialButton>
<MaterialButton variant="text" small on:click={() => sendMain(Main.URL, FORK_RELEASES_URL)}>
    <T id="about.fork_update_manual" />
</MaterialButton>

<div class="changelog">
    <h3 style="color: var(--text);text-decoration: underline solid var(--secondary);"><T id="about.changes" /></h3>
    {@html changelog}
</div>

<style>
    .auto_update {
        max-width: 650px;
        font-size: 0.9em;
    }

    .changelog {
        margin-top: 20px;
        max-height: 300px;
        overflow-y: auto;

        padding: 20px;
        background-color: var(--primary-darker);
        border-radius: 8px;
    }
</style>
