<script lang="ts">
    // magnifying glass in the top bar (new interface)
    import { translateText } from "../../../utils/language"
    import Icon from "../../helpers/Icon.svelte"
    import { searchPaletteOpen } from "./searchActions"
</script>

<button class="searchButton" title="{translateText('redesign.search_label')} [Ctrl+F]" aria-label={translateText("redesign.search_label")} on:click={() => searchPaletteOpen.set(true)}>
    <Icon id="search" size={1.4} white />
    <span>{translateText("redesign.search_button")}</span>
    <kbd>Ctrl F</kbd>
</button>

<style>
    .searchButton {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 32px;
        margin: auto 8px;
        padding: 0 12px;
        border-radius: 8px;
        border: 1px solid var(--primary-lighter);
        background-color: var(--primary-darker);
        color: var(--text);
        font: inherit;
        font-size: 0.9em;
        white-space: nowrap;
        cursor: pointer;
        -webkit-app-region: no-drag;
    }
    .searchButton:hover {
        border-color: var(--secondary);
    }
    kbd {
        font-family: monospace;
        font-size: 0.8em;
        opacity: 0.7;
    }
</style>
