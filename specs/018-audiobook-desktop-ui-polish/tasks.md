---

description: "Task list for spec 018 — audiobook player on Desktop"
---

# Tasks: Audiobook player on Desktop — readable, keyboard-friendly, part of the system

**Input**: Design documents from `specs/018-audiobook-desktop-ui-polish/` (plan.md, spec.md, research.md R1–R13,
data-model.md, contracts/mini-player-ipc.md, contracts/player-shortcuts.md, contracts/player-ui.md, quickstart.md)

**Tests**: the spec does not ask for TDD. Following the project's norm (CLAUDE.md), pure core rules get vitest tests
and Desktop behaviour is checked by spike scripts; those tasks are included. E2E is NOT run (manual-only).

**Organization**: by user story, in priority order: US1 (P1), US2 (P1), US5 (P2), US3 (P2), US4 (P3). Paths are from
the repository root. Every Main-process file change needs an approval line in
`source/scripts/desktop-main-changes.json` (done per story, not left to the end). All UI text goes into
`source/core/src/i18n/catalogue/en/*` AND `vi/*` (same shape), Vietnamese per the glossary.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup (shared)

**Purpose**: glossary and feature flag every story relies on.

- [X] T001 Add the rows "Mini player → Trình phát thu nhỏ", "Pop out → Mở cửa sổ nổi", "Return to app → Về ứng dụng", "Floating window → Cửa sổ nổi", "Skip back / forward length → Độ dài tua lùi / tới", "Rewind on resume → Tự lùi khi phát tiếp" to `specs/012-app-ui-i18n/contracts/glossary.md` (Core terms table, appended after the "Utilities" row)
- [X] T002 [P] Add `'miniPlayer'` to `AppFeature` in `source/app/platforms/host-types.ts`; return `true` for it in `source/app/platforms/host.electron.ts` and `false` in `source/app/platforms/host.native.ts`

---

## Phase 2: Foundational (blocking)

**Purpose**: shared visual primitives and the shared rail icon used by US1, US4 and the mini player surfaces.

- [X] T003 Add warning tokens `--lib-warning-bg`, `--lib-warning-border`, `--lib-warning-text` for Night, Sepia and Paper in `source/app/styles/theme.css` (text on bg ≥ 4.5:1 in each theme, border ≥ 3:1 against the page background) and map them as `--color-lib-warning-bg|border|text` in the `@theme` block of `source/app/index.css`
- [X] T004 Add a `focus-ring` utility in `source/app/index.css` (`@utility focus-ring { &:focus-visible { outline: 2px solid var(--lib-accent); outline-offset: 2px } }`), shown for keyboard focus only (research R12)
- [X] T005 Extend `source/app/platforms/electron/spikes/theme-presets/run-contrast.mjs` to assert, for Night / Sepia / Paper: warning text on warning bg ≥ 4.5:1, accent focus outline vs page background ≥ 3:1 (SC-001, FR-003)
- [X] T006 [P] Create `source/app/screens/Reader/components/sidebar/SidebarTabIcon.tsx`: inline SVG icons (24 viewBox, `stroke="currentColor"`, strokeWidth 1.8, `aria-hidden`) for ids `chapters`, `bookmarks`, `highlights`, `layout`, `attachments`, `transcript`, `notes`

**Checkpoint**: tokens, focus ring and icons exist; nothing visible changed yet.

---

## Phase 3: User Story 1 — Warnings and focus readable in every theme (P1) 🎯 MVP

**Goal**: player notices readable in all themes; every player control shows a keyboard focus ring.

**Independent Test**: quickstart rows 1–2 — damaged track in Paper / Sepia / Night; Tab through player + sidebar.

- [X] T007 [P] [US1] Replace the fixed `amber-*` classes of `TrackErrorNotice` and `NoteNotice` (and their buttons) with `bg-lib-warning-bg border-lib-warning-border text-lib-warning-text` plus a leading warning icon (`aria-hidden`) in `source/app/screens/AudioBook/AudioBookScreen.tsx`
- [X] T008 [P] [US1] Replace `text-amber-300` of the "can't play" label with `text-lib-warning-text` in `source/app/screens/AudioBook/components/AudioSidebar.tsx`
- [X] T009 [US1] Add `focus-ring` to every interactive element of `source/app/screens/AudioBook/components/AudioControls.tsx` (transport, speed / sleep triggers, Add note, volume), `AudioTimeline.tsx` (scope radios, slider, note markers — replace their `focus-visible:outline-none`), `AudioSelect.tsx` (trigger + options), `AudioNoteMenu.tsx`, `AudioSidebar.tsx` (rows, note cards, group rows, close) and the Transcribe entry in `AudioBookScreen.tsx`
- [X] T010 [US1] Add `focus-ring` to the rail buttons and the open/close edge button in `source/app/screens/Reader/components/sidebar/SidebarEdgeRail.tsx` (shared with the text reader)
- [X] T011 [US1] Run `npm run spike:theme:contrast` and fix any failing pair in `source/app/styles/theme.css`

**Checkpoint**: US1 independently testable.

---

## Phase 4: User Story 2 — Control playback from the keyboard (P1)

**Goal**: 11 rebindable player shortcuts listed in Settings, never stealing keys from focused controls.

**Independent Test**: quickstart rows 3–4.

- [X] T012 [P] [US2] Create `source/app/shortcuts/shortcutScreenStore.ts` (zustand vanilla-compatible store `{ readerKind: 'text' | 'audio' | null, setReaderKind }`) and export it from `source/app/shortcuts/index.ts`
- [X] T013 [US2] In `source/app/shortcuts/shortcutDefinitions.ts` add `ShortcutGroupId` `'audiobook'`, `ShortcutContext` `'audiobook'`, the group entry (label `settings.keyboard.groups.audiobook`) and the 11 definitions of `contracts/player-shortcuts.md` (ids, defaults `Space`, `ArrowLeft`, `ArrowRight`, `Shift ArrowLeft`, `Shift ArrowRight`, `ArrowUp`, `ArrowDown`, `M`, `[`, `]`, `B`; all `allowBare: true`; `allowRepeat: true` for skipBack / skipForward / volumeUp / volumeDown) — use the key tokens of `shortcutKeys.ts`
- [X] T014 [US2] In `source/app/shortcuts/ShortcutsBridge.tsx`: `contextOf` returns `'audiobook'` for `/reader…` when `shortcutScreenStore.readerKind === 'audio'`; add rule 3 of the contract (ArrowLeft/Right/Up/Down, Home, End, PageUp/PageDown never fire when the target is inside `input[type=range]`, `[role=slider]`, `[role=radiogroup]`, `[role=listbox]`, `[role=menu]` or `[role=separator]`)
- [X] T015 [US2] Set `readerKind` in `source/app/screens/ReaderRoute.tsx` (`'audio'` when it mounts `AudioBookScreen`, `'text'` for `ReaderScreen`, `null` on unmount)
- [X] T016 [US2] Add the en + vi texts `settings.keyboard.groups.audiobook` and `settings.keyboard.items.audiobookPlayPause|SkipBack|SkipForward|PreviousChapter|NextChapter|VolumeUp|VolumeDown|Mute|SpeedDown|SpeedUp|AddNote` in `source/core/src/i18n/catalogue/en/settings.ts` and `vi/settings.ts`
- [X] T017 [US2] Add store actions `toggleMute()`, `speedStep(direction: 1 | -1)` (next / previous `PLAYBACK_RATES` entry) and `volumeStep(direction)` (±0.05, clamp 0–1, lifts mute) to `source/app/screens/AudioBook/logic/audioPlayerStore.ts` (mute is persisted by T053 in US4; here keep it in memory)
- [X] T018 [US2] Register the 11 handlers with `useShortcutAction` in `source/app/screens/AudioBook/AudioBookScreen.tsx` (each returns `false` when its button would be disabled; until T053 lands, skip back / forward use the fixed 15 s / 30 s the player uses today, then switch to the chosen lengths) and delete the hand-written Space `keydown` listener and `isTypingTarget`
- [X] T019 [US2] Use `useShortcutLabel` for the tooltips of play / skip / previous / next / Add note / mute in `source/app/screens/AudioBook/components/AudioControls.tsx` (FR-007)
- [X] T020 [US2] Extend `source/app/platforms/electron/spikes/shortcuts/run-shortcuts.mjs` (`npm run spike:settings:shortcuts`): audiobook context has no conflict with reader page keys; a rebind applies; arrows on a focused slider do not fire

**Checkpoint**: US1 + US2 = MVP (accessibility defects fixed).

---

## Phase 5: User Story 5 — Keep listening outside the player (P2)

**Goal**: session survives leaving the player; in-app mini bar; floating always-on-top window; tray Play / Pause;
auto-open on minimise / hide; Read Aloud pauses the audiobook.

**Independent Test**: quickstart rows 6–11 and 17.

### Session lifetime (renderer)

- [X] T021 [US5] In `source/app/screens/AudioBook/AudioBookScreen.tsx` stop calling `dispose()` in the unmount effect; call `load(bookId)` only when `audioPlayerStore.bookId !== bookId` (re-entering the player of the playing book keeps state); `leave()` navigates without disposing
- [X] T022 [US5] In `source/app/screens/AudioBook/logic/audioPlayerStore.ts`: `load(otherBookId)` while a session is active first runs the existing `dispose()` path (persist(true), teardown); add `endSession()` = `dispose()` exported for the surfaces (research R1)
- [X] T023 [US5] End the session before removing the playing book in `source/app/screens/Library/logic/useLibraryScreen.ts` (both `removeBook` and `removeAudiobook` paths: `if (useAudioPlayerStore.getState().bookId === id) await endSession()`)
- [X] T024 [US5] End the session when the audiobook's open-book tab is closed in `source/app/hooks/app/OpenReadingContext.tsx`

### In-app mini bar

- [X] T025 [P] [US5] Add en + vi texts for the mini bar (`chrome.miniPlayer.region`, `openPlayer`, `popOut`, `close`, `playing`, `paused`, `skipBack {seconds}`, `skipForward {seconds}`) in `source/core/src/i18n/catalogue/en/chrome.ts` and `vi/chrome.ts`
- [X] T026 [US5] Create `source/app/components/audio/MiniPlayerBar.tsx` per `contracts/player-ui.md` (56 px; cover 40 px; title · subtitle; skip back / play-pause / skip forward; thin progress; "Pop out"; ✕ → `endSession()`; left part = button → `navigate('/reader/<bookId>')`; `role="region"`; `focus-ring`; a failed track shows the warning colours and the player's "Try again" / "Skip to next track" (when there is one) actions, the same store actions as `TrackErrorNotice`) reading only `audioPlayerStore`
- [X] T027 [US5] Mount `MiniPlayerBar` once in `source/app/App.tsx` content tier when `isFeatureAvailable('miniPlayer')`, the session is active, the route is not `/reader/<session bookId>` and the floating window is not open; set `--mini-player-height` (56px or 0) on the app frame element
- [X] T028 [US5] Pad the bottom of the Library, Collections and Settings scroll areas by `var(--mini-player-height, 0px)` in `source/app/index.css` (or their screen roots) so no content is covered (FR-020)

### Text reader

- [X] T029 [US5] Add a `miniPlayerHeight` parameter to `readerChromeBottomInset` in `source/app/components/reader/chrome/readerChromeLayout.ts`: return `miniPlayerHeight` in paginated view and `READER_FOOTER_HEIGHT_PX + READER_FOOTER_CONTENT_GAP_PX + miniPlayerHeight` in scroll view (footer hidden → only `miniPlayerHeight`); update its callers in `source/app/screens/Reader/ReaderScreen.tsx`
- [X] T030 [US5] In the text reader place the mini bar at `bottom: READER_FOOTER_HEIGHT_PX` (0 when the footer is hidden in immersive mode) and trigger the EPUB resize path when the bar appears / disappears, in `source/app/components/audio/MiniPlayerBar.tsx` + `source/app/screens/Reader/logic/hooks/useReaderChromeUi.ts`; check that PDF, TXT and Markdown re-measure through their resize observers (fix any that does not) so no line is under the bar in paginated and scroll view
- [X] T031 [US5] Pause the audiobook (`useAudioPlayerStore.getState().pause()`) at the start of `readViewport`, `readFromPosition` and a resuming `togglePlayPause` in `source/app/screens/Reader/logic/readAloud/readAloudStore.ts` (never resume it afterwards)

### Floating window + tray (Main)

- [X] T032 [P] [US5] Add `MiniPlayerChannels` (`publishState`, `open`, `getPrefs`, `setPrefs`, `command`, `windowChanged`) to `source/app/platforms/electron/ipc/channels.ts` and the DTOs `MiniPlayerStateDto`, `MiniPlayerCommandDto`, `MiniPlayerPrefsDto` + `DesktopApi.miniPlayer` (publishState, open, getPrefs, setPrefs, onCommand, onWindowChanged) to `source/app/platforms/electron/ipc/api-types.ts`, exactly as `contracts/mini-player-ipc.md`
- [X] T033 [P] [US5] Create `source/app/platforms/electron/mini-player/mini-player-prefs.ts`: `{userData}/mini-player-prefs.json` via `prefs/json-prefs-file.ts`, fields `x: number | null`, `y: number | null` (default null = bottom-right of the primary work area, 24 px margin), `autoOpen: boolean` (default true); `visiblePosition(prefs, displays)` moves a point outside every work area onto the nearest display
- [X] T034 [US5] Create `source/app/platforms/electron/mini-player/mini-player-window.ts`: singleton `BrowserWindow` 360 × 132, `frame: false`, `resizable: false`, `alwaysOnTop: true` (level `floating`), `skipTaskbar: true`, `show: false`, `sandbox: true`, `contextIsolation: true`, preload `mini-player-preload.mjs`, loads the renderer `index.html?window=mini-player` (same bundle); saves `x, y` on `moved` (debounced 500 ms); `open({ automatic })`, `close()`, `isOpen()`; closes on `before-quit`
- [X] T035 [US5] Create `source/app/platforms/electron/mini-player-preload.ts` exposing only `window.miniPlayerWindow = { onState(cb), command(cmd), returnToApp(), close() }` and add it to the Main/preload build inputs in `vite.config.ts`
- [X] T036 [US5] Create `source/app/platforms/electron/mini-player/mini-player-relay.ts`: keeps the last `MiniPlayerStateDto` (validate shape; title / subtitle / author ≤ 500 chars, drop invalid), forwards it to the floating window, forwards commands to the main window's `miniPlayer:command`, `publishState(null)` → close floating window + reset `closedByUserThisSession`; session-only flags `sessionActive`, `openedAutomatically`, `closedByUserThisSession`
- [X] T037 [US5] Create `source/app/platforms/electron/ipc/mini-player.ipc.ts` (handlers for `publishState`, `open` → `{ ok: false, code: 'no_session' }` without a session, `getPrefs`, `setPrefs` accepting only `autoOpen`) and register it in `source/app/platforms/electron/ipc/index.ts`; expose the group in `source/app/platforms/electron/preload.ts`
- [X] T038 [US5] In `source/app/platforms/electron/main.ts` hook the main window's `minimize` and `hide` (open the floating window automatically when `sessionActive && autoOpen && !closedByUserThisSession`) and `restore` / `show` (close it if `openedAutomatically`), per `contracts/mini-player-ipc.md` "Main rules"
- [X] T039 [US5] In `source/app/platforms/electron/background/background-mode.ts` let `trayMenuTemplate()` add, above "Open", `main.shell.tray.audiobookPlay|audiobookPause` with `{ title }` from the relay's last state (click → command `toggle`); rebuild the menu only when `playing`, title or the language change; add the two texts to `source/core/src/i18n/catalogue/{en,vi}/main-shell.ts`
- [X] T040 [US5] Add approval lines for `main.ts`, `background/background-mode.ts`, `ipc/channels.ts`, `ipc/api-types.ts`, `ipc/index.ts`, `ipc/mini-player.ipc.ts`, `preload.ts`, `mini-player-preload.ts`, `mini-player/*` to `source/scripts/desktop-main-changes.json`

### Floating window + sync (renderer)

- [X] T041 [P] [US5] Create `source/app/bridge/miniPlayer.ts` (typed wrapper of `api.miniPlayer`) and export it from `source/app/bridge/index.ts`; add `miniPlayer: unavailableGroup<DesktopApi['miniPlayer']>('miniPlayer')` in `source/app/platforms/native/bridge/index.ts`
- [X] T042 [US5] Create `source/app/screens/AudioBook/logic/miniPlayerSync.ts`: subscribe to `audioPlayerStore` (+ appearance / language stores) and publish `MiniPlayerStateDto` (immediately on any non-position change, ≤ 4/s for position while playing, `null` on `dispose`); handle `onCommand` (toggle, play, pause, skipBack, skipForward, previous, next, seek clamped, retryTrack, openPlayer → navigate + `showMainWindow` handled by Main, endSession); track `windowChanged` in a small store used by T027; start it from `source/app/App.tsx` on Desktop (never in the floating window: it has its own root, T043)
- [X] T043 [US5] Create the adapter `source/app/platforms/miniPlayerWindow.electron.ts` (the only file reading `window.miniPlayerWindow`: `onState`, `command`, `returnToApp`, `close`) and `miniPlayerWindow.native.ts` (inert stub, same exports); create `source/app/screens/MiniPlayerWindow/MiniPlayerWindowRoot.tsx` + `MiniPlayerWindow.tsx`, and in `source/app/main.tsx` mount `MiniPlayerWindowRoot` INSTEAD of `App` when `location.search` has `window=mini-player` (no App providers, no ShortcutsBridge / SessionFlushBridge / import queue / miniPlayerSync, no `window.api` use): theme + language from the DTO, cover, title, subtitle, skip back / play-pause / skip forward, thin seek slider, "Return to app", ✕; body `-webkit-app-region: drag`, controls `no-drag`; Space / ← / → while focused; `focus-ring`; `trackFailed` with warning colours and "Try again" / "Skip to next track" (when there is one) / "Open player"; texts in `chrome.miniPlayer.*`
- [X] T044 [US5] Add the "Show the floating player when the window is minimised or hidden" toggle (`miniPlayer.getPrefs/setPrefs`, `autoOpen`) to `source/app/screens/Settings/components/notifications/BackgroundTrayCard.tsx` with en + vi texts in `settings.ts`
- [X] T045 [US5] Create `source/app/platforms/electron/spikes/audio/run-mini-player.mjs` + script `spike:audio:mini-player` in `package.json` (stubbed `electron`, like `spikes/background`): auto-open on minimise / hide, close on restore only when automatic, no reopen after a user close in the session, `publishState(null)` closes, invalid DTOs dropped, prefs default / off-screen correction, tray entry texts; extend `spike:audio:store` (`run-audio-store.mjs`): unmount keeps playing, `load(other)` disposes first, `endSession` persists

**Checkpoint**: US5 testable (quickstart 6–11, 17).

---

## Phase 6: User Story 3 — System media controls (P2)

**Goal**: Windows media flyout / media keys show and drive the session.

**Independent Test**: quickstart row 5.

- [X] T046 [US3] Create `source/app/screens/AudioBook/logic/mediaSessionBridge.ts` per research R7: on session `ready` set `navigator.mediaSession.metadata` (title = chapter / track title or book title, artist = author, album = book title, artwork = 256 px `data:` URL drawn once per book from the cover loaded with `crossOrigin = 'anonymous'` — make the `rb-cover` handler in `source/app/platforms/electron/files/cover-protocol.ts` answer `Access-Control-Allow-Origin: *` (Main change, approval line) so the canvas is not tainted; none only without a cover); handlers `play`, `pause`, `previoustrack` / `nexttrack` (set to `null` exactly when the player's buttons are disabled), `seekbackward` / `seekforward` (chosen skip lengths), `seekto`; `setPositionState` on load / seek / rate / chapter change; `playbackState`; clear everything on `dispose()`; start it next to `miniPlayerSync` on Desktop (`isFeatureAvailable('miniPlayer')`)
- [ ] T047 [US3] Manually verify on Windows (quickstart row 5) that SMTC shows title / chapter / author / cover ≤ 2 s and that ⏯ ⏭ media keys work; if the `data:` artwork does not show, implement the R7 fallback (`miniPlayer:mediaArtwork`: Main writes `{temp}/readmate-media/<bookId>.png`, returns its `file://` URL, removes it on session end; four-place IPC rule + approval line) and record the result under research R7 in `specs/018-audiobook-desktop-ui-polish/research.md`

**Checkpoint**: US3 testable.

---

## Phase 7: User Story 4 — Calmer, consistent player layout (P3)

**Goal**: one progress indicator, vector rail icons, skip symbols + chosen lengths, mute, marker placement, reduced
motion, rewind on resume, keyboard resize, 12 px text, two columns, Notes search.

**Independent Test**: quickstart rows 12–16.

### Core (pure) + tests

- [X] T048 [P] [US4] Create `source/core/src/audio/listening-prefs.ts`: `SKIP_LENGTHS = [5, 10, 15, 30, 60] as const`; `normalizeListeningPrefs(raw)` → `{ skipBackSeconds (default 15), skipForwardSeconds (default 30), autoRewind (default true), muted (default false), volumeBeforeMute (0–1 clamped, default 1) }` ("other → default"); `resumeRewindSeconds(pausedForMs)`: `< 60 000` → 0, `< 600 000` → 3, `< 3 600 000` → 5, else 10; `applyResumeRewind(position, pausedForMs, floorSeconds) = max(floorSeconds, position − resumeRewindSeconds(pausedForMs))`; export from `source/core/src/index.ts`
- [X] T049 [P] [US4] Create `source/core/tests/audio/listening-prefs.test.ts` covering every boundary above (59 999 / 60 000 / 599 999 / 600 000 / 3 599 999 / 3 600 000 ms), the floor clamp and invalid prefs
- [X] T050 [P] [US4] Create `source/core/src/app-models/audio-note-filter.ts`: `filterAudioNotes(notes, { query, chapterId }, chapters, tracks)` using `parseTextSearchQuery` + `createTextMatcher` from `search/text-search.ts` on the Note text and its chapter / track title; `groupNotesByChapter(notes, chapters)`; never mutates or reorders the input; export from `source/core/src/index.ts`
- [X] T051 [P] [US4] Create `source/core/tests/app-models/audio-note-filter.test.ts` (Vietnamese without accents matches accented text, case-insensitive, chapter filter, both combined, empty query = all, order kept)

### Renderer

- [X] T052 [US4] Create `source/app/screens/AudioBook/logic/listeningPrefsStore.ts` (zustand, `localStorage` `readmate.audioListeningPrefs.v1`, `normalizeListeningPrefs`, setters, `reset()`) and add its resetter line to `APP_SETTINGS_RESETTERS` in `source/app/screens/Settings/logic/resetAppSettings.ts` (label `settings.advanced.groups.audiobook`, en + vi)
- [X] T053 [US4] In `source/app/screens/AudioBook/logic/audioPlayerStore.ts`: keep mute in `listeningPrefsStore` (`muted`, `volumeBeforeMute`; dragging the volume lifts mute); `skipBack()` / `skipForward()` use the chosen lengths; record `pausedAt` on every pause (button, shortcut, media key, sleep timer, Read Aloud) and clear it on seek / `goToPosition` / track switch; in `play()` apply `applyResumeRewind` with floor = current chapter start (validated chapters) else 0 when `autoRewind` and `pausedAt` is set
- [X] T054 [US4] In `source/app/screens/AudioBook/components/AudioControls.tsx`: skip buttons with ↺ / ↻ SVG + the current seconds (label, `aria-label`, `title` from `audiobook.player.controls.skipBack|skipForward { seconds }`); speaker button (mute toggle, `aria-pressed`, muted icon) replacing the "Vol" label; a "Listening" `AudioSelect`-style menu with skip back / skip forward lengths and "Rewind on resume" on / off; `motion-reduce:active:scale-100` on the play button
- [X] T055 [US4] In `source/app/screens/AudioBook/components/AudioTimeline.tsx`: draw note markers in a 10 px strip above the slider track (never over the thumb) with 24 × 24 px hit areas; replace `label.toLowerCase()` with dedicated messages `audiobook.player.timeline.seekWholeBook|seekChapter|seekTrack` (en + vi) (FR-016, FR-018)
- [X] T056 [US4] In `source/app/screens/AudioBook/AudioBookScreen.tsx`: render `BookProgress` only when `scope === 'chapter'` and move the "x % · time left" text next to `ProgressScopeSelector` in Book scope (single-file only) (FR-012)
- [X] T057 [US4] In `source/app/screens/AudioBook/AudioBookScreen.tsx`: make `<main>` a container (`@container`) and lay out per FR-032 — `@min-[1024px]:` two columns (cover `w-[clamp(320px,32cqw,440px)]` keeping proportions | now-playing, progress summary, scope, timeline, notices, transport, secondary row), one centred column with a 180 px cover below; no JS measurement
- [X] T058 [US4] Switch `source/app/screens/Reader/components/sidebar/sidebarTabs.ts` from emoji strings to icon ids and render `SidebarTabIcon` in `source/app/screens/Reader/components/sidebar/SidebarEdgeRail.tsx` (text reader + player)
- [X] T059 [US4] Make the resize handle in `source/app/screens/AudioBook/components/AudioSidebar.tsx` keyboard-operable: `tabIndex={0}`, `aria-valuenow/min/max` in px, ← / → ±16 px, Home / End to min / max, `focus-ring`, width kept like a drag (via `useSidebarPanelResize` in its current file)
- [X] T060 [US4] Raise every `text-[10px]` / `text-[11px]` in `source/app/screens/AudioBook/components/AudioSidebar.tsx` (note cards, badges, dates, group rows) to at least `text-xs` (12 px)
- [X] T061 [US4] Create `source/app/screens/AudioBook/logic/audioNoteFilterStore.ts` (`{ bookId, query, chapterId, groupByChapter }`, session-only, cleared when the player's `bookId` changes) and add to the Notes tab in `source/app/screens/AudioBook/components/AudioSidebar.tsx`: `type="search"` field with a screen-reader label, chapter filter (single-file with chapters), "Group by chapter" toggle (`aria-pressed`), `role="status"` count, empty state with "Clear"; multi-track keeps its track groups narrowed by the search; markers unaffected; a new Note hidden by the filter → feedback with "Show" that clears it; texts `audiobook.player.sidebar.search*` en + vi
- [X] T062 [US4] Add `motion-reduce:transition-none` to the player `<main>` padding transition and the sidebar slide in `source/app/screens/AudioBook/AudioBookScreen.tsx`, `AudioSidebar.tsx` and `source/app/screens/Reader/components/sidebar/SidebarEdgeRail.tsx` (FR-017)

**Checkpoint**: all stories testable.

---

## Phase 8: Polish & cross-cutting

- [X] T063 [P] Add glossary anchors for "Trình phát thu nhỏ" and "Mở cửa sổ nổi" to `source/core/tests/i18n/glossary-anchors.test.ts`
- [X] T064 [P] Update `CLAUDE.md` (Audiobooks paragraph: listening session lifetime, mini bar, floating window + `MiniPlayerChannels`, tray entry, media session, `audiobook` shortcut context, listening prefs key, new spikes) and add `docs/implementation_plan/audiobook_desktop_player.md` mapping spec 018 to files
- [X] T065 Run `npm run check` (typecheck, lint, tests, boundaries, platform adapters, build-split) and `npm run check:desktop-baseline`; fix failures
- [ ] T066 Run the spikes `spike:theme:contrast`, `spike:settings:shortcuts`, `spike:audio:store`, `spike:audio:mini-player`, `spike:settings:reset` and walk quickstart rows 1–17 on Windows; record R4 / R5 / R7 **verify** outcomes in `specs/018-audiobook-desktop-ui-polish/research.md`

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T006)** → stories.
- **US1** needs T003–T005 (tokens, focus ring). **US2** needs nothing beyond Phase 2. US1 and US2 can run in
  parallel (different files except `AudioBookScreen.tsx`: do T007 before T018).
- **US5** needs T002 (feature flag); its Main part (T032–T040) and renderer part (T041–T044) meet in T042. T026–T028
  (in-app bar) can ship before the floating window.
- **US3** needs US5's session lifetime (T021–T022) so the media session survives leaving the player and is cleared on
  `endSession`.
- **US4** needs T006 (icons) and, for skip lengths in the mini bar / floating window / media session, should land
  after US5 and US3 (T053 also feeds `miniPlayerSync` and `mediaSessionBridge`); its core tasks T048–T051 can start
  any time.
- **Polish** after the stories it documents.

Within a story: core / DTO tasks → stores → components → wiring → spike.

## Parallel Opportunities

- Phase 1: T001 ∥ T002. Phase 2: T006 ∥ T003–T005.
- US1: T007 ∥ T008; then T009 ∥ T010.
- US2: T012 ∥ T016 ∥ T017.
- US5: T025 ∥ T032 ∥ T033 ∥ T041; Main T034–T037 while the renderer does T026–T031.
- US4: T048 ∥ T049 ∥ T050 ∥ T051 (core), then T054 ∥ T055 ∥ T058 ∥ T060 (different files).

### Parallel example: User Story 4

```text
T048 core listening-prefs.ts     ∥  T050 core audio-note-filter.ts
T049 its vitest                  ∥  T051 its vitest
then: T054 AudioControls.tsx  ∥  T055 AudioTimeline.tsx  ∥  T058 sidebarTabs/SidebarEdgeRail  ∥  T060 AudioSidebar text sizes
```

## Implementation Strategy

1. **MVP = US1 + US2** (T001–T020): fixes the accessibility defects (invisible warnings, no focus, mouse-only
   player). Ship, `npm run check`, quickstart 1–4.
2. **US5 in-app** (T021–T031): keep listening while browsing / reading.
3. **US5 floating + tray** (T032–T045): verify R4 / R5 on Windows before closing.
4. **US3** (T046–T047).
5. **US4** (T048–T062), then Polish (T063–T066).

Commit after each task group; keep `npm run check` green between increments.
