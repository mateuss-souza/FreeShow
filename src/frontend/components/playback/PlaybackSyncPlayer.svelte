<script lang="ts">
    // Floating YouTube player for playback recordings. It stays open while the operator moves around the
    // app, so the playback and the slides keep going whatever show is selected.
    import { onDestroy } from "svelte"
    import { showsCache } from "../../stores"
    import { translateText } from "../../utils/language"
    import Icon from "../helpers/Icon.svelte"
    import T from "../helpers/T.svelte"
    import YouTubePlayer from "../drawer/player/YouTubePlayer.svelte"
    import MaterialButton from "../inputs/MaterialButton.svelte"
    import { closeSession, onPlayerTime, recordingEvents, registerPlayer, resumeFollowing, startFollowing, startRecording, stopFollowing, stopRecording, syncClock, syncSession } from "./playbackSync"
    import { formatTime } from "./syncMath"

    // audio comes from this player (the computer's sound output): no autoplay, the operator starts it
    const options = { playerVars: { autoplay: 0, fs: 0, rel: 0, controls: 1, modestbranding: 1 } }

    let player: any = null
    let timer: NodeJS.Timeout | null = null
    let collapsed = false

    function onReady(e: any) {
        player = e.detail?.target || null
        registerPlayer(player)
        if (timer) clearInterval(timer)
        timer = setInterval(() => {
            if (!player?.getCurrentTime) return
            try {
                onPlayerTime(Number(player.getCurrentTime()) || 0, player.getPlayerState() === 1, Number(player.getDuration()) || 0)
            } catch {
                // the player is still loading
            }
        }, 100)
    }

    function onEnd() {
        if ($syncSession?.mode === "recording") stopRecording()
    }

    onDestroy(() => {
        if (timer) clearInterval(timer)
        registerPlayer(null)
    })

    $: session = $syncSession
    $: if (!session) {
        if (timer) clearInterval(timer)
        timer = null
        player = null
        registerPlayer(null)
    }
    $: sync = session ? $showsCache[session.showId]?.playbackSyncs?.[session.syncId] : null
    $: showName = session ? $showsCache[session.showId]?.name || "" : ""
    $: count = session?.mode === "recording" ? $recordingEvents.length : sync?.events?.length || 0
</script>

{#if session}
    <section class="player" class:recording={session.mode === "recording"} aria-label={translateText("playback_sync.player")}>
        <header>
            <span class="badge {session.mode}">
                {#if session.mode === "recording"}<span class="dot"></span>{/if}
                <T id={"playback_sync.mode_" + session.mode} />
            </span>
            <span class="names" title={showName + " · " + (sync?.name || "")}>
                <b>{showName}</b>
                <span>{sync?.name || ""}</span>
            </span>
            <MaterialButton title={collapsed ? "playback_sync.expand" : "playback_sync.collapse"} on:click={() => (collapsed = !collapsed)}>
                <Icon id={collapsed ? "expand" : "remove"} size={1} white />
            </MaterialButton>
            <MaterialButton title="actions.close" on:click={closeSession}>
                <Icon id="close" size={1} white />
            </MaterialButton>
        </header>

        <div class="video" class:collapsed>
            {#key session.videoId}
                <YouTubePlayer videoId={session.videoId} {options} on:ready={onReady} on:end={onEnd} />
            {/key}
        </div>

        <div class="status">
            <span class="time">{formatTime($syncClock.time)}{$syncClock.duration ? " / " + formatTime($syncClock.duration) : ""}</span>
            <span>{count} <T id="playback_sync.changes" /></span>
        </div>

        <div class="actions">
            {#if session.mode === "ready"}
                <MaterialButton variant="outlined" style="flex: 1;" icon="record" on:click={startRecording}>
                    <T id="playback_sync.record" />
                </MaterialButton>
                <MaterialButton variant="contained" style="flex: 1;" icon="play" disabled={!sync?.events?.length} on:click={startFollowing}>
                    <T id="playback_sync.follow" />
                </MaterialButton>
            {:else if session.mode === "recording"}
                <MaterialButton variant="contained" style="flex: 1;" icon="stop" on:click={stopRecording}>
                    <T id="playback_sync.stop_recording" />
                </MaterialButton>
            {:else if session.mode === "following"}
                <MaterialButton variant="outlined" style="flex: 1;" icon="stop" on:click={stopFollowing}>
                    <T id="playback_sync.manual_control" />
                </MaterialButton>
            {:else if session.mode === "manual"}
                <MaterialButton variant="contained" style="flex: 1;" icon="play" on:click={resumeFollowing}>
                    <T id="playback_sync.resume" />
                </MaterialButton>
                <MaterialButton variant="outlined" style="flex: 1;" icon="stop" on:click={stopFollowing}>
                    <T id="playback_sync.stop_following" />
                </MaterialButton>
            {/if}
        </div>
        {#if session.mode === "recording"}
            <p class="hint"><T id="playback_sync.recording_hint" /></p>
        {:else if session.mode === "manual"}
            <p class="hint"><T id="playback_sync.manual_hint" /></p>
        {/if}
    </section>
{/if}

<style>
    .player {
        position: fixed;
        right: 12px;
        bottom: 56px;
        z-index: 4000;
        width: 372px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border-radius: 10px;
        background-color: var(--primary-darker);
        border: 2px solid var(--primary-lighter);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    }
    .player.recording {
        border-color: #ff5a5a;
    }
    header {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .names {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        font-size: 0.85em;
    }
    .names b,
    .names span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .names span {
        opacity: 0.75;
    }
    .badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 0.8em;
        font-weight: 600;
        white-space: nowrap;
        background-color: var(--primary-darkest);
    }
    .badge.recording {
        background-color: #3a1416;
        color: #ff8a8a;
    }
    .badge.following {
        background-color: #12271d;
        color: #5bd49a;
    }
    .badge.manual {
        background-color: #2b220f;
        color: #f5b544;
    }
    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #ff5a5a;
        animation: blink 1s steps(2) infinite;
    }
    @keyframes blink {
        50% {
            opacity: 0.2;
        }
    }
    .video {
        width: 356px;
        height: 200px;
        border-radius: 6px;
        overflow: hidden;
        background-color: black;
    }
    .video.collapsed {
        height: 0;
    }
    .video :global(div),
    .video :global(iframe) {
        width: 100%;
        height: 100%;
    }
    .status {
        display: flex;
        justify-content: space-between;
        font-size: 0.85em;
        opacity: 0.85;
    }
    .time {
        font-family: monospace;
    }
    .actions {
        display: flex;
        gap: 6px;
    }
    .hint {
        font-size: 0.8em;
        opacity: 0.75;
        line-height: 1.35;
    }
</style>
