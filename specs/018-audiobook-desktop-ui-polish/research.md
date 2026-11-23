# Research: Audiobook player on Desktop (spec 018)

Every decision below was taken from reading the current code (2026-11-23). Items marked **verify** need a
spike / manual check before the dependent task is closed; each names its fallback.

## R1 — Who owns the listening session

- **Decision**: the existing module-level `audioPlayerStore` (`screens/AudioBook/logic/audioPlayerStore.ts`) IS the
  session. Its `<audio>` element is created with `new Audio()` outside the DOM, so it already survives a route change;
  what ends playback today is `AudioBookScreen`'s unmount effect calling `dispose()`. That call moves out of the
  screen: `dispose()` runs only on an explicit end (mini bar ✕, floating window ✕, opening another audiobook — `load()`
  of a different `bookId` — removing the book, closing the audiobook's open-book tab, quit flush).
- **Rationale**: no second player, no state copy; every surface (player, mini bar, floating window, tray, media
  session, shortcuts) reads and drives one store (FR-022).
- **Alternatives**: a new "session" store wrapping the player (duplicate state, two sources of truth); keeping the
  player mounted invisibly (keeps the whole screen's effects alive, fights the router).

## R2 — In-app mini player bar placement

- **Decision**: `components/audio/MiniPlayerBar.tsx` mounted once in `App.tsx`'s content tier (next to
  `ImportQueueCard`), shown when `audioPlayerStore.bookId !== null` and the current route is not
  `/reader/<that bookId>`; Desktop only (`isFeatureAvailable('miniPlayer')`, false on the Mobile host). It publishes
  its height as the CSS variable `--mini-player-height` on the app frame (0 when hidden). Library / Collections /
  Settings pad their scroll area by it; the text reader adds it to the reader's bottom inset (R3).
- **Rationale**: one mount point, no per-screen wiring; a CSS variable keeps layout code declarative.
- **Alternatives**: per-screen bars (duplication); an overlay without reserved space (covers content — violates FR-020).

## R3 — Mini bar in the text reader

- **Decision**: the bar sits at `bottom: READER_FOOTER_HEIGHT_PX` (above the fixed footer) or at `bottom: 0` when the
  footer is hidden (immersive). `readerChromeBottomInset` gains a `miniPlayerHeight` argument: the bar height is
  reserved in BOTH paginated and scroll view (paginated columns would otherwise be drawn under it), plus the footer as
  today in scroll view. A change of the bar's presence triggers the same EPUB resize path as a sidebar toggle
  (`scheduleEpubResizeAfterChromeTransition`); PDF / TXT / Markdown re-measure through their existing resize observers.
- **Read Aloud**: `readAloudStore`'s `readViewport` / `readFromPosition` / `togglePlayPause` (resume) call
  `audioPlayerStore.getState().pause()` first (FR-024); nothing resumes it afterwards.
- **Alternatives**: hiding the bar in the reader (rejected by clarification Q2).

## R4 — Floating always-on-top window

- **Decision**: a second `BrowserWindow` created by Main (`platforms/electron/mini-player/`): ~360 × 132 px, frameless,
  `alwaysOnTop: true` (level `floating`), not resizable, `skipTaskbar: true`, same `sandbox` / `contextIsolation`
  settings, its own small preload (`mini-player-preload.ts`) exposing only `miniPlayerWindow.*`. It loads the SAME
  renderer bundle at `#/mini-player` (route rendered without menubar / tabs) so components, i18n catalogue, theme
  tokens and icons are shared. It does NOT play audio: it is a remote control.
- **State relay** (contract `contracts/mini-player-ipc.md`): the main renderer publishes a `MiniPlayerStateDto` to Main
  on every relevant change, throttled to ≤ 4 per second while playing; Main keeps the last one and forwards it to the
  floating window (and uses it for the tray, R6). Commands from the floating window go Main → main renderer, which
  runs them on `audioPlayerStore`. Only plain data crosses; no path, the cover as the existing `rb-cover://` URL.
- **Position**: Main-owned prefs file `{userData}/mini-player-prefs.json` (`json-prefs-file.ts`): `{ x, y,
  autoOpen }`; on open the saved point is checked against `screen.getAllDisplays()` work areas and moved onto the
  nearest visible display when off-screen (edge case).
- **Theme / language**: carried in the state DTO (`theme`, `uiLanguage`) so the floating window follows live changes
  without its own stores.
- **verify**: frameless `alwaysOnTop` window stays above a full-screen-ish normal window on Windows 11; fallback:
  level `screen-saver` is NOT used (too aggressive) — accept `floating` and document.
- **Alternatives**: Document Picture-in-Picture (`documentPictureInPicture`) — Chromium-only API, no control over
  position persistence / tray coupling, behaviour in Electron 39 unverified; an OS-native toast — not interactive enough.

## R5 — Main window minimise / hide

- **Decision**: Main listens to the main window's `minimize`, `hide` (the Run-in-Background close path ends in
  `target.hide()`), `restore` and `show`. While `sessionActive` (sent by the renderer, R6) and `autoOpen` and not
  `closedByUserThisSession`, minimise / hide opens the floating window (`openedAutomatically = true`); restore / show
  closes it only if it was opened automatically. Quitting goes through the existing `isQuitting` path: the renderer's
  registered session flush already persists audio progress (`registerSessionFlushHandler` in the player store).
- **verify**: playback in a hidden / minimised window is not throttled: Chromium exempts audible pages from
  background timer throttling, and the 1 s progress timer only needs ~1 Hz. Spike: hide the window 10 min, check
  saved `audioProgress` advances and the audio has no gaps. Fallback: `webPreferences.backgroundThrottling: false`
  on the main window (Main change, approved in `desktop-main-changes.json`).
- **Alternatives**: pausing on hide (rejected by clarification Q3).

## R6 — Tray menu

- **Decision**: `trayMenuTemplate()` takes an optional audiobook entry `{ title, playing }` from the last state DTO:
  `▶ Play "<title>"` / `⏸ Pause "<title>"` (translated `main.shell.tray.audiobookPlay|Pause` with a `{ title }`
  param), placed above "Open"; rebuilt when `playing` / title / language change (not on every position tick). Click →
  command `toggle` to the main renderer.

## R7 — System media controls

- **Decision**: `navigator.mediaSession` in the main renderer (`screens/AudioBook/logic/mediaSessionBridge.ts`,
  subscribed to `audioPlayerStore`): `metadata` (title = chapter / track title or book title, artist = author,
  album = book title, artwork), action handlers `play`, `pause`, `previoustrack` / `nexttrack` (set to `null` exactly
  when the player's buttons are disabled), `seekbackward` / `seekforward` (chosen skip lengths), `seekto`;
  `setPositionState` on load, seek, rate change and chapter change (not every tick). Cleared (`metadata = null`,
  handlers `null`) on `dispose()`. Electron on Windows maps this to SMTC.
- **Artwork**: SMTC fetches artwork outside the page, so a custom-scheme URL may not load. The bridge draws the
  cover into a 256 px canvas once per book and passes a `data:` URL. **verify** on Windows; fallback: no artwork.
- **Alternatives**: Electron `globalShortcut` for media keys (duplicates Chromium's own media-key handling, no panel).

## R8 — Player keyboard shortcuts

- **Decision**: a new `ShortcutContext` `'audiobook'` and group `'audiobook'` in `shortcutDefinitions.ts`. Because
  text books and audiobooks share `/reader/:bookId`, `ShortcutsBridge.contextOf` reads a tiny
  `shortcutScreenStore` (`{ readerKind: 'text' | 'audio' }`) set by `ReaderRoute` once the format is known; `/reader`
  + `audio` → `'audiobook'`. New ids `audiobook.playPause|skipBack|skipForward|previousChapter|nextChapter|volumeUp|
  volumeDown|mute|speedDown|speedUp|addNote`, `allowBare: true`; `skipBack/skipForward/volume*` `allowRepeat: true`.
  The bridge already leaves plain keys to text fields and Space / Enter to focused buttons; it gains the rule "arrow
  keys belong to a focused `input[type=range]`, `[role=slider]`, `[role=radiogroup]`, `[role=listbox]` /
  `[role=menu]`" (FR-006). The hand-written Space listener in `AudioBookScreen` is removed.
- **Rationale**: Settings lists / rebinds / resets them with the existing machinery; contexts keep ← / → of the text
  reader (page turns) and of the player apart in conflict detection.

## R9 — Resume rewind and skip lengths

- **Decision**: pure core functions in `source/core/src/audio/listening-prefs.ts`: `SKIP_LENGTHS = [5,10,15,30,60]`,
  `normalizeListeningPrefs(raw)`, and `resumeRewindSeconds(pausedForMs)` (0 / 3 / 5 / 10) + `applyResumeRewind(position,
  pausedForMs, floorSeconds)` (floor = start of current chapter, or 0 / track start). The store records `pausedAt`
  (`Date.now()`) on every pause incl. the sleep timer's and applies the rewind in `play()` unless a seek / Note jump
  happened since the pause (`pausedAt` cleared by `seek*` / `goToPosition`). Prefs live in renderer `localStorage`
  `readmate.audioListeningPrefs.v1` `{ skipBackSeconds, skipForwardSeconds, autoRewind, muted, volumeBeforeMute }`,
  added to `APP_SETTINGS_RESETTERS`.
- **Rationale**: testable in vitest; app preferences stay in renderer stores (CLAUDE.md "App preferences").

## R10 — Notes search / filter

- **Decision**: core `app-models/audio-note-filter.ts`: `filterAudioNotes(notes, { query, chapterId }, chapters,
  tracks)` using `parseTextSearchQuery` + `createTextMatcher` from `search/text-search.ts` (already NFD-folds
  Vietnamese marks, case-insensitive), and `groupNotesByChapter`. UI state in a session-only zustand store
  `audioNoteFilterStore` (same lifetime rules as `audioNoteGroupsStore`: cleared when the player's `bookId` changes).

## R11 — Wide two-column layout

- **Decision**: CSS container queries (Tailwind v4 `@container` on the player `<main>`, variant `@min-[1024px]:`):
  the container is the area left after the sidebar, so opening the sidebar falls back to one column with no JS
  (FR-032). Cover `w-[clamp(320px,32cqw,440px)]` in two columns, `w-[180px]` in one.
- **Alternatives**: `ResizeObserver` + state (re-renders, can reset the timeline drag — FR-032 forbids it).

## R12 — Theme warning colours, focus ring, icons, motion

- **Warning**: tokens `--lib-warning-bg`, `--lib-warning-border`, `--lib-warning-text` per theme in
  `styles/theme.css`, mapped in `index.css` `@theme` as `--color-lib-warning-*`; contrast checked with the existing
  `spike:theme:contrast` script (extended with these pairs).
- **Focus**: one utility class `focus-ring` in `index.css` (`focus-visible:outline-2 outline-offset-2
  outline-lib-accent`) used by player, mini bar, floating window and rail; contrast ≥ 3:1 also checked in the spike.
- **Rail icons**: `sidebarTabs.ts` `icon` becomes an icon id rendered by a new `SidebarTabIcon` (inline SVG, stroke
  1.8 like the toolbar); shared by text reader and player.
- **Motion**: `motion-reduce:` variants on the sidebar padding / slide transitions and `active:scale-95`.

## R13 — Mobile host

- **Decision**: none of this ships on the phone. `AppFeature` gains `'miniPlayer'` (Electron true, native false); the
  new `miniPlayer` api group is added to the Mobile `create-api.ts` as `NOT_AVAILABLE_ON_PLATFORM` (the typed
  `Window['api']` requires it). Shortcuts / media session code is behind the same feature check.
