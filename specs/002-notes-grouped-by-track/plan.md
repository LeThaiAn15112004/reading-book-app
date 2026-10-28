# Implementation Plan: Notes Grouped by Track

**Branch**: `002-notes-grouped-by-track` (spec directory name; the working branch is not changed by this plan) | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-notes-grouped-by-track/spec.md` (clarified 2026-10-25: "chapter" = track; only the playing track's row is open by default)

## Summary

Replace the flat Notes list of a **multi-track** audiobook with one **collapsible row per track that holds Notes**. This is a presentation change only: no storage, IPC, Main-process or migration change. The work is:

1. a pure SDK helper that groups the already-ordered Notes by track (only tracks that have Notes, in playback order, with a count);
2. a small renderer store for the **session-only** open/closed state of the rows (per audiobook), seeded with the playing track and told when a Note is added;
3. a one-field signal in the existing player store (`lastAddedNote`) so a Note added from *any* entry point opens its row;
4. a rewrite of the multi-track branch of `NotesTab` in `AudioSidebar.tsx` to render rows (button with `aria-expanded`) and, inside an open row, the **existing** `NoteCard`.

Everything a Note can do today (jump, edit, delete, "Here", timeline markers, the Note menu, limits, fallback on a failed track) is reused untouched. Single-file audiobooks keep their flat list.

## Technical Context

**Language/Version**: TypeScript (ES2022); React 18 renderer. No change to Electron Main/Preload.

**Primary Dependencies**: existing only — `zustand` (the project prefers zustand stores for custom hooks), `vitest` (SDK). **No new dependencies.**

**Storage**: none new. Notes stay in `reading_state_json.audioBookmarks`. Open/closed state of rows lives in memory only (spec FR-016: not persisted across restarts), so there is no `localStorage` key and nothing to reset.

**Testing**: SDK `vitest` for the pure grouping helper; the existing standalone spike `spike:audio:store` (real renderer stores with a scriptable `Audio`) for the new store behaviour; desktop `typecheck`, `lint`, `npx vite build`. The desktop has no component runner, so the JSX is kept trivial and every decision is in the SDK helper or the store. **No Electron window, no E2E.**

**Target Platform**: Desktop app (Electron, Windows primary). Mobile scaffold untouched.

**Project Type**: desktop-app on top of the platform-agnostic `book-reader-sdk`.

**Performance Goals**: SC-005 — 500 Notes across the maximum tracks: opening the tab and toggling rows never freezes > 1 s. Grouping is O(n) over an already-ordered list in a `useMemo`; **a closed row renders no Note cards**, so an audiobook with 68 groups mounts 68 small headers plus only the open rows' cards.

**Constraints**: single-file Notes unchanged (FR-017); Note storage/limits/jump/markers unchanged (FR-018); no sync/export/search/filter, no progress or totals (FR-019); keyboard + assistive technology (FR-020); SDK `src` stays free of Electron/Node/DOM/React.

**Scale/Scope**: ≤ 5 000 tracks, ≤ 500 Notes. About 4 source files change (1 new SDK function in an existing file, 1 new renderer store, 1 field in the player store, 1 component file) plus tests: roughly 150–250 lines.

## Constitution Check

`.specify/memory/constitution.md` is still the **unfilled template** (placeholders such as `[SECTION_2_NAME]`), so it ratifies no gates. As for feature 001, the project rules in `CLAUDE.md` are used as the gates:

| Gate (source) | Result |
|---|---|
| SDK `src` never imports Electron / Node / DOM / React | **Pass** — `groupNotesByTrack` is a pure function on plain data. |
| Renderer never touches SQL / paths; IPC assembled in four synced places | **Pass** — no IPC change at all. |
| Book file never mutated; overlay data keyed by `bookId` | **Pass** — nothing is written. |
| Application preferences are not in SQLite; renderer prefs live in their own store/localStorage | **N/A** — the open/closed state is deliberately *not* a preference and not persisted. |
| Zustand for custom hooks (user memory) | **Pass** — row state is a zustand store. |
| Unit tests only in the SDK; desktop checks are spikes; E2E manual-only | **Pass** — see Verification. |
| Files never to be touched without an explicit reason (migrations, `preload.ts`, `channels.ts`, `bridge/audio.ts`, `sqlite-*-store.ts`, ZIP import, `packages/config`, PDF/EPUB/TXT) | **Pass** — none is in the change set. |

Post-design re-check: **no violations**, Complexity Tracking is empty.

## Findings from the repository (what the plan stands on)

Verified in source on 2026-10-25, after feature 001 was implemented.

1. **The current multi-track Notes tab is a flat list** (`NotesTab` in `src/screens/AudioBook/components/AudioSidebar.tsx`): it renders `NoteCard` for every Note in `audioPlayerStore.notes`, passing `trackNoteLabel(n, tracks)` ("12 · Title") as the card's small caption. That caption is what the row header replaces.
2. **The ordering already exists and is stable**: `audioPlayerStore.notes` for a multi-track book is kept in `orderTrackNotes` order (track index, then second, then `createdAt`) by `load`, `addNote` and `reloadNotes`. Grouping can therefore be a single pass; it still re-orders defensively through `orderTrackNotes` so the helper is correct on its own.
3. **Everything a Note does is wired to the Note id, not to the list**: `NoteCard` calls `goToNote(id)` and opens the shared Note menu through `useNoteMenuStore.openFor(id, element)`; the timeline markers use the same store; `AudioNoteMenu` finds the Note by id in `audioPlayerStore.notes`. A Note inside an open row therefore keeps *all* behaviour (FR-010/011) with no new wiring.
4. **A Note can be added from two places that exist even when the Notes tab is not mounted**: the "+ Note" pill in `AudioControls` and the button inside `NotesTab`. Both call `audioPlayerStore.addNote()`. To open the right row for either (FR-013), the signal must come from the player store, not from the tab's button handler.
5. **`audioPlayerStore.load()` resets `notes` to `[]` and then sets the list**, and `reloadNotes` replaces the list after a refused save. Detecting "a Note was added" by diffing `notes` would misfire on both, so a dedicated signal set only in the multi-track branch of `addNote` is used (see D3).
6. **The sidebar panel is unmounted when closed** (`AudioSidebarPanel` returns `null` when `!open`), and `PanelBody` switches components by tab. Any state kept inside `NotesTab` (React `useState`) would be lost when the sidebar or tab closes — which FR-016 forbids. The state must live outside the component.
7. **"Current track" is a primitive in the store** (`tracks[trackIndex].id`), so a selector that returns it re-renders a row only when the track changes, not on every playback tick. (`useIsHere` in `NoteCard` already follows this pattern.)
8. **Unplayable tracks and unknown-track Notes need no special handling here**: Main already refuses to return Notes of unknown tracks, and `orderTrackNotes` drops any that slip through, so every group maps to a real track (spec edge case "Notes whose track is unknown").

## Design decisions (full rationale in [research.md](./research.md))

- **D1 Grouping is a pure SDK function**: `groupNotesByTrack(notes, tracks)` → `TrackNoteGroup[]` (`trackId`, `index`, `track`, `notes`, `count`). Only tracks with ≥ 1 Note, in track order; Notes inside a group in time order. It lives in the existing `audio-track-notes.ts` next to `orderTrackNotes` (no new file). FR-001–003, FR-007.
- **D2 Open/closed state is a separate session-only zustand store** (`audioNoteGroupsStore`): `open: Record<trackId, true>` for the current audiobook only, `seeded: boolean`. It is keyed implicitly by the audiobook: it **resets whenever the player store's `bookId` changes** (including leaving and reopening the book), which satisfies "not applied to another audiobook" and "kept while the audiobook stays open". Not persisted. FR-005, FR-006, FR-016.
- **D3 "A Note was added" is a signal from the player store**: a new field `lastAddedNote: { id, trackId } | null`, set only in the multi-track branch of `addNote` (one new object per add), reset by `INITIAL`. The groups store subscribes to the player store and, when this field changes to a non-null value, opens that track's row. This works from the "+ Note" pill, from the tab's button, with the sidebar closed, and does not fire on `load`, `reloadNotes`, edit or delete. FR-013.
- **D4 Default open state is seeded when the Notes tab is first shown for the audiobook** (`ensureSeeded(currentTrackId)` from `NotesTab`'s mount effect): if not yet `seeded`, mark seeded and open the playing track's row. A row opened earlier by D3 stays open (seeding only *adds*). Seeding never runs again for the same audiobook, and a track change never opens or closes a row (FR-015). FR-009.
- **D5 The current track is marked from a primitive selector** in the row header (a small "Playing" pill + `aria-current`), independent of whether the row is open or has been toggled. FR-014.
- **D6 Rendering**: a closed row renders only its header; an open row renders the existing `NoteCard` list. The header is a real `<button>` (Enter/Space for free) with `aria-expanded`, `aria-controls` and an accessible name "Track 12, Title, 3 notes". The `NoteCard` in a group no longer receives the track caption (the header already names the track); the Note menu still names the track. FR-005, FR-008, FR-020.
- **D7 Counts and rows are derived, never stored**: the groups are a `useMemo` over `notes` and `tracks`, so add/edit/delete update rows and counts at once, a first Note creates a row, and the last Note removes it (FR-012). Open-state entries for tracks that no longer have Notes are harmless and are not cleaned up (they would simply apply again if a Note is re-added in that track in the same session — acceptable, and D3 opens it anyway).
- **D8 Unavailable / empty states are unchanged**: when `notesUnavailable` the existing message replaces the rows; when there are no Notes the existing empty state is shown (FR-004). When the Notes become readable again the rows reappear in whatever open state the store holds (seeding runs only once).
- **D9 Single-file path untouched**: the single-file branch of `NotesTab` and `NoteCard`'s signature for it are not changed (FR-017).

## Project Structure

### Documentation (this feature)

```text
specs/002-notes-grouped-by-track/
├── plan.md              # This file
├── research.md          # Phase 0 decisions and alternatives
├── data-model.md        # Phase 1: derived entities (track group, row state) and state transitions
├── quickstart.md        # Phase 1: how to verify (commands + manual script)
├── contracts/
│   ├── sdk-note-groups.md     # pure helper contract (groupNotesByTrack)
│   └── notes-tab-ui.md        # row/store/signal contract for the renderer
├── checklists/requirements.md
└── tasks.md             # NOT created here (/speckit-tasks, after approval)
```

### Source Code (files this feature touches)

```text
source/apps/book-reader-sdk/
├── src/audio/
│   ├── audio-track-notes.ts        # CHANGE: add groupNotesByTrack + TrackNoteGroup type
│   └── index.ts                    # CHANGE: export them
└── tests/audio/
    └── audio-track-notes.test.ts   # CHANGE: add grouping cases (existing cases untouched)

source/apps/reading-book-desktop/
├── src/screens/AudioBook/
│   ├── logic/
│   │   ├── audioPlayerStore.ts         # CHANGE (one field): lastAddedNote, set in multi-track addNote, reset in INITIAL
│   │   └── audioNoteGroupsStore.ts     # NEW: session-only open/closed rows, seeding, subscription to lastAddedNote / bookId
│   └── components/
│       └── AudioSidebar.tsx            # CHANGE: multi-track branch of NotesTab renders TrackNoteGroup rows
└── spikes/audio/
    └── run-audio-store.mjs             # CHANGE: add the groups-store suite (existing checks unmodified)
```

Not touched: Main/Preload/IPC/`api-types.ts`, SQLite stores, migrations, `AudioControls.tsx`, `AudioTimeline.tsx`, `AudioNoteMenu.tsx`, `AudioBookScreen.tsx`, `audioNoteMenuStore.ts`, ZIP import, PDF/EPUB/TXT, `packages/config`, package files.

Documentation to update during implementation: the audiobook paragraph of `CLAUDE.md` (one sentence: multi-track Notes tab groups Notes by track; row state is session-only).

**Structure Decision**: no new packages or layers. The decision logic goes in the SDK next to its sibling helpers; UI state in a tiny zustand store beside `audioNoteMenuStore`; the component change is confined to `NotesTab`.

## Requirement → change map

| Spec | Where it is satisfied |
|---|---|
| FR-001/002/003 rows only for tracks with Notes, in order, with number + title + count | `groupNotesByTrack`; row header in `NotesTab` |
| FR-004 empty / unavailable states | unchanged branches kept in `NotesTab` (D8) |
| FR-005/006 open/close, several open | `audioNoteGroupsStore.toggle`; header `<button aria-expanded>` |
| FR-007/008 time order inside, timestamp + text, plain marker | `groupNotesByTrack` (order) + existing `NoteCard` |
| FR-009 first-shown default | `ensureSeeded` (D4) |
| FR-010/011 jump, edit, delete, "Here", menu, markers | existing `NoteCard` / `useNoteMenuStore` / `AudioNoteMenu` / `AudioTimeline` — no change |
| FR-012 live counts and rows | derived `useMemo` (D7) |
| FR-013 add opens its row | `lastAddedNote` + store subscription (D3) |
| FR-014/015 current-track mark; no auto open/close | primitive selector (D5); seeding only once (D4) |
| FR-016 memory per audiobook, not across restarts | in-memory store reset on `bookId` change (D2) |
| FR-017/018/019 boundaries | single-file branch untouched; no storage/IPC change; nothing added for search/export |
| FR-020 keyboard + assistive tech | native button, `aria-expanded`, `aria-controls`, accessible name (D6) |

## Regression risks and mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | The single-file Notes tab changes by accident. | Only the multi-track branch of `NotesTab` is edited; the single-file branch and `NoteCard`'s single-file output stay identical; the existing single-file store-spike checks run unmodified. |
| R-2 | Row state is lost when the sidebar/tab closes (state in the component). | State is in a store outside React (finding 6); a spike check closes/reopens by re-reading the store, and the quickstart manual script does it in the UI. |
| R-3 | Adding a Note from the "+ Note" pill (tab not mounted) does not open the row. | Signal comes from the player store (D3), asserted in the spike with no component involved. |
| R-4 | A `load`/`reloadNotes`/edit/delete is mistaken for "a Note was added" and opens a row. | `lastAddedNote` is set only by multi-track `addNote`; spike asserts it is unchanged by load, refused-save reload, edit and delete. |
| R-5 | Open rows leak to another audiobook, or survive leaving/reopening the same one. | Reset on `bookId` change (D2); spike switches books and reopens one. |
| R-6 | Track changes (Contents, next, auto-advance, Note jump, fallback) open/close rows. | Nothing subscribes to `trackIndex` except the read-only "Playing" mark; spike drives all of those and asserts the open map is unchanged. |
| R-7 | A group's count or the sum of counts disagrees with the Notes. | SDK property test: every Note appears in exactly one group; sum of counts = number of Notes of known tracks. |
| R-8 | 500 Notes in one open row or 68 open rows is slow. | Closed rows render no cards; plain list otherwise; `content-visibility: auto` on cards only if the manual check shows a need (measured once, SC-005). |
| R-9 | Accessibility regressions (focus lost when a row closes, no name). | Header is a native button that keeps focus when toggled; accessible name includes number, title and count; checked in the manual script with the keyboard. |
| R-10 | Scope creep (search, filter, "expand all", persistence). | Explicitly excluded by FR-019/FR-016; not in the change map. |

## Verification strategy

Details and commands are in [quickstart.md](./quickstart.md). Summary:

0. **Baseline first**: the SDK suite, desktop typecheck/lint and `spike:audio:main` / `spike:audio:store` / `spike:audio:zip-import` are all green before the first edit (they were at the end of feature 001); any later red is a regression.
1. **SDK vitest** (`groupNotesByTrack`): only tracks with Notes; playback order regardless of input order; Notes in time order, ties by creation time, then input order; count equals length; each Note in exactly one group; Notes without/unknown `trackId` excluded; empty input → `[]`; duplicate track ids in the list → first wins; no input mutation; 500 Notes over 68 tracks.
2. **`spike:audio:store`** (real stores, scriptable `Audio`) — a new suite for `audioNoteGroupsStore`: seeding opens exactly the playing track once and never again; toggle open/close, several open; add from the player (as the "+ Note" pill does) opens that track's row, including a track that had no Notes; `lastAddedNote` unchanged by load/refused-save reload/edit/delete/jump; track changes by Contents click, next, auto-advance, Note jump and fallback leave the open map unchanged; state survives "closing the tab" (nothing to unmount: the store is read back) and is cleared when another audiobook is loaded and when the same one is reopened; unavailable Notes → no rows.
3. **Single-file regression**: all existing store-spike Notes checks (k8, k9, k10, `notes: add…edit…delete`, `notes: a very long text…`, `single-file regression…`, and the multi-track Notes suites of feature 001) stay green **unmodified**; a new check proves a single-file book never touches the groups store (no seeding, no rows).
4. **Static**: SDK `typecheck`, `typecheck:tests`, `vitest run`, `build`; desktop `typecheck`, `lint`, `npx vite build`.
5. **Manual (a person), not automated**: the 68-track archive — rows only for tracks with Notes, open/close with mouse and keyboard, add a Note with the sidebar closed then open it, jump from an open row, delete the last Note of a row, 500-Note tab responsiveness; a single-file audiobook's Notes; a PDF/EPUB sanity open.
6. **Not run**: E2E, Electron windows (project rule: manual-only).

## Open points

None blocking. One presentation detail is left to implementation and approval: the visual form of the count (a small pill next to the title) and of the "Playing" mark (a pill) — both follow the existing sidebar pills (`NoteCard` time/"Here" pills) and are not requirements.

## Complexity Tracking

No constitution violations; nothing to justify.
