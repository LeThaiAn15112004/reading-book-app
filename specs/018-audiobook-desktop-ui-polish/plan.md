# Implementation Plan: Audiobook player on Desktop — readable, keyboard-friendly, part of the system

**Branch**: `018-audiobook-desktop-ui-polish` (work lands on `anle-dev`) | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/018-audiobook-desktop-ui-polish/spec.md`

## Summary

Fix the Desktop audiobook player's accessibility defects (unreadable warnings in the light theme, no focus ring),
make it keyboard- and system-friendly (rebindable player shortcuts, Windows media controls), let listening continue
outside the player (in-app mini bar, floating always-on-top window, tray Play / Pause, auto-open on minimise / hide),
and polish the layout (one progress indicator, two columns from 1024 px, vector rail icons, skip lengths + resume
rewind, Notes search). Approach (research R1–R13): the existing module-level `audioPlayerStore` becomes the listening
session by no longer disposing on unmount; every surface drives that one store; the floating window is a Main-owned
remote-control `BrowserWindow` fed by a throttled state DTO; pure rules (prefs, rewind, Notes filter) live in core.

## Technical Context

**Language/Version**: TypeScript ~6.0 (strict), React 19.3, Node (Electron 39 Main)

**Primary Dependencies**: Electron, Vite 8, Tailwind CSS 4.3 (container queries), zustand 5; Chromium Media Session
(no new package)

**Storage**: no SQLite change / migration. Renderer `localStorage` `readmate.audioListeningPrefs.v1`; Main
`{userData}/mini-player-prefs.json`

**Testing**: vitest (core `source/core/tests`: listening prefs, resume rewind, Notes filter, i18n gates); Desktop
spikes (`spike:audio:store` extended, new `spike:audio:mini-player`, `spike:theme:contrast` extended); manual
quickstart; E2E manual-only

**Target Platform**: Windows desktop first (SMTC, tray); macOS / Linux must not break (media panel / tray as the OS
offers). Mobile host: unchanged (feature `miniPlayer` unavailable)

**Project Type**: desktop app (Electron) sharing one React UI with the phone host

**Performance Goals**: mini bar visible ≤ 1 s after leaving the player, no audible gap (SC-008); floating window
opens ≤ 1 s after minimise / hide (SC-009); system panel updated ≤ 2 s (SC-004); state relay ≤ 4 messages/s

**Constraints**: renderer never gets a path; core has no Node / DOM globals (R1–R3); four-place IPC rule; every Main
change approved in `desktop-main-changes.json`; i18n catalogue + glossary; book files untouched

**Scale/Scope**: 5 user stories, 33 FRs; ~25 files changed, ~12 new (Main: 4, renderer: 6, core: 3)

## Constitution Check

`.specify/memory/constitution.md` is the unfilled template: no ratified principles, so no gate can fail. The project
rules in CLAUDE.md act as gates:

| Rule | How |
|---|---|
| Core purity (R1–R3) | `audio/listening-prefs.ts`, `app-models/audio-note-filter.ts` pure (clock / time passed in) |
| Platform adapters (R7, R12) / Mobile | `AppFeature 'miniPlayer'`; Mobile `create-api` adds the group as `NOT_AVAILABLE_ON_PLATFORM`; no `.electron` import outside `platforms` |
| Four-place IPC rule | `MiniPlayerChannels`: channels.ts, `mini-player.ipc.ts`, preload + `api-types.ts`, `bridge/miniPlayer.ts`; floating window has its own minimal preload |
| Main change approvals | approval lines for `main.ts`, `background/background-mode.ts`, `ipc/*`, new `mini-player/*` |
| App preferences | listening prefs in a renderer store + `APP_SETTINGS_RESETTERS`; floating-window prefs Main-owned (Main needs them with the renderer hidden), mirrored over IPC like Background prefs |
| i18n (spec 012) | all texts in `{en,vi}` catalogues; tray texts via `tMain`; glossary rows first; FR-018 fixes `label.toLowerCase()` |
| Every quit path through `isQuitting` | unchanged; floating window closes on `before-quit`, audio flush already registered |
| E2E manual-only | spikes + vitest + quickstart |

Post-design re-check: unchanged — no new dependency, no migration; one new window type is the main risk (R4, R5
**verify** items carry fallbacks).

## Project Structure

### Documentation (this feature)

```text
specs/018-audiobook-desktop-ui-polish/
├── spec.md
├── plan.md               # this file
├── research.md           # R1–R13
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── mini-player-ipc.md
│   ├── player-shortcuts.md
│   └── player-ui.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
source/core/src/
├── audio/listening-prefs.ts                 # NEW: SKIP_LENGTHS, normalizeListeningPrefs, resume rewind
├── app-models/audio-note-filter.ts          # NEW: filterAudioNotes, groupNotesByChapter
└── i18n/catalogue/{en,vi}/                  # audiobook-player, chrome (mini bar), settings (shortcuts), main (tray)
source/core/tests/audio/listening-prefs.test.ts, app-models/audio-note-filter.test.ts   # NEW

source/app/
├── App.tsx                                  # mount MiniPlayerBar
├── main.tsx                                 # ?window=mini-player -> mount MiniPlayerWindowRoot instead of App
├── platforms/miniPlayerWindow.{electron,native}.ts   # NEW adapter for window.miniPlayerWindow
├── index.css, styles/theme.css              # warning tokens, focus-ring utility, --mini-player-height
├── components/audio/MiniPlayerBar.tsx       # NEW
├── screens/MiniPlayerWindow/{MiniPlayerWindowRoot,MiniPlayerWindow}.tsx   # NEW (floating window, own root)
├── screens/ReaderRoute.tsx                  # sets shortcutScreenStore.readerKind
├── screens/AudioBook/
│   ├── AudioBookScreen.tsx                  # no dispose on unmount; @container layout; Space listener removed
│   ├── components/{AudioControls,AudioTimeline,AudioSidebar}.tsx   # icons, mute, markers, Notes search, resize keys
│   └── logic/
│       ├── audioPlayerStore.ts              # pausedAt + rewind, mute, skip lengths, session end paths
│       ├── listeningPrefsStore.ts           # NEW
│       ├── audioNoteFilterStore.ts          # NEW
│       ├── mediaSessionBridge.ts            # NEW
│       └── miniPlayerSync.ts                # NEW: publish DTO, run commands
├── screens/Reader/components/sidebar/{sidebarTabs.ts,SidebarEdgeRail.tsx,SidebarTabIcon.tsx}   # vector icons
├── components/reader/chrome/readerChromeLayout.ts   # bottom inset incl. mini bar
├── screens/Reader/logic/readAloud/readAloudStore.ts # pause audiobook on start
├── screens/Library/logic/useLibraryScreen.ts        # end session before removing the playing book
├── screens/Settings/…                       # Background: auto-open toggle; reset line
├── shortcuts/{shortcutDefinitions.ts,ShortcutsBridge.tsx,shortcutScreenStore.ts}
├── bridge/miniPlayer.ts                     # NEW
├── platforms/host-types.ts, host.*.ts       # AppFeature 'miniPlayer'
├── platforms/native/bridge/create-api.ts    # miniPlayer group → NOT_AVAILABLE_ON_PLATFORM
└── platforms/electron/
    ├── main.ts                              # minimize / hide / restore / show hooks
    ├── background/background-mode.ts        # tray audiobook entry
    ├── ipc/{channels.ts,api-types.ts,index.ts,mini-player.ipc.ts}
    ├── preload.ts, mini-player-preload.ts   # NEW preload
    ├── mini-player/{mini-player-window.ts,mini-player-prefs.ts,mini-player-relay.ts}   # NEW
    └── spikes/audio/run-mini-player.mjs     # NEW spike
source/scripts/desktop-main-changes.json     # approvals
specs/012-app-ui-i18n/contracts/glossary.md  # new terms
```

**Structure Decision**: existing single-project layout (spec 009). Pure rules in core; renderer state in zustand
stores under the AudioBook screen (user preference: zustand for custom hooks); Main code in a new
`platforms/electron/mini-player/` folder like `background/`.

## Delivery increments (for /speckit-tasks)

1. **A — Readability, focus, shortcuts** (US1, US2; FR-001–007, FR-018, FR-030–031): warning tokens, `focus-ring`,
   shortcut context + definitions, remove Space listener, resize handle keys.
2. **B — Session outside the player** (US5 in-app part; FR-019, FR-020, FR-022–024): no dispose on unmount, mini bar,
   reader inset, Read Aloud pause, removal / tab-close ends session.
3. **C — Floating window + tray + minimise / hide** (US5 rest; FR-021, FR-025, FR-026): Main window, relay, prefs,
   tray entry, Settings toggle, spike.
4. **D — System media controls** (US3; FR-008–011).
5. **E — Layout and listening polish** (US4; FR-012–017, FR-028, FR-029, FR-032, FR-033): one progress, rail icons,
   skip symbols + lengths, mute, markers, reduced motion, rewind, two columns, Notes search.

Each increment ends with `npm run check` green and its quickstart rows passing.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| Second `BrowserWindow` + its preload | FR-021 / clarification Q1: controls must stay above other applications | an in-app bar is invisible once another app is in front; Document PiP unverified in Electron 39 and cannot be tied to tray / auto-open / saved position |
| New shortcut context `audiobook` | ← / → must mean "skip" in the player and "page" in the text reader on the same route | one `reader` context would report every player key as a conflict with page turns |
