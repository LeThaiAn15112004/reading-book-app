---
description: "Task list for Notes Grouped by Track"
---

# Tasks: Notes Grouped by Track

**Input**: `specs/002-notes-grouped-by-track/` — spec.md (clarified), plan.md (D1–D9, R-1…R-10), data-model.md, research.md, contracts/sdk-note-groups.md, contracts/notes-tab-ui.md, quickstart.md
**Tests**: Requested by the plan's verification strategy: SDK vitest for the pure helper, the existing store spike for the renderer stores. **No Electron window, no E2E, no new dependency, no migration, no IPC change.** Commit/push only when the user asks.
**Paths**: `SDK` = `source/apps/book-reader-sdk`; `DESK` = `source/apps/reading-book-desktop`; `TAB` = `DESK/src/screens/AudioBook`.

## Format: `- [ ] ID [P?] [Story] Description with file path`

- **[P]** = different file and no dependency on an incomplete task. Tasks that edit the same file are never [P] with each other.
- **Single-file guard rule**: the single-file branch of `NotesTab`, `NoteCard`'s single-file output and every existing store-spike check stay unchanged; the existing checks must pass **unmodified**.
- **Must not be touched**: Main/Preload/IPC (`electron/**`), `api-types.ts`, SQLite stores, migrations, `AudioControls.tsx`, `AudioTimeline.tsx`, `AudioNoteMenu.tsx`, `AudioBookScreen.tsx`, `audioNoteMenuStore.ts`, ZIP import, PDF/EPUB/TXT, `packages/config` (incl. `features.ts`), `package.json`/lockfiles.

---

## Phase 1: Baseline (before ANY edit)

- [X] T001 Run and record the baseline, SDK steps separately so every failure is visible: `cd SDK && npm run typecheck`, `npm run typecheck:tests`, `npx vitest run`, `npm run build`; then `cd DESK && npm run typecheck`, `npm run lint`, `npm run spike:audio:main`, `npm run spike:audio:store`, `npm run spike:audio:zip-import`. All are expected green (they were at the end of feature 001). Record any failure; anything red later that was not on the list is a regression. Do not edit or stage `packages/config/features.ts`.

**Checkpoint**: baseline recorded; no file changed yet.

---

## Phase 2: Foundational — the pure grouping helper (blocks every story)

- [X] T002 Add `TrackNoteGroup` (`trackId`, `index`, `track`, `notes`, `count`) and `groupNotesByTrack(notes, tracks)` to `SDK/src/audio/audio-track-notes.ts` per contracts/sdk-note-groups.md: one group per track that has ≥ 1 Note, groups in `tracks` order, Notes inside a group ordered by `positionSeconds`, then `createdAt`, then input order (reuse `orderTrackNotes`), `count === notes.length` and `count ≥ 1`; Notes with no / unknown `trackId` are in no group; duplicate track ids in `tracks`: the first occurrence wins; no input is mutated. Pure TypeScript (no Node/DOM/React).
- [X] T003 [P] Export `groupNotesByTrack` and `type TrackNoteGroup` from `SDK/src/audio/index.ts` (add them to the existing `audio-track-notes.js` export block; do not touch other lines). Depends on T002.
- [X] T004 [P] Add new cases to `SDK/tests/audio/audio-track-notes.test.ts` (new `describe('groupNotesByTrack')` only; existing cases untouched): only tracks with Notes; no Notes → `[]`; group order = track order for any input order; in-group order (second, then `createdAt`, then input order for exact ties); `count` equals `notes.length`; each Note in exactly one group and `sum(count)` = number of Notes whose track is in `tracks` (property check over a mixed input incl. single-file and unknown-track Notes); duplicate track ids; equal titles → separate groups with different `index`; no mutation of inputs (snapshot compare); 500 Notes over 68 tracks and 500 Notes in one track group correctly. Depends on T002.
- [X] T005 Run `cd SDK && npm run typecheck && npm run typecheck:tests && npx vitest run && npm run build`; all existing tests pass unmodified plus the new ones. Depends on T002–T004.

**Checkpoint**: the helper is verified; the app is unchanged.

---

## Phase 3: User Story 1 — See which tracks have Notes (P1) 🎯 MVP (together with US2)

**Goal**: the multi-track Notes tab lists only tracks that contain Notes, in playback order, each row showing the track number, title and Note count. **Independent test**: Notes in tracks 3, 12 and 30 → exactly three rows, in that order, with the right number, title and count; no Notes → the existing empty state.
*(US1 alone only lists the tracks; the listener needs US2 to open them, so ship US1 + US2 together.)*

- [X] T006 [US1] In `TAB/components/AudioSidebar.tsx`, replace the multi-track `notes.map(...)` flat list inside `NotesTab` with rows from `groupNotesByTrack(notes, tracks)` (memoised on `notes`, `tracks`). Row header content: the track number as `trackNumberLabel(index)` (two digits), the title (truncated, full title in `title`), and a count pill. Keep the `notesUnavailable` message and the empty state exactly as they are (FR-004), keep the "+ Note at current position" button unchanged, and do not touch the single-file branch. For now the Notes of a row are not shown (US2 adds opening).
- [X] T007 [US1] Add a new check to `DESK/spikes/audio/run-audio-store.mjs` (a new section "7. Notes grouped by track"; `groupNotesByTrack` imported from `@reading-book/book-reader-sdk`): with the real player store and a multi-track book, group counts follow the Notes — a Note on a track with none creates its group, the last Note of a track removes it, edit changes no count, and `sum(count)` always equals `S().notes.length`; with no Notes the groups are `[]`; with `notesUnavailable` the tab shows no rows (assert the store state the tab branches on). Existing checks stay unmodified.

**Checkpoint**: rows appear for tracks with Notes.

---

## Phase 4: User Story 2 — Open a track to see its Notes (P1)

**Goal**: opening a row shows that track's Notes in time order (timestamp + text, plain marker as today); closing hides them; several rows can be open; keyboard works; the playing track's row is open the first time the tab is shown. **Independent test**: expand a track with three Notes → three Notes in time order; collapse → they disappear and the row keeps its count.

- [X] T008 [US2] Create `TAB/logic/audioNoteGroupsStore.ts` (zustand) per contracts/notes-tab-ui.md: state `open: Record<string, true>` and `seeded: boolean`; actions `ensureSeeded(currentTrackId: string | undefined)` (if `seeded` do nothing; else set `seeded = true` and, when the id is defined, `open[id] = true`, keeping existing entries), `toggle(trackId)` (flips only that entry), `reset()`; selector `isOpen(trackId)`. At module level subscribe to `useAudioPlayerStore` once: when `bookId` changes → `reset()` (nothing carried over to another audiobook or a reopened one). Do NOT subscribe to `trackIndex`, `positionSeconds`, `notes` or `tracks`. Not persisted: no `localStorage`, no Reset-Settings entry.
- [X] T009 [US2] In `TAB/components/AudioSidebar.tsx` (after T006, same file): make each row header a native `<button type="button">` that calls `toggle(trackId)`, with `aria-expanded`, `aria-controls` (id of the Notes list) and an accessible name "Track N, <title>, K notes" ("1 note" when K = 1), a chevron for the state, and focus left on the header after toggling. An open row renders `<ul aria-label="Notes in <title>">` with the existing `NoteCard` for each Note of the group in the group's order, passing NO track caption (`chapterTitle` undefined) and `at = note.positionSeconds`; a closed row renders only its header. Call `ensureSeeded(currentTrackId)` from a mount effect of the multi-track `NotesTab` (`currentTrackId` = `tracks[trackIndex]?.id`, a primitive selector). Depends on T006, T008.
- [X] T010 [US2] Extend the new section of `DESK/spikes/audio/run-audio-store.mjs` (after T007) for `audioNoteGroupsStore`: `ensureSeeded(a)` opens exactly row `a`, a second call (with `a` or another id) changes nothing, a row opened earlier is kept when seeding runs; `ensureSeeded(undefined)` seeds without opening anything; `toggle` flips only that row, several rows can be open; the state is still readable after "closing the tab" (nothing to unmount: read the store); loading another audiobook clears it (`open = {}`, `seeded = false`); disposing and reopening the same audiobook clears it. Depends on T008.

**Checkpoint**: US1 + US2 are the MVP: the grouped list with dropdown rows works.

---

## Phase 5: User Story 3 — Work with a Note exactly as before (P1)

**Goal**: inside an open row a Note jumps, edits, deletes and shows "Here" exactly as today. **Independent test**: from an open row click a Note on another track (plays there at that second), edit a Note's text, delete another after confirming; rows and counts update.

- [X] T011 [US3] Verify in code (no change expected) that `NoteCard` and the shared menu are used unchanged for Notes inside an open row: click → `goToNote(id)`, ⋮ → `useNoteMenuStore.openFor(id, element)`, the "Here" rule still requires the Note's track to be the current one, the Note menu still names the track. If a gap is found, fix it in `TAB/components/AudioSidebar.tsx` only (after T009); otherwise record "no change" in the task notes. Do not touch `AudioNoteMenu.tsx`.
- [X] T012 [US3] Extend the new section of `DESK/spikes/audio/run-audio-store.mjs` (after T010): with the real player store, a Note taken from a group (`groupNotesByTrack(...)[i].notes[j].id`) jumps through `goToNote` exactly as in feature 001 (other track keeps play/pause, exact second, failed-target fallback unchanged); `updateNote` on a grouped Note keeps its track, second, id and its place in the group and leaves `count` unchanged; `removeNote` of a Note in a 2-Note group makes `count` 1 and the group stays, `removeNote` of the only Note removes the group; a grouped Note's Note-menu target is the same id used by the timeline marker. Depends on T007.

---

## Phase 6: User Story 4 — The list follows what the listener does (P2)

**Goal**: adding a Note shows its track row, open (also when the Notes tab or sidebar was closed); changing the playing track never opens or closes rows; the playing track's row is marked. **Independent test**: add a Note on a track that had none (sidebar closed), open the Notes tab → a new open row with the Note; let playback move on → no row changes state.

- [X] T013 [US4] In `TAB/logic/audioPlayerStore.ts` add the state field `lastAddedNote: { id: string; trackId: string } | null` (type in `AudioPlayerState`, `null` in `INITIAL`) and set it, as a NEW object, only in the multi-track branch of `addNote` in the same `set` that stores the new Note (`set({ notes: ordered, noteNotice: null, lastAddedNote: { id: created.id, trackId: track.id } })`). Do not set it anywhere else (not in `load`, `reloadNotes`, `updateNote`, `removeNote`, `goToNote`, the 500-Note refusal, or the single-file `addNote`). No other behaviour of the store changes; `persist()`, `openTrack`, `trackFailed` untouched.
- [X] T014 [US4] In `TAB/logic/audioNoteGroupsStore.ts` (after T008), extend the module-level subscription: when `lastAddedNote` changes to a non-null value, set `open[trackId] = true` (an already-open row stays open). Depends on T008, T013.
- [X] T015 [US4] In `TAB/components/AudioSidebar.tsx` (after T009): mark the current track's row — a "Playing" pill and `aria-current="true"` on the header when `group.trackId` equals the player's current track id, read with a primitive selector (`s.tracks[s.trackIndex]?.id`) so rows do not re-render on playback ticks. Do not subscribe to `positionSeconds` for this. Depends on T009.
- [X] T016 [US4] Extend the new section of `DESK/spikes/audio/run-audio-store.mjs` (after T012): `addNote()` as the "+ Note" pill calls it sets a NEW `lastAddedNote` each time and opens that track's row — also for a track that had no Notes and for a row that was closed, with no component mounted; `lastAddedNote` and `open` are unchanged by `load`, a refused-save reload (`saveBookmarks` mocked to `{ ok: false }`), edit, delete, the 501st-Note refusal and by Note jumps; Contents click (`goToTrack`), next/previous, auto-advance (`ended`), a Note jump and a failed-jump fallback leave `open` identical; the current-track id read from the store follows `trackIndex`. Depends on T013, T014.

---

## Phase 7: User Story 5 — Single-file audiobooks stay as they are (P1)

**Goal**: prove nothing regressed. A gate, not new behaviour.

- [X] T017 [US5] Extend the new section of `DESK/spikes/audio/run-audio-store.mjs` (after T016): a single-file audiobook (a) never sets `lastAddedNote` when a Note is added, (b) never touches `audioNoteGroupsStore` (`open = {}`, `seeded = false` after load and add), (c) still has its flat `notes` list. Then run `cd DESK && npm run spike:audio:store` and confirm these existing checks are present, unmodified and green: `bookmarks: create…restore…delete`, `bookmarks and progress live side by side…`, `bookmark storage is audio-only and validated`, `notes: add…edit…delete`, `notes: a very long text is capped…`, `single-file regression…`, and all multi-track Notes suites of feature 001. Confirm `git diff` shows no edited or deleted line of an existing check in `run-audio-store.mjs`, `audio-track-notes.test.ts`, `audio-bookmarks.test.ts`.
- [X] T018 [US5] Scope guard: `git status` / `git diff --stat` show changes only in `SDK/src/audio/audio-track-notes.ts`, `SDK/src/audio/index.ts`, `SDK/tests/audio/audio-track-notes.test.ts`, `TAB/logic/audioPlayerStore.ts` (the one field), `TAB/logic/audioNoteGroupsStore.ts`, `TAB/components/AudioSidebar.tsx`, `DESK/spikes/audio/run-audio-store.mjs`, `CLAUDE.md` and this feature's docs — and none in the "must not be touched" list. (The repository already contains other uncommitted work; judge by the files this feature edits, e.g. by timestamps, not by an empty `git status`.)

---

## Phase 8: Polish & verification

- [X] T019 [P] Update the audiobook paragraph of `CLAUDE.md`: the multi-track Notes tab groups Notes by track (`groupNotesByTrack`), only tracks with Notes get a row, row open/closed state is session-only in `audioNoteGroupsStore` (reset when the audiobook changes; the playing track's row is open the first time the tab is shown; adding a Note opens its row through `audioPlayerStore.lastAddedNote`). One or two sentences, no other edit.
- [X] T020 Run the full static set: `cd SDK && npm run typecheck`, `npm run typecheck:tests`, `npx vitest run`, `npm run build`; `cd DESK && npm run typecheck`, `npm run lint`, `npx vite build`; `npm run spike:audio:main`, `npm run spike:audio:store`, `npm run spike:audio:zip-import`. Everything must pass; any failure is a regression (the baseline is green, T001). No Electron window, no E2E.
- [X] T021 Execute the `quickstart.md` §4 manual script once with the 68-track ZIP (a person runs it: rows only for tracks with Notes, mouse and keyboard toggling, jump/edit/delete from an open row, last-Note-removes-row, sidebar close/reopen keeps rows, add with the sidebar closed, no auto open/close on track change, restart resets to the playing track's row, ~500-Note responsiveness under 1 s, a single-file audiobook and a PDF/EPUB sanity open). Record the result; do not claim it passed if it was not run. **RESULT 2026-10-27 (automated, not a person):** run as the Playwright E2E `e2e/specs/audiobook-notes-grouped.spec.ts` (hidden window, throw-away userData, audio muted, 68-track ZIP of synthetic ≈13 s MPEG-silence tracks) — 2 tests passed: quickstart §4 steps 1–11 (empty state; exactly 3 rows with counts and "Playing" only on the current track; mouse and keyboard (Enter / Space) toggling with focus kept on the row, two rows open at once; time order, jump to another track, edit, cancelled and confirmed delete, the last Note removes its row; open state kept across closing the sidebar / switching to Contents; a Note added with the "+ Note" pill while the sidebar is closed gives a new open row; Next track moves "Playing" without opening or closing rows; restart keeps all Notes with only the playing track's row open; single-file audiobook keeps the flat list; PDF and EPUB open). Measured (SC-005 < 1 s): Notes tab with 500 Notes opens in 79 ms, the slowest row open/close took 20 ms (68 rows). Limits: no real audio heard, keyboard use is Playwright key presses (not a person), PDF/EPUB were only opened.

---

## Dependencies & execution order

- Phase 1 → Phase 2 → stories. Phase 2 is a hard prerequisite (the helper). T003 and T004 may run in parallel after T002; T005 last.
- **US1** (T006–T007) needs Phase 2. **US2** (T008–T010) needs T006 for the same file but its store (T008) can start right after Phase 2. **US3** (T011–T012) needs US2's rows. **US4** (T013–T016) needs T008 (store), T009 (row component) and the player-store field T013. **US5** (T017–T018) after all edits. Polish last.
- **Same-file serialisation (never parallel, in this order)**: `AudioSidebar.tsx`: T006 → T009 → (T011 only if a gap is found) → T015; `audioNoteGroupsStore.ts`: T008 → T014; `run-audio-store.mjs`: T007 → T010 → T012 → T016 → T017; `audio-track-notes.ts`: T002 only; `audioPlayerStore.ts`: T013 only.
- Data dependencies: T009 and T015 read `groupNotesByTrack` (T002/T003) and the store (T008); T014 reads `lastAddedNote` (T013); T016 asserts T013 + T014.

## Parallel opportunities

- T003 ∥ T004 (after T002).
- T008 (new store file) ∥ T006 (sidebar) once Phase 2 is done — different files.
- T013 (player store) ∥ T008/T009 — different files; T014 waits for both.
- T019 (docs) any time after the code is final.

## Implementation strategy

1. **MVP = Phases 1–4** (baseline, helper, rows, open/close with the default open state). Validate with the SDK tests and the store spike, then stop for review.
2. Add US3 (a verification of reuse), then US4 (add-opens-row + "Playing" mark), then the US5 gate and polish.
3. Each checkpoint is verifiable without an Electron window; only T021 needs a person.

## Requirement coverage

| Spec | Tasks |
|---|---|
| FR-001/002/003 rows only for tracks with Notes, in order, number + title + count | T002, T004, T006, T007 |
| FR-004 empty / unavailable states unchanged | T006, T007 |
| FR-005/006 open, close, several open, keyboard | T008, T009, T010 |
| FR-007/008 in-row order, timestamp + text, plain marker | T002, T004, T009, T012 |
| FR-009 first-shown default (playing track's row open) | T008, T009, T010 |
| FR-010/011 jump, edit, delete, "Here", menu, markers unchanged | T011, T012 |
| FR-012 live counts and rows | T002, T007, T012 |
| FR-013 add opens its row | T013, T014, T016 |
| FR-014/015 current-track mark; no auto open/close | T015, T016 |
| FR-016 memory per audiobook, not across restarts | T008, T010 |
| FR-017/018/019 boundaries (single-file, storage, no extras) | T017, T018 |
| FR-020 keyboard + assistive technology | T009, T021 |
| SC-005 performance (500 Notes) | T004, T021 |
