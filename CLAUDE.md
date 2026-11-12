# FreeShow fork: edge blend, Listen, playback recording

This is Mateus's fork of [FreeShow](https://github.com/ChurchApps/FreeShow) (GPL, Electron + Svelte), used to replace
ProPresenter at his church. The church PC runs Windows with three projectors blended into one wide screen.

- Fork: `mateuss-souza/FreeShow`, working branch `feature/edge-blend-group` (all fork work lives here).
- Upstream: `ChurchApps/FreeShow` (remote `upstream`). Keep fork changes in separate files where possible, so weekly merges stay easy.
- The user speaks Portuguese (pt-BR) with church volunteers in mind; UI strings go in both `public/lang/en.json` and `public/lang/pt_BR.json`.
- He wants disagreement stated openly when an idea is weak, not validation.

## What the fork adds

### Edge blending (blend groups)
Several outputs act as one canvas, each showing a slice with gamma-correct soft edges.
- Math: `src/frontend/components/output/blend/blendMath.ts` (tests in `blendMath.test.ts`). Masks are `(weight*brightness)^(1/gamma)`; ramps linear, smoothstep, cosine; black lift uses lighten (max), not add (adding brightened midtones ~10%).
- Rendering: `BlendedOutput.svelte` (DOM mask + lighten overlay), `blendShader.ts` (WebGL, mirrors the math).
- Group logic: `blendGroups.ts`. Each member output stores `blendGroup: BlendGroupMember` (`src/types/Output.ts`); the group owns a style at canvas resolution (N*W minus overlaps).
- UI: `src/frontend/components/settings/BlendGroupSettings.svelte`, shown in Settings > Outputs. (It was once in the Screens map, where the user couldn't find it; `Screens.svelte` is back to upstream.)
- Not done: photo-based calibration, phone calibration page.

### Listen: church audio to phones on the LAN
Phones open `http://<pc-ip>:5514`, pick a channel (e.g. Portuguese / English interpretation) and listen. Target under 200 ms.
- SFU: mediasoup 3 in the main process, `src/electron/listen/listenCore.ts` (one WebRtcServer on UDP/TCP `mediaPort`, Opus 10 ms, FEC, no DTX). Settings, capture window, status: `ListenServer.ts`. LAN addresses: `network.ts`. Types: `src/types/Listen.ts`.
- Capture page (hidden window, partition `persist:listen-capture`, loopback-only + token): `src/server/listen_capture/`. Sources: an audio input, or "Áudio do computador" = Windows system loopback via `setDisplayMediaRequestHandler` (Windows only).
  - System audio is sent straight to the encoder (no Web Audio resampling) except in latency test mode, where clicks are mixed in.
  - On `devicechange` the loopback capture is reopened (plugging headphones left it stuck on the old device: audio choppy every second).
- Phone page: `src/server/listen_web/` (pt-BR/en, plain http, no TLS: so no Wake Lock or service worker; a silent looping video keeps the screen on). It shows lost audio % and jitter from `getStats`.
- mediasoup-client needs `createDevice()` with an explicit handler fallback on http.
- Operator UI: `src/frontend/components/listen/ListenSettings.svelte` in Settings > Connection; QR overlay creation.
- Packaging: the mediasoup worker is unpacked from asar (`asarUnpack` in `config/building/electron-builder.yaml`).
- Field status: works at the church; audio was reported "robotic" before the resampling fix; not yet re-confirmed. iPhone stops audio when the screen locks (Safari limit).

### Playback recording (slides follow a YouTube playback)
The band plays along to a YouTube video (audio only); lyrics come from FreeShow slides. The operator records slide changes once against the video's clock; in the service the slides follow the video.
- Engine: `src/frontend/components/playback/playbackSync.ts` (record, follow, manual takeover when the operator changes a slide by hand, resume). Pure helpers: `syncMath.ts`. Tests: `playbackSync.test.ts`, `syncMath.test.ts`.
- UI: `PlaybackSyncPanel.svelte` (Playback tab in `src/frontend/components/show/ShowTools.svelte`), `PlaybackSyncPlayer.svelte` (floating player mounted in `src/frontend/App.svelte`, survives switching shows).
- Data: `show.playbackSyncs[id]` (`src/types/PlaybackSync.ts`), one per YouTube version of the song: `{ name, url, videoId, layoutId, anticipate, events: [{ t, index, layout, line, clear }] }`.
- Times always come from the YouTube player (extrapolated between API updates), never a wall clock, so pause, buffering, ads and seeking stay in sync. Recording from the middle keeps events before that point.
- Not yet tested by the user in the real app. Planned later: OCR of lyric videos to pre-fill a recording.

### App updates from the fork
- `src/frontend/utils/forkInfo.ts` (`FORK_REPO`), `checkForUpdates.ts`, popups `NewUpdate.svelte` / `UpdateManager.svelte`: updates come from this fork's releases (upstream's would drop the fork features).
- `src/electron/utils/updater.ts` pushes download status (`Main.UPDATE_STATUS`) to `src/frontend/components/main/UpdateStatusPanel.svelte` (bottom-right corner).
- Every `Main` IPC channel needs an entry in `src/electron/IPC/responsesMain.ts`, even main-to-UI ones, or the production build fails.

### Windows title bar
Manual window drag (`Main.WINDOW_DRAG`, `src/frontend/components/main/MenuBar.svelte`, `dragMainWindow` in `src/electron/index.ts`) because `-webkit-app-region: drag` swallowed clicks on the menu and window buttons.

## Build, test, release

- Tests: `npx vitest run --config config/testing/vitest.config.ts src/frontend/components/output/blend src/frontend/components/playback`
- Type check: `npx svelte-check --threshold error` (needs `NODE_OPTIONS=--max-old-space-size=6144`; ~200 errors are pre-existing upstream, check only new files) and `npx tsc --noEmit -p config/typescript/tsconfig.electron.json`.
- Full build: `npm run build`. Listen test pages only: `npm run build:servers:prod`.
- CI: `.github/workflows/edge-blend-windows.yml` runs on every push to `feature/edge-blend-group`: a `release` job creates the pre-release `vX.Y.Z-blend.<run>` first (avoids duplicate releases from parallel uploads), then `windows` (unsigned NSIS `.exe`, publishes `blend.yml` for auto-update) and `mac` (ad-hoc signed `.dmg`, `config/building/electron-builder.mac-dev.yaml`, no notarization, no in-app updates) build in parallel. The Mac job uses `macos-15-intel` because Apple Silicon runners repeatedly had no capacity.
- Every push makes a release that the church PC will be offered. Put `[skip ci]` in commits that don't change the app (docs, this file).
- Weekly upstream merge: `.github/workflows/sync-upstream.yml` (needs the fork's default branch set to `feature/edge-blend-group`; not done yet).
- Ask before pushing: a push publishes a release to the church.

## Pending

- On-site tests: blend with the three projectors (grid, white, gray, black), Listen latency and sound quality on several phones, playback recording on the Mac and at church.
- 5 ESLint errors in the Listen files (the ESLint tsconfig doesn't include them).
- Fork default branch for the weekly sync.
- ProPresenter-style layout: mockups live in a Claude design canvas ("FreeShow redesign": Live mode, Search, Prepare mode with a services and events folder tree). FreeShow already has projects, project folders and project templates; the redesign surfaces them. Search should also cover artist, author and composer (FreeShow only searches title, lyrics, number and CCLI today).
