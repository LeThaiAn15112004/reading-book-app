---
description: "Task list for Notes for Multi-Track Audiobooks"
---

# Tasks: Notes for Multi-Track Audiobooks

**Input**: `specs/001-multi-track-audiobook-notes/` — spec.md (approved), plan.md (D1–D9, R-1…R-15), data-model.md, contracts/notes-ipc.md, contracts/sdk-track-notes.md, research.md, quickstart.md
**Approved decisions (2026-10-25)**: orphans preserved (D2); fallback to the origin track on a failed jump (D6, P-1); 500-Note cap notice for multi-track only (P-2).
**Tests**: Requested as explicit regression coverage. Verification = SDK vitest + existing spikes (`spike:audio:main`, `spike:audio:store`, `spike:audio:zip-import`) + typecheck/lint/`npx vite build`. **No Electron window, no E2E, no new dependency, no migration, no commit/push** unless the user asks.
**Paths**: `SDK` = `source/apps/book-reader-sdk`; `DESK` = `source/apps/reading-book-desktop`.

## Format: `- [ ] ID [P?] [Story] Description with path`

- **[P]** = different file, no dependency on an incomplete task. Tasks touching the same file are never [P] with each other.
- **Single-file guard rule**: any task that edits a shared function (`sanitizeAudioBookmarks`, `createAudioBookmark`, `SqliteAudioStore`, `load()`, `addNote`, `goToNote`) must leave the single-file path byte-for-byte unchanged, and the golden/existing checks named in T001–T003 must pass **unmodified** afterwards.
- **Must not be touched**: migrations, `preload.ts`, `channels.ts`, `bridge/audio.ts`, `sqlite-overlay-store.ts`, ZIP import code, `packages/config` (incl. `features.ts`), PDF/EPUB/TXT code, `package.json`/lockfiles.

---

## Phase 1: Characterization (before ANY source edit)

**Purpose**: pin today's single-file behaviour so later edits are provably non-regressive (plan review F-3, R-2).

- [X] T001 [P] Add golden vitest cases to `SDK/tests/audio/audio-bookmarks.test.ts` for the CURRENT output of `sanitizeAudioBookmarks` and `createAudioBookmark` with inputs that have no `trackId`: garbage entries, duplicate ids, >500 entries (input-order cap, then position sort), chapter refs, over-long label/note, non-finite and >10 000 000 positions. Expected values are literals captured from today's code; run them green BEFORE any edit. Do not alter existing cases.
- [X] T002 [P] In `DESK/spikes/audio/run-audio-main.mjs`, add a check that saves a fixed single-file Note list through the real `audio:saveBookmarks` and asserts the EXACT stored `audioBookmarks` JSON string and the `audio:getBookmarks` result (golden captured from the current code). Include a 501-entry single-file save: capture today's result (`ok`, which 500 are kept, stored order) as a literal — this pins the silent truncation that T011 must not change. Run `npm run spike:audio:main` green before any edit.
- [X] T003 Run and record the baseline, running the SDK steps SEPARATELY (so every failure is visible, not only the first one of the `npm run verify` chain): `cd SDK && npm run typecheck && npm run typecheck:tests && npx vitest run && npm run build`; then `cd DESK && npm run typecheck && npm run lint && npm run spike:audio:main && npm run spike:audio:store && npm run spike:audio:zip-import`. **Baseline (measured at Checkpoint 1): fully green, no known baseline failure.** `SDK/tests/config/audiobook-zip-gate.test.ts` passes: it reads `features.ts` from `HEAD` (`git show`), so the local, uncommitted `audiobookZipImportEnabled: true` does not fail it. Record any failure you see as NEW; anything red later is a regression. Do not edit or stage `features.ts`. Depends on T001, T002.

**Checkpoint**: baseline recorded; no source file changed yet.

---

## Phase 2: Foundational (blocks every story)

**Purpose**: carry `trackId` end to end, enforce ownership, preserve orphans, add the pure helpers.

- [X] T004 [P] Extend `SDK/src/audio/audio-bookmarks.ts`: `AudioBookmark.trackId?: string`; `sanitizeAudioBookmarks` keeps `trackId` only when it is a non-empty string of at most 100 characters (same rule as `chapterId`), otherwise omits it; `createAudioBookmark` accepts optional `trackId` and `trackNumber` — with `trackId` set: no `chapterId`/`chapterOffsetSeconds`, default label `Track N · m:ss`. Without `trackId` the output MUST equal today's (T001 goldens unmodified and green). (R-1, contracts/sdk-track-notes.md)
- [X] T005 [P] Create `SDK/src/audio/audio-track-notes.ts` with pure functions per contracts/sdk-track-notes.md: `orderTrackNotes` (track index, then `positionSeconds`, then `createdAt`; stable; Notes without/unknown `trackId` excluded), `notesForTrack`, `trackNoteLabel` ("N · live title", `null` for unknown track), `trackNoteJumpTarget` (clamp into [0, duration] when known, else max(0, position); non-finite/negative ⇒ 0; NOT subject to `RESTART_NEAR_END_SECONDS`; `null` for no/unknown `trackId`), `canAddAnotherNote(count)` (`count < MAX_AUDIO_BOOKMARKS`). No input mutation.
- [X] T006 Export the new module from `SDK/src/audio/index.ts` (depends on T005).
- [X] T007 [P] Create `SDK/tests/audio/audio-track-notes.test.ts` covering contract guarantees 1–5: total stable ordering incl. two Notes at the same second keeping creation order; duplicate titles distinguished by number; jump target for same/other/unknown track, beyond-duration (clamped), within 2 s of the end (kept exactly), unknown duration, negative/NaN/Infinity; cap helper at 499/500/501; no mutation; single-file Notes never returned by `orderTrackNotes`/`notesForTrack`.
- [X] T008 Add `trackId`-keep/drop and `createAudioBookmark(trackId)` cases (valid, empty, 101 chars, non-string, with/without chapter ref) to `SDK/tests/audio/audio-bookmarks.test.ts` as NEW cases only (depends on T004).
- [X] T009 [P] Add `trackId?: string` to `AudioBookmarkDto` in `DESK/electron/ipc/api-types.ts` (comment: present on multi-track Notes only). Do not touch `channels.ts`/`preload.ts`/`bridge/audio.ts`.
- [X] T010 Rewrite the Notes rules in `DESK/electron/persistence/sqlite-audio-store.ts` (depends on T004, T009). Replace the blanket multi-track refusal (`getBookmarks → []`, `AND NOT EXISTS (SELECT 1 FROM book_audio_chapters …)`) with, keeping the single-file branch's behaviour identical:
  - `saveBookmarks`, multi-track: refuse the WHOLE save (`{ok:false}`, nothing written) unless EVERY incoming Note has a `trackId` that is a `book_audio_chapters.id` of THIS book (data-model rule 3); on success write `incoming + preserved foreign entries`, where foreign = stored entries whose `trackId` is missing or not owned. **Partition the RAW stored array into owned and foreign entries BEFORE sanitizing either set**, then sanitize the foreign set independently (its own cap of 500) — never sanitize the combined array, because `sanitizeAudioBookmarks` caps in input order and would drop foreign entries that follow 500 owned ones. Foreign entries are preserved after sanitization (canonical form), not as raw bytes; they are written AFTER the incoming Notes and do not count toward the 500; an incoming id equal to a foreign entry's id wins and the foreign duplicate is dropped (rule 5b). **Cap at the boundary (review G-1)**: if the RAW incoming array has more than `MAX_AUDIO_BOOKMARKS` (500) entries the whole save is refused (`{ok:false}`, nothing written, no truncation); an incoming list of ≤ 500 is saved in full; preserved foreign entries never count toward the 500 (data-model rule 6). Only `audioBookmarks` and `updated_at` change (`json_patch`).
  - `saveBookmarks`, single-file: refuse if ANY Note has a `trackId`; otherwise replace the array exactly as today.
  - `getBookmarks`, multi-track: partition the RAW stored array first, skip entries with missing/foreign `trackId` (they do not count toward the cap), then sanitize and cap the owned ones at 500 (rule 5). Single-file: output as today, any stray `trackId` not returned. Never throws on damaged JSON.
- [X] T011 `DESK/electron/ipc/audio.ipc.ts` (depends on T010; same behaviour contract): the `audio:saveBookmarks` handler currently runs `sanitizeAudioBookmarks` (which caps at 500 in input order and drops the rest silently) BEFORE calling the store (line ~62), and the store sanitizes again (`sqlite-audio-store.ts` line ~35). A multi-track list above the cap would therefore be truncated before any check could see it. Change the handler to keep its existing argument validation but pass the RAW `bookmarks` array to `saveBookmarks` (the store already sanitizes, and `sanitize(sanitize(x))` equals `sanitize(x)`, so single-file results are unchanged — proven by the T002 golden). The store applies the multi-track cap rule of T010: raw incoming array length > `MAX_AUDIO_BOOKMARKS` ⇒ refuse (`{ok:false}`), nothing written, nothing truncated. Update any comment that still claims multi-track books have no Notes.

### Foundational verification (Main side)

- [X] T012 (depends on T010, T011) In `DESK/spikes/audio/run-audio-main.mjs`, SPLIT the existing "NOTES guard" check: keep the single-file half VERBATIM as its own check; rewrite only the multi-track half into the new ownership checks: owned `trackId` save ⇒ `ok:true` and `getBookmarks` returns `trackId`; missing / foreign-book / unknown `trackId` and a mixed list ⇒ `ok:false` with the stored list byte-identical (atomic); single-file save with a `trackId` ⇒ `ok:false`, nothing written.
- [X] T013 In `DESK/spikes/audio/run-audio-main.mjs`, add the ORPHAN-PRESERVATION checks (depends on T010, FR-024, R-7): seed the stored JSON with one foreign-`trackId` entry and one entry with no `trackId` plus owned Notes; assert they are not returned by `getBookmarks`; seed ONLY canonical entries (already in sanitizer output form: whitelisted keys, trimmed, valid ranges) so the check tests the intended guarantee — after add, edit and delete through the real IPC they are still in the stored array, equal in canonical form (U2); **U1 case**: seed 500 owned Notes + canonical foreign/orphan entries (some with a foreign `trackId`, some with none), edit one owned Note through the real IPC, and assert EVERY foreign entry is still stored and still not returned by `getBookmarks`; incoming id equal to a foreign id ⇒ incoming wins; with 500 owned Notes plus foreign entries all 500 owned are returned (partition before cap). **Cap boundary (G-1)**, multi-track: an incoming list of exactly 500 owned Notes ⇒ `ok:true`, all 500 stored, foreign entries still preserved (stored total may exceed 500); an incoming list of 501 ⇒ `ok:false`, stored array byte-identical, no Note lost; single-file book: a 501-entry save still returns `ok:true` and stores the first 500 in input order exactly as the T002 golden says (unchanged, silent).
- [X] T014 In `DESK/spikes/audio/run-audio-main.mjs`, add the PROGRESS/OTHER-KEY PRESERVATION MATRIX (depends on T010, FR-026, F-3): seed a multi-track book's `reading_state_json` with `lastReadLocation`, `fontSize`, an unknown `futureKey` object and `audioProgress` (`trackId`, `positionSeconds`, `playbackRate`, `scope`, `updatedAt`, NO `percent`). After each of add → edit → delete: parsed state minus `audioBookmarks` is deep-equal to the seed, `audioProgress` is byte-identical, `percent` still absent. Reverse: `overlay:saveAudioProgress` leaves `audioBookmarks` identical — for a multi-track AND a single-file book. Also assert the text cap (2000) still applies.
- [X] T015 Add to the existing remove-audiobook check in `DESK/spikes/audio/run-audio-zip-import.mjs` (verified: this is the file behind `spike:audio:zip-import`) an assertion that removing a multi-track audiobook that has Notes leaves no Notes behind and a re-import starts empty (FR-025).
- [X] T016 Run the SDK commands exactly as in T003 and `cd DESK && npm run spike:audio:main && npm run spike:audio:zip-import`; all T001/T002 goldens and the original single-file checks MUST pass unmodified. No failure is allowed: the baseline is green (T003). Note: until T022 the multi-track assertions of `run-audio-store.mjs` that expect "Notes not read / `addNote()` null" are expected red; do not run `spike:audio:store` as a gate here. Depends on T004–T015.

**Checkpoint**: data layer complete; single-file goldens green; renderer still blocks multi-track Notes.

---

## Phase 3: User Story 1 — Add a Note while listening (P1) 🎯 MVP

**Goal**: add a Note (with or without text) on the current track; unavailable when there is no valid position; 500-Note cap with a notice (multi-track only).
**Independent test**: in `spike:audio:store`, play track 3 of a multi-track book, add a Note; it persists with `trackId` = track 3's id and the in-track second; add is a no-op while switching / failed / not ready.

- [X] T017 [US1] In `DESK/src/screens/AudioBook/logic/audioPlayerStore.ts` `load()`: for a multi-track book, read Notes AFTER tracks are known via `getBookmarks`, order with `orderTrackNotes`; on a rejected read set a `notesUnavailable` flag (D9) instead of an empty list, and make `addNote`/`updateNote`/`removeNote` no-ops while it is set (data-model rule 5c, R-15). The single-file branch and its existing `Promise.all`/`.catch(() => [])` stay untouched.
- [X] T018 [US1] In the same store: multi-track `addNote` (replace the `tracks.length > 0 ⇒ null`) — allowed only when `status === 'ready'`, not `switching`, current track not in `trackErrors`, Notes available, and `canAddAnotherNote(notes.length)`; captures `trackId` and `clampSeekPosition(el.currentTime, el.duration)` in one synchronous step; creates via `createAudioBookmark({trackId, trackNumber})`; keeps `notes` in `orderTrackNotes` order; MUST NOT call `saveAudioProgress`/`persist`. At 500 Notes: create nothing, set a visible `noteNotice` (FR-023). Expose a derived `canAddNote` selector (R-11). Single-file `addNote` branch unchanged (D4, P-2).
- [X] T019 [US1] In the same store: make multi-track `saveBookmarks` result-aware (D7, R-8) — on `{ok:false}` reload via `getBookmarks` and set a notice; keep the `bookmarkChain` serialisation; single-file stays fire-and-forget.
- [X] T020 [US1] `DESK/src/screens/AudioBook/components/AudioControls.tsx`: render "+ Note" for multi-track books too (today only when `tracks.length === 0`), disabled with a tooltip when `canAddNote` is false (FR-003, R-11).
- [X] T021 [US1] `DESK/src/screens/AudioBook/AudioBookScreen.tsx`: render the store `noteNotice` (cap reached, refused save, jump failure) near the player without blanking the player or Notes view; cleared by the next `openTrack`, jump or successful add.
- [X] T022 [US1] Extend `DESK/spikes/audio/run-audio-store.mjs` (depends on T017–T019): rewrite ONLY the multi-track assertions that expect "Notes not read / `addNote()` null"; add suites — add with/without text; unavailable (no-op) while switching, with a failed current track, before ready; `trackId` + clamped second stored; a track whose duration is unknown (`NaN`/missing) still accepts a Note (position = `clampSeekPosition` of the element's `currentTime`, no marker drawn); **zero `saveAudioProgress` calls** (`calls.save` unchanged) and stored `audioProgress` untouched by add; **500-Note cap**: the 501st creates nothing, notice set, existing 500 intact, single-file book at the cap behaves exactly as before; refused save ⇒ reload + notice; rejected `getBookmarks` ⇒ add/edit/delete no-ops and nothing written (D9); `status === 'ready'` throughout.

**Checkpoint**: US1 verifiable on its own (Notes created and stored; list/jump not yet required).

---

## Phase 4: User Story 2 — One Notes view for the whole audiobook (P1)

**Goal**: Notes tab visible for multi-track books, all Notes in track order with "NN · Title" and in-track time; empty state.
**Independent test**: with Notes on tracks 3, 12, 30 the Notes tab lists three entries in track order with correct labels/timestamps; zero Notes shows the empty state.

- [X] T023 [US2] `AudioBookScreen.tsx`: stop removing the `highlights` rail tab when `multiTrack` (FR-005). Single-file rail unchanged.
- [X] T024 [US2] `DESK/src/screens/AudioBook/components/AudioSidebar.tsx` (`NotesTab`/`NoteCard`): multi-track branch uses the store's ordered Notes; each card shows `trackNoteLabel` + in-track timestamp + text; empty state with explanation; "Notes could not be loaded" state when `notesUnavailable`; "Here" highlight only when `note.trackId` equals the current track id (R-9, via `notesForTrack`). Single-file rendering unchanged.
- [X] T025 [US2] Store spike (`run-audio-store.mjs`): Notes across tracks come out in track order; same-second Notes both kept in creation order; labels from live track list; list identical after reload; "Here" only for the current track; empty list for a book with no Notes.

**Checkpoint**: US1 + US2 usable together.

---

## Phase 5: User Story 3 — Jump to a Note, with fallback (P1)

**Goal**: click a Note → correct track and exact second, play state preserved; failed target falls back to the origin track, paused, with a notice; stale results never override newer actions.
**Independent test**: `spike:audio:store` jump suites (same track, other track, near-end, beyond-end, rapid, failure, both-fail, stale).

- [X] T026 [US3] `audioPlayerStore.ts` `openTrack`: add an optional EXACT-start mode (clamp only, no `resolveRestorePosition` "restart near end") and an optional `jump` argument carrying the origin. Right after `++trackSwitch`, set module-level `pendingJump = { token, originIndex, originSeconds }` when `jump` is given; EVERY `openTrack` call without `jump`, and teardown/`load`, sets `pendingJump = null` (D6 step 1, R-5). No change to the existing resume path (`goToTrack`, auto-advance, restore).
- [X] T027 [US3] `audioPlayerStore.ts` `goToNote`: replace the `tracks.length > 0 ⇒ return`. Resolve the target with `trackNoteJumpTarget`; unknown track ⇒ no-op. (a) Target is the current track AND settled (`!switching`, not in `trackErrors`) ⇒ `seekTo` only (FR-012); no new element, no save. (b) Otherwise capture the play state, take the origin ONLY from a settled state (read in the same synchronous step as the forced save of the old track); if a jump is already in flight inherit its origin; with no settled origin there is no fallback. Do the forced save of the old track exactly as `goToTrack` does, then `openTrack(target.index, target.seconds, wasPlaying, exact, jump)`. A same-track jump while `switching` or errored goes through (b) (D6 step 7). Clear `noteNotice` on start.
- [X] T028 [US3] `audioPlayerStore.ts`: in the target's `loadedmetadata` handler (existing `current()` guard) set `pendingJump = null` (D6 step 5: a completed jump can never roll back).
- [X] T029 [US3] `audioPlayerStore.ts` `trackFailed(el)`: keep the existing `el !== audio` guard and the existing marking of `trackErrors`, clearing of `switching`/`playing` and save-timer stop; then `const j = pendingJump; pendingJump = null; if (j && j.token === trackSwitch) openTrack(j.originIndex, j.originSeconds, false, exact, /*no jump*/)` (read `openTrack`'s real signature first and use its `saveOnReady` equivalent as "do not save": the fallback must not write progress) and set `noteNotice` naming the TARGET track. The fallback is a normal `openTrack` (retires the target element, bumps the token, leaves `pendingJump = null`). If the origin also fails, nothing is pending ⇒ the standard `TrackErrorNotice` shows, no second fallback, no loop; neither the failed target nor the failed origin position is saved (D6 steps 3, 4, 6; approved P-1). Do not add any new timer, retry or token beyond `pendingJump`.
- [X] T030 [US3] Store spike (`run-audio-store.mjs`) — jump happy paths: same-track jump = seek only (no new element, no new-track save); other track while playing and while paused keeps the play state; Note at `duration − 1` lands exactly (not 0); Note beyond the real duration lands at the end; rapid selections end on the last one's track and second — a 3-step A→B→C case AND a ≥10-selection run across different tracks (SC-004) — and a late `loadedmetadata` of B never seeks C; a second Note on the track still loading is not lost (D6 step 7); a jump after an app restart works from stored data only (FR-016).
- [X] T031 [US3] Store spike — **progress rules for jumps** (F-3): a jump issues one forced save of the OLD track `{trackId: old, positionSeconds}` first, then only `{trackId: target, positionSeconds}` with NO `percent`/`durationSeconds`/`chapterId`; stored `audioProgress` and unrelated `reading_state_json` keys otherwise unchanged; a FAILED jump never saves the target's `trackId` (stored progress ends at the origin).
- [X] T032 [US3] Store spike — **fallback and races (R-6 a–e)**: (a) target fails ⇒ origin track restored paused at its position, target in `trackErrors`, notice names the target, Note remains, `status === 'ready'`; (b) target fails AFTER a newer Contents click / newer Note jump / auto-advance ⇒ no fallback, the newer action wins; (c) target AND origin both fail ⇒ standard `TrackErrorNotice`, no loop (bounded `Audio` constructions), no progress saved for either; (d) target already loaded then errors ⇒ no fallback; (e) jump with no settled origin (mid-switch from a Contents click, or current track failed) ⇒ no fallback, standard error state; a failed target's late `error` event and its pending `play()` rejection after a newer switch are ignored.

**Checkpoint**: jump + fallback verified; races closed.

---

## Phase 6: User Story 4 — Edit and delete (P2)

**Goal**: edit text / delete with confirmation from the same menu; playback untouched; nothing duplicated.
**Independent test**: edit and delete via the store keep track/position/id and never touch playback or progress.

- [X] T033 [US4] `DESK/src/screens/AudioBook/components/AudioNoteMenu.tsx`: show the track label in the header for multi-track Notes; edit/delete wiring unchanged (confirmation retained); single-file header unchanged. Verify `updateNote`/`removeNote` in the store keep `trackId`, position, id and createdAt and re-order via `orderTrackNotes` (adjust only if they drop `trackId`).
- [X] T034 [US4] Store spike: edit keeps track + position + id (no duplicate); clearing text leaves a plain marker; delete after confirm removes only that Note; cancel leaves it; edit/delete/open-menu leave track, position and play state unchanged; **zero `saveAudioProgress` calls** for edit and delete and stored `audioProgress` untouched; the preservation-matrix equivalent for the renderer path (other `reading_state_json` keys unchanged). **Concurrent mutations (C1, spec Edge "Concurrent edits in flight")**: fire add → edit → delete → add-back (of a Note with the same text) in rapid succession without awaiting between calls, then let the `bookmarkChain` drain; assert the final stored list (read back through the real `audio:getBookmarks`) is exactly the final in-memory `notes` list — same ids and order, no duplicate id, no resurrected deleted Note, no lost add — and that saves reached Main in call order (the existing `bookmarkChain` serialisation stays; do not replace it). **Failed track (C2, spec Edge "Track unplayable")**: with the current track in `trackErrors`, existing Notes (on that track and others) stay listed and can be edited and deleted (stored result correct), while `addNote` stays blocked (`canAddNote` false, no Note created, nothing saved).

---

## Phase 7: User Story 5 — Timeline markers for the current track (P3)

**Goal**: markers only for the current track's Notes, following track changes; none when the duration is unknown.
**Independent test**: with two Notes on the current track and one on another, the marker selector returns only the two; after switching track it returns that track's Notes; with an unknown duration no markers are produced (T036).

- [X] T035 [US5] `DESK/src/screens/AudioBook/components/AudioTimeline.tsx`: in multi-track mode feed markers from `notesForTrack(notes, currentTrackId)` compared on the track-relative position; unknown duration ⇒ none (existing `noteMarkerFraction`); marker click opens the same `AudioNoteMenu` via `audioNoteMenuStore`. Single-file marker logic unchanged.
- [X] T036 [US5] Store spike: markers selector returns only the current track's Notes, changes on track change, empty for unknown duration (assert via the store selectors; no DOM runner exists).

---

## Phase 8: User Story 6 — Single-file and PDF/EPUB unchanged (P1)

**Goal**: prove nothing regressed. This phase is a gate, not new behaviour.

- [X] T037 [US6] Re-run the T001/T002 goldens and confirm they pass UNMODIFIED after all edits; confirm `git diff` shows no deletion or edit of existing single-file expectations in `audio-bookmarks.test.ts`, `audio-notes.test.ts`, `run-audio-main.mjs`, `run-audio-store.mjs` other than the multi-track assertions explicitly listed in T012 and T022.
- [X] T038 [US6] In `spike:audio:store` confirm these existing checks are present, unmodified and green: `bookmarks: create…restore…delete` (k8), `bookmarks and progress live side by side…` (k9), `bookmark storage is audio-only and validated` (k10), `notes: add…edit…delete`, `notes: a very long text is capped…`, `single-file regression…` (its `addNote()` truthiness stays). Add one new check that a single-file book still silently truncates past 500 with NO notice (P-2) and still refuses nothing.
- [X] T039 [US6] Scope guard: `git status`/`git diff --stat` show no change to migrations, `preload.ts`, `channels.ts`, `bridge/audio.ts`, `sqlite-overlay-store.ts`, ZIP import code, PDF/EPUB/TXT code, `packages/config`, `package.json`/lockfiles; no change to `persist()`, `timelineView`, `BookProgress`, `audioProgressPatch` (FR-028–031, R-11, R-12). Do not stage `packages/config/features.ts`.

---

## Phase 9: Polish & documentation

- [X] T040 [P] Update `CLAUDE.md` (the audiobook ZIP paragraph says Notes for multi books "are not built yet") and the status line of `docs/implementation_plan/audiobook_multi_track_playback_b.md` §8 to say multi-track Notes are delivered.
- [X] T041 Run the full static set: SDK commands as in T003 (separate steps); `cd DESK && npm run typecheck && npm run lint && npx vite build`; `npm run spike:audio:main`, `spike:audio:store`, `spike:audio:zip-import`. The baseline is green (no known baseline failure, T003), so any failure is a REGRESSION and must be reported as such. Task is done only when everything passes. No Electron window, no E2E, no `e2e` scripts.
- [X] T042 Execute the `quickstart.md` §5 manual script once with the 68-track ZIP (a person runs it; includes breaking a track file to see the fallback, restart persistence, single-file Notes, PDF/EPUB sanity open). Also record: Notes view with ~500 Notes opens and scrolls with no freeze > 1 s (SC-008); a Note jump lands within 2 s (SC-003); the Note text box cap (`maxLength` = 2000, as in single-file) is enough as the "how much can I type" cue. Record the result; do not claim it passed if it was not run. **RESULT 2026-10-27 (automated, not a person listening):** run as the Playwright E2E `e2e/specs/audiobook-multitrack-notes.spec.ts` (hidden window, throw-away userData, audio muted, 68-track ZIP of synthetic ≈13 s MPEG-silence tracks) — 2 tests passed: quickstart §5 steps 1–10, incl. a never-played track (40) made unreadable → notice names the track and the player returns to the previous track, restart persistence, PDF + EPUB still open, single-file Notes flat/edit/jump/delete, remove then re-import starts with no Notes, Note text box `maxLength` = 2000. Measured: Note jump 114–421 ms across runs (SC-003 < 2 s), Notes view with 500 Notes opens in 72–95 ms and scrolls with a worst frame of 17–18 ms (SC-008 < 1 s). Limits: no real audio was heard (codec / audible playback not covered), PDF/EPUB were only opened, not annotation-checked.

---

## Dependencies & execution order

- Phase 1 → Phase 2 → stories. Within Phase 2: T004/T005/T009 parallel; T006←T005; T008←T004; T010←T004,T009; T012–T014←T010; T016 last.
- US1 (T017–T022) is the MVP and unlocks the store state the others use. US2 depends on T017 (ordered Notes). US3 depends on T017 and is independent of US2's UI. US4 depends on US1. US5 depends on T017. US6 (T037–T039) runs after all edits.
- Same-file serialisation (never run these in parallel, in this order): `audioPlayerStore.ts`: T017 → T018 → T019 → T026 → T027 → T028 → T029 → T033 (only if `updateNote`/`removeNote` need a fix); `run-audio-store.mjs`: T022 → T025 → T030 → T031 → T032 → T034 → T036 → T038; `run-audio-main.mjs`: T002 → T012 → T013 → T014; `audio-bookmarks.test.ts`: T001 → T008; `sqlite-audio-store.ts`: T010 only; `audio.ipc.ts`: T011 only; `AudioBookScreen.tsx`: T021 → T023.
- Cross-task data dependencies: T020, T021 and T024 need the `canAddNote` selector, `noteNotice` and `notesUnavailable` fields created in T017/T018; T027 needs T026; T029 needs T026 and T028; T011 and T010 together define the cap rule that T012/T013 test.

## Parallel opportunities

- T001 ∥ T002; T004 ∥ T005 ∥ T009; T007 ∥ T010; T020 and T021 may be done in either order after T018 (different files, but not marked [P] because both need T018's fields); T033 ∥ T035 (different components; T033 joins the store chain only if it edits the store); T040 any time after implementation.

## Implementation strategy

1. MVP = Phases 1–3 (characterise, data layer, add Note). Validate with the spikes, then stop for review.
2. Add US2 (list) and US3 (jump + fallback) next — both are P1 and ship together as the usable feature.
3. Then US4, US5, then the US6 gate and polish. Each checkpoint is verifiable with the spikes without an Electron window.

## Requirement coverage

| Concern | Tasks |
|---|---|
| Single-file Notes regression | T001–T003, T012 (split guard), T037, T038, T039 |
| Orphan preservation + read-failure guard | T010, T013, T017, T022 |
| Progress / other-key preservation | T014, T022, T031, T034 |
| Failed-jump fallback and races | T026–T029, T031, T032 |
| 500-Note cap (multi only) | T018, T022, T038 |
| FR-025 removal, FR-029–031 scope | T015, T039 |
