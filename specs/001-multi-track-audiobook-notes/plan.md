# Implementation Plan: Notes for Multi-Track Audiobooks

**Branch**: `001-multi-track-audiobook-notes` (spec directory name; the working branch is `anle-dev`, no feature branch was created) | **Date**: 2026-10-25 | **Spec**: [spec.md](./spec.md) (approved)

**Input**: Feature specification from `/specs/001-multi-track-audiobook-notes/spec.md`

## Summary

Lift the deliberate "no Notes for multi-track audiobooks" block and let a listener add, list, edit, delete and jump to Notes that belong to one track of a ZIP-imported audiobook.

Approach, in one paragraph: **reuse the existing audiobook Notes machinery end to end** (same `AudioBookmark` shape, same `reading_state_json.audioBookmarks` array, same `audio:getBookmarks` / `audio:saveBookmarks` channels, same player-store actions, same `AudioNoteMenu`). A multi-track Note differs from a single-file Note in exactly one stored field, `trackId` (the stable `book_audio_chapters.id`), and its `positionSeconds` means "seconds inside that track". No migration, no new table, no new channel. The work is: (1) carry `trackId` through the SDK sanitizer and add pure helpers for ordering / labelling / jump targets, (2) replace the Main-side blanket refusal with an ownership check (multi ⇒ every Note must name a track of *this* book; single-file ⇒ no Note may name a track), (3) make the player store create and jump to track Notes using the existing one-element-per-track switching, with a fallback to the previous track when the target cannot be played, (4) re-enable the Notes rail tab, the add control, markers and the Note menu in multi mode with track labels.

## Technical Context

**Language/Version**: TypeScript (ES2022) across the workspace; React 18 renderer; Electron Main/Preload. Node version as already used by the repo (no change).

**Primary Dependencies**: existing only — `zustand` (player store; per the project's "zustand for custom hooks" preference), `better-sqlite3` (Main), `vitest` (SDK). **No new dependencies.**

**Storage**: existing SQLite `books.reading_state_json`. Notes stay under the key `audioBookmarks` (JSON array, replaced whole on save via `json_patch`). Track ownership is checked against the existing `book_audio_chapters` table. **No migration** (numbering stays at 028).

**Testing**: SDK `vitest` for pure logic (`npm run verify`); desktop has no test runner, so verification uses the existing standalone spikes `spike:audio:main` (real Main IPC + SQLite on the migrated schema) and `spike:audio:store` (real renderer store with a scriptable `Audio`), plus `typecheck`, `lint`, `npx vite build`. **No Electron window, no E2E.**

**Target Platform**: Desktop app (Windows primary; Electron). Mobile scaffold untouched.

**Project Type**: desktop-app (Electron + React) on top of the platform-agnostic `book-reader-sdk`.

**Performance Goals**: from the spec — Note jump lands within 2 s locally (SC-003); Notes view with the maximum Notes / tracks has no freeze > 1 s (SC-008). Rendering is a plain list of ≤ 500 cards, ordering is O(n log n) in a `useMemo`; list rows use `content-visibility: auto` like the Contents list only if profiling shows a need.

**Constraints**: local-only (no network, no export, FR-029); single-file Notes byte-for-byte unchanged (FR-027); PDF/EPUB annotation code not touched (FR-028); no progress / total / percent / whole-book timeline work (FR-030); ZIP import untouched (FR-031); SDK `src/` must stay free of `electron` / Node / DOM / React (compile-enforced).

**Scale/Scope**: ≤ 5 000 tracks (ZIP limit), ≤ 500 Notes per audiobook (`MAX_AUDIO_BOOKMARKS`), Note text ≤ 2 000 chars (`MAX_NOTE_CHARS`). About 10 source files change plus 2 new SDK files and 2 spike files; roughly 400–600 lines of production code.

## Constitution Check

`.specify/memory/constitution.md` is still the **unfilled template** (placeholders such as `[PRINCIPLE_1_NAME]`), so it imposes no ratified gates. The project's de-facto rules come from `CLAUDE.md`; those are used as the gates instead:

| Gate (source) | Result |
|---|---|
| SDK `src` never imports Electron / Node / DOM / React / format engines | **Pass** — new SDK code is pure functions on plain data. |
| Renderer never gets filesystem paths or touches SQL; everything crosses `window.api`, assembled in four synced places | **Pass** — no new channel; only `AudioBookmarkDto` gains an optional field (touches `api-types.ts`; `channels.ts`, `preload.ts`, `bridge/audio.ts` need no change). |
| The book file is never mutated; overlay data lives in SQLite keyed by `bookId` | **Pass** — Notes stay in the overlay row; no file is read or written. |
| Application preferences are not in SQLite | **N/A** — this is book overlay data, not a preference. |
| Zustand for custom hooks (user memory) | **Pass** — all new renderer state lives in `audioPlayerStore`. |
| Unit tests only in the SDK; desktop checks are spikes; E2E is manual-only | **Pass** — see Verification. |
| Release flag `audiobookZipImportEnabled` stays untouched | **Pass** — not read or changed (see Risk R-12). |

Post-design re-check (after Phase 1): **no violations**, Complexity Tracking is empty.

## Findings from the repository (what the plan stands on)

These were verified in source on 2026-10-25 and correct several statements in the older plan documents.

1. **Multi-track playback already exists** (`audioPlayerStore.ts`: `openTrack`, `goToTrack`, auto-advance on `ended`, previous/next, `trackFailed`, `switching`, `trackErrors`, one `Audio` per track, `trackSwitch` token). Notes work reuses this; it does not rebuild it.
2. **The block is in three places**, all to be lifted for multi-track books only:
   - UI: `AudioBookScreen.tsx` removes the `highlights` rail tab when `multiTrack`; `AudioControls.tsx` renders "+ Note" only when `tracks.length === 0`.
   - Store: `addNote` returns `null` and `goToNote` returns when `tracks.length > 0`; `load()` sets `notes: []` and never calls `getBookmarks` for a multi-track book.
   - Main: `SqliteAudioStore.getBookmarks` returns `[]` and `saveBookmarks` has `AND NOT EXISTS (SELECT 1 FROM book_audio_chapters …)`.
3. **`sanitizeAudioBookmarks` drops unknown keys** (whitelist) and is applied twice (IPC handler and again implicitly on read in the store). A `trackId` added to `AudioBookmark` is silently erased unless the sanitizer is taught to keep it. This is the single most likely silent-failure point.
4. **`sanitizeAudioBookmarks` sorts by `positionSeconds` only.** For a multi-track list that order is meaningless; display order must be derived (track index, then position) from the track list, which only the renderer has.
5. **`resolveRestorePosition` restarts at 0 when the saved position is within 2 s of the end** (`RESTART_NEAR_END_SECONDS`). `openTrack(index, startSeconds, …)` uses it on `loadedmetadata`. A Note made in the last 2 s of a track would jump to 0 instead of "the exact second" — wrong for Notes (FR-010). Notes need an exact-start path (clamp only).
6. **A failed `goToTrack` leaves the player on the failed track** (`trackFailed` marks it, `TrackErrorNotice` offers Try again / Skip). Spec Story 3 scenario 6 / FR-014 asks that a failed *Note jump* keep the player usable **on the track it was on**. That is new behaviour for Note jumps only (see Design D6).
7. **`saveAudioProgress` and `saveBookmarks` both use `json_patch` on `reading_state_json`** and touch different keys, so they cannot overwrite each other; the single-file spike already asserts this. The multi-track equivalent must be asserted too (FR-026).
8. **Removing a multi-track audiobook deletes the `books` row** (`deleteCascade`), and the Notes live in that row's JSON, so FR-025 holds by construction; it only needs a regression assertion in the existing `spike:audio:zip-import` remove check.
9. **The renderer's `saveBookmarks` is fire-and-forget** (`bookmarkChain`, result ignored). Today Main never refuses a single-file save, so that was harmless. For multi-track books a refusal is now possible (ownership check), so the renderer must notice `ok:false`.
10. **The store never enforces the 500-Note cap** — `sanitizeAudioBookmarks` truncates silently on save. FR-023 requires the user to be told for multi-track books. Single-file behaviour stays as is (FR-027).
11. The ZIP import flag `audiobookZipImportEnabled` is `true` in the working tree (local only). Existing multi-track books in a library are what this feature serves; the flag is irrelevant to it.

## Design decisions (full rationale in [research.md](./research.md))

- **D1 Storage**: one array, `audioBookmarks`, for both kinds of book. A track Note adds `trackId`. No second key, table or migration. A Note's `positionSeconds` is seconds inside its track; `chapterId` / `chapterOffsetSeconds` are never set on a track Note.
- **D2 Ownership rule (Main)**: multi ⇒ a save is accepted only if **every** incoming Note has a `trackId` that belongs to this book (else the whole save is refused, `ok:false`, nothing written); single-file ⇒ a save is refused if **any** Note has a `trackId`. Reads: multi ⇒ Notes with an owned `trackId` only (others are skipped, never shown, never a crash); single-file ⇒ unchanged output.
  **Foreign entries are preserved (review 2026-10-25, finding F-1)**: on a multi-track save, Main re-reads the *stored* array and **partitions the raw array into owned and foreign (unknown/foreign/missing `trackId`) entries BEFORE sanitizing either set**; the foreign set is then sanitized on its own (its own cap of 500), never together with the owned set, because `sanitizeAudioBookmarks` caps in input order and a combined `500 owned + foreign` array would silently cut the foreign tail. Preservation means *preserved after sanitization* (canonical form), not byte-identical raw JSON. Main writes `incoming (owned) + preserved foreign`. The renderer never sees or sends them, so an ordinary add / edit / delete cannot discard them. Reads partition the raw stored array **before** applying the 500 cap, so hidden entries can never push a valid Note out of the visible 500. Single-file books: unchanged (whole-array replace as today).
  **Cap at the Main boundary (final review G-1)**: multi-track only — a raw incoming array longer than 500 is refused whole (`ok:false`, nothing written); ≤ 500 is stored in full together with the preserved foreign entries, which never count toward the 500. Single-file: unchanged. See data-model rule 6 and R-16.
- **D3 Display order**: a pure SDK helper orders by track index, then `positionSeconds`, then `createdAt`. The store keeps `notes` in that order for multi books.
- **D4 Create**: allowed only when `status === 'ready'`, not `switching`, and the current track is not in `trackErrors` (FR-003). Captures `trackId` and `clampSeekPosition(el.currentTime, el.duration)` in the same synchronous step. At 500 Notes, no Note is created and the store raises a visible notice (FR-023).
- **D5 Jump**: `goToNote` resolves the Note to `{trackIndex, seconds}`. Same track and not errored ⇒ `seekTo` only (FR-012). Otherwise ⇒ the same sequence as `goToTrack` (forced save of the old track first, then `openTrack`) but with an **exact** start (clamped, not "restart near end") and with the play state captured before the switch (FR-011). Overlapping jumps are already resolved by the `trackSwitch` token: the last request wins and a stale `loadedmetadata` cannot apply a position to another track (FR-013).
- **D6 Failed jump falls back — and cannot override anything newer (review finding F-2)**. Coordination uses only mechanisms that already exist in `audioPlayerStore.ts`: the module-level `trackSwitch` token (bumped by `++trackSwitch` at the top of every `openTrack` and in teardown), the `el === audio && token === trackSwitch` guard on every element listener (`current()`), the `el !== audio` guard in `trackFailed`, and the `el !== audio` guard in the `play()` rejection path. New: one module-level `pendingJump: { token, originIndex, originSeconds } | null`, same style as `trackSwitch` / `generation`.
  1. **Set**: `openTrack` takes an optional `jump` argument (origin). It stores `pendingJump = { token, … }` right after `++trackSwitch`. **Every `openTrack` call without a `jump` argument sets `pendingJump = null`** — so a Contents click, previous/next, auto-advance, and any *other* Note jump (which replaces it) invalidate the old one at the moment they bump the token. Teardown / `load` also null it.
  2. **Origin** is taken only from a *settled* state — `status === 'ready'`, `!switching`, current track not in `trackErrors` — read from the element in the same synchronous step as the forced save of the old track. A jump started while another jump is still switching **inherits that jump's origin** (the last settled state; the in-flight track never played, so it is not a valid place to return to). If there is no settled origin (the in-flight switch was a Contents click or an auto-advance, or the current track is itself failed) the jump has **no fallback** and a failure ends in today's `TrackErrorNotice` state.
  3. **Failure callback**: `trackFailed(el)` keeps its existing guard (`el !== audio` ⇒ return). After it marks the target in `trackErrors`, clears `switching` and `playing` and stops the save timer, it does `const j = pendingJump; pendingJump = null; if (j && j.token === trackSwitch) openTrack(j.originIndex, j.originSeconds, /*autoplay*/ false, …exact start, no jump)`. The fallback is a normal `openTrack`: it retires the target's element, bumps the token and (having no `jump`) leaves `pendingJump = null`.
  4. **Why a late failure cannot override a newer action**: any newer switch has already replaced `audio` and bumped `trackSwitch`, so the retired target's `error` event is dropped by `current()`, its pending `play()` rejection is dropped by `el !== audio`, and `pendingJump` was already nulled/replaced. The token comparison in step 3 is a second, independent barrier. The only way `trackFailed` runs for the target is while it is still the current element of the latest switch.
  5. **Completed jumps cannot roll back**: `pendingJump` is also cleared in the target's `loadedmetadata` handler (the jump has succeeded). A media error minutes later gets the normal `TrackErrorNotice`, never a stale fallback.
  6. **Both fail**: the fallback's `openTrack` has `pendingJump = null`; if the origin errors, `trackFailed` finds nothing pending, marks the origin in `trackErrors` (the target is already marked), leaves `status === 'ready'`, and the standard `TrackErrorNotice` shows for the current (origin) track. **No second fallback, no loop.** Nothing is written to progress for either track (`persist` skips `switching` and errored tracks), so stored progress stays at the origin's position from the jump's forced save.
  7. **Same-track jump while unsettled**: a Note on the *current* track normally only seeks (FR-012). If the player is `switching` or the current track is in `trackErrors`, the jump instead goes through `openTrack` (new token, exact start): a seek on an element whose metadata has not arrived can be overwritten by the pending `loadedmetadata` start offset, which would break "last request wins" (FR-013).
  8. **Notice**: the fallback sets a store `noteNotice` naming the target track; the next `openTrack`, jump or successful add clears it.
- **D7 Save failures are visible**: for multi books the renderer checks the `saveBookmarks` result; on `ok:false` it reloads the list from Main and raises a notice. Single-file keeps today's fire-and-forget path.
- **D9 Notes that failed to load are not editable (multi-track only; review finding F-1b)**: the multi-track branch of `load()` reads Notes after the tracks are known (the single-file branch and its `Promise.all` are untouched). If the read rejects, the store marks Notes unavailable (add / edit / delete are no-ops, the Notes tab says they could not be loaded). Otherwise an empty-looking list followed by one add would overwrite every valid stored Note.
- **D8 UI**: reuse `NotesTab`, `NoteCard`, `AudioNoteMenu`, `audioNoteMenuStore`. Additions are small: a track label on each card and in the menu header, the "Here" highlight made track-aware, timeline markers filtered to the current track, the add control shown but disabled when unavailable.

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-track-audiobook-notes/
├── plan.md              # This file
├── research.md          # Phase 0 decisions and alternatives
├── data-model.md        # Phase 1: Note shape, ownership rules, state transitions
├── quickstart.md        # Phase 1: how to verify (commands + manual script)
├── contracts/
│   ├── notes-ipc.md         # audio:getBookmarks / audio:saveBookmarks contract (changed semantics)
│   └── sdk-track-notes.md   # pure helper contract (new SDK module)
├── checklists/requirements.md
└── tasks.md             # created by /speckit-tasks (42 tasks); implementation not started
```

### Source Code (existing layout, files this feature touches)

```text
source/apps/book-reader-sdk/
├── src/audio/
│   ├── audio-bookmarks.ts        # CHANGE: AudioBookmark.trackId?, sanitize keeps it, createAudioBookmark accepts trackId
│   ├── audio-track-notes.ts      # NEW: orderTrackNotes, trackNoteJumpTarget, trackNoteLabel, notesForTrack, cap helper
│   └── index.ts                  # CHANGE: export the new module
└── tests/audio/
    ├── audio-bookmarks.test.ts   # CHANGE: add trackId cases; keep every existing case unchanged (golden)
    └── audio-track-notes.test.ts # NEW

source/apps/reading-book-desktop/
├── electron/
│   ├── ipc/api-types.ts                      # CHANGE: AudioBookmarkDto.trackId?
│   ├── ipc/audio.ipc.ts                      # CHANGE (small): pass the RAW bookmarks array to the store so the multi-track 500 check sees it (review G-1); single-file result identical
│   └── persistence/sqlite-audio-store.ts     # CHANGE: ownership rules replace the blanket multi refusal
├── src/screens/AudioBook/
│   ├── logic/audioPlayerStore.ts             # CHANGE: addNote / goToNote / load / saveBookmarks / jump fallback / noteNotice
│   ├── AudioBookScreen.tsx                   # CHANGE: keep the Notes rail tab for multi; render the jump/limit notice
│   └── components/
│       ├── AudioSidebar.tsx                  # CHANGE: NotesTab/NoteCard track label, track-aware "Here"
│       ├── AudioControls.tsx                 # CHANGE: "+ Note" shown for multi, disabled when unavailable
│       ├── AudioTimeline.tsx                 # CHANGE: markers only for the current track's Notes
│       └── AudioNoteMenu.tsx                 # CHANGE: track label in the header
└── spikes/audio/
    ├── run-audio-main.mjs                    # CHANGE: replace the "Notes guard" check with the ownership checks
    └── run-audio-store.mjs                   # CHANGE: replace multi "Notes not read / addNote null" asserts; add the new suites
```

Not touched: migrations, `preload.ts`, `channels.ts`, `bridge/audio.ts` (the channels and their typed wrapper already pass `AudioBookmarkDto[]` through; the type gains an optional field), the ZIP import code, `audio-stream-handler` / protocol, PDF / EPUB / TXT code, `sqlite-overlay-store.ts` (progress guards unchanged), `packages/config`.

Documentation to update during implementation: `CLAUDE.md` (the audiobook ZIP paragraph says Notes for multi books "are not built yet"), and the status line of `docs/implementation_plan/audiobook_multi_track_playback_b.md` §8 (Stage C item delivered).

**Structure Decision**: no new packages or layers. Pure decisions go in a new SDK module (`audio-track-notes.ts`) next to `audio-tracks.ts` and `audio-bookmarks.ts`, unit-tested with vitest; Main gets rule changes inside the existing `SqliteAudioStore`; the renderer extends `audioPlayerStore` and the existing AudioBook components.

## Requirement → change map

| Spec | Where it is satisfied |
|---|---|
| FR-001/002/004 create, optional text, stable track id | `createAudioBookmark(trackId)`; store `addNote` multi branch; `AudioBookmark.trackId` |
| FR-003 unavailable while switching / failed / not ready | store `canAddNote` selector (derived), used by Controls + NotesTab; `addNote` re-checks |
| FR-005–008 one list, order, labels, empty state | `orderTrackNotes`, `trackNoteLabel`; `NotesTab` multi branch; rail tab restored in `AudioBookScreen` |
| FR-009 markers current track only | `AudioTimeline` filters by `trackId`; `noteMarkerFraction` (already returns `null` for unknown duration) |
| FR-010–016 jump | `trackNoteJumpTarget`; store `goToNote`; exact-start path in `openTrack`; jump fallback (D6); clamp in `trackNoteJumpTarget`/`loadedmetadata` (FR-015) |
| FR-017–019 edit / delete | existing `updateNote` / `removeNote` / `AudioNoteMenu`; they only call `saveBookmarks` (now result-aware for multi) and never touch playback |
| FR-020 local persistence | `audioBookmarks` key in `reading_state_json`; no new location |
| FR-021/022/024 ownership, tolerant read | `SqliteAudioStore.getBookmarks` / `saveBookmarks` (D2) |
| FR-023 limits + notice | store cap check for multi (D4) + Main-boundary refusal of a raw incoming array > 500 (D2, R-16); orphans do not count; text cap already in `normalizeNoteText`; notice multi-track only (P-2) |
| FR-025 remove audiobook removes Notes | by construction (row deleted); asserted in spike |
| FR-026 progress untouched | `json_patch` on a different key; asserted in spike |
| FR-027/028 single-file and PDF/EPUB unchanged | existing branches kept byte-for-byte; golden vitest + existing spike checks; no PDF/EPUB file is in the change set |
| FR-029–031 no sync/export, no progress work, no import change | nothing added; scope guard in Risks |

## Regression risks and mitigations

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | `trackId` silently stripped by the sanitizer (read or write) → Notes lose their track or all look "orphaned". | Teach `sanitizeAudioBookmarks` to keep a valid `trackId`; vitest: round trip; spike: real IPC round trip asserts `trackId` survives. |
| R-2 | Changing the shared sanitizer / `createAudioBookmark` alters single-file output. | Only add an optional field; no change when `trackId` is absent. Golden vitest on today's outputs (existing cases kept unchanged); existing store-spike Notes checks (lines ~534–650) must stay green unmodified. |
| R-3 | A single-file book ends up holding Notes with a `trackId` (or the reverse). | Main ownership rule in both directions (D2); spike asserts both refusals and that nothing is written on refusal. |
| R-4 | Note in the last 2 s of a track jumps to 0. | Exact-start path for Note jumps; unit test for `trackNoteJumpTarget`; store spike case with a Note at `duration − 1`. |
| R-5 | Overlapping jumps / track switches apply one Note's second to another track. | Reuse `openTrack` + `trackSwitch` token + `el === audio` guards; D6 step 7 closes the one gap found (same-track jump while unsettled). Store spike cases "A → Note on B → Note on C quickly", "late `loadedmetadata` of B after C", "second Note on the loading track", mirroring the existing race suite. |
| R-6 | Failed-jump fallback creates a loop, a blank player, or overrides a newer action. | D6: `pendingJump` bound to the switch token; nulled by every non-jump `openTrack`; cleared on target `loadedmetadata`; fallback has no jump of its own. Spike cases in the store spike: (a) target fails → origin restored, paused, notice; (b) target fails *after* a newer Contents click / newer Note jump / auto-advance → no fallback, newer action wins; (c) target and origin both fail → standard error notice, no loop, no progress saved for either; (d) target fails mid-playback after it loaded → no fallback; (e) jump with no settled origin → no fallback. |
| R-7 | Orphan handling loses data silently: skipped on read, then dropped by the next whole-list save. **Confirmed (F-1)**: with a plain "skip on read, replace on save" an ordinary add/edit/delete would permanently discard them. | **Resolved in the plan**: Main preserves foreign stored entries on every multi-track save and partitions before the cap on read (D2). Spike: seed a foreign and a missing-`trackId` entry in the stored JSON, run add / edit / delete through the real IPC, assert the foreign entries are all still stored, equal in canonical form, afterwards (canonical seeds; partition-before-sanitize also covered with 500 owned + foreign) and never returned to the renderer. |
| R-16 | **(G-1)** Incoming multi-track list above 500 is silently cut: the IPC handler runs `sanitizeAudioBookmarks` (cap, input order) before the store, so valid Notes beyond the 500th would vanish with `ok:true`. | Multi-track: Main refuses a raw incoming array > 500 (`ok:false`, nothing written); exactly 500 is accepted; foreign entries do not count. Handler passes the raw array to the store. Single-file keeps today's silent truncation, pinned by a golden (tasks T002, T011, T013). |
| R-15 | A failed Notes read leaves an empty-looking list; the next add overwrites every valid stored Note. | D9: Notes unavailable until the read succeeds (multi-track only). Spike: make `getBookmarks` reject → add / edit / delete are no-ops, nothing written. |
| R-8 | Optimistic UI shows a Note that Main refused. | D7: result check, reload from Main, visible notice; spike simulates a refused save. |
| R-9 | "Here" highlight / markers compare a track-relative second with another track's position. | Highlight and markers require `note.trackId === current track id`; unit-tested selector logic via SDK helper `notesForTrack`; store spike asserts. |
| R-10 | Notes view slow with 500 Notes. | Plain list, memoised ordering, cards already lightweight; measure once in the manual check (SC-008). |
| R-11 | Scope creep into percent, totals or whole-book timeline. | Explicitly excluded; code review checklist: no change to `persist()`, `timelineView`, `BookProgress`, `audioProgressPatch`. |
| R-12 | The local `audiobookZipImportEnabled: true` gets committed together with this work, (the existing gate test checks `HEAD`, so it stays green locally; it would only turn red on a commit that carries `true`). | Do not stage `features.ts`; the plan changes no config file. Baseline is green; there is no known baseline failure. |
| R-13 | Downgrade: an older build opening a book that has track Notes. | Older builds return `[]` / refuse for multi-track books and ignore the extra field for single-file ones; no data is damaged. Documented, no action. |
| R-14 | Old plan documents contradict the code and mislead future work. | Update `CLAUDE.md` and the Stage B plan status line as part of implementation. |

## Verification strategy

Details and exact commands are in [quickstart.md](./quickstart.md). Summary:

0. **Characterization first (review finding F-3)**: before the sanitizer, `createAudioBookmark` or `SqliteAudioStore` are edited, capture today's single-file outputs as fixed expected values — vitest goldens for `sanitizeAudioBookmarks` / `createAudioBookmark` (inputs without `trackId`, incl. garbage, duplicates, over-cap, chapter refs), and in `spike:audio:main` the exact stored `audioBookmarks` JSON string and `getBookmarks` result for a fixed single-file save. They must pass before **and** after the change, unmodified.
1. **SDK vitest** (`cd source/apps/book-reader-sdk && npm run verify`): the goldens above; sanitizer keeps / drops `trackId`; creation with `trackId`; ordering; labels; jump target (same track, other track, unknown track, position beyond duration, within 2 s of the end, unknown duration); cap helper.
2. **`spike:audio:main`** (real Main IPC + SQLite):
   - multi-track save/get round trip incl. `trackId`; refusal of missing / foreign-book / unknown `trackId`; whole save refused atomically; single-file refuses `trackId`; the existing single-file Notes round trip **kept as its own check, verbatim** (the current "NOTES guard" check mixes the multi refusal and the single-file half — split it; only the multi half is rewritten);
   - **preservation matrix (F-3)**: seed a multi-track book's `reading_state_json` with unrelated keys (`lastReadLocation`, `fontSize`, an unknown `futureKey` object, and `audioProgress` with `trackId`, `positionSeconds`, `playbackRate`, `scope`, `updatedAt`, no `percent`). Through the real IPC run add → edit → delete. After each step assert: the parsed state **minus `audioBookmarks`** is deep-equal to the seed, `audioProgress` is byte-identical (compare the raw JSON substring/stringified object), `percent` is still absent. Then the reverse: `overlay:saveAudioProgress` leaves `audioBookmarks` identical;
   - **foreign entries (F-1)**: seed an entry with a foreign `trackId` and one with no `trackId`; they are not returned by `getBookmarks`; after add / edit / delete they are still in the stored array, unchanged; with 500 visible Notes plus foreign ones all 500 visible Notes are returned; seeded with **500 owned + canonical foreign entries**, editing one owned Note leaves every foreign entry in the stored array (partition before sanitize, U1); foreign entries are compared in canonical form, not as raw bytes (U2);
   - **cap at the Main boundary (G-1)**: multi-track raw incoming array of exactly 500 ⇒ `ok:true` and saved in full with foreign entries kept; 501 ⇒ `ok:false`, stored array unchanged; orphans never count toward the 500; single-file 501 ⇒ unchanged silent truncation, pinned by the T002 golden;
   - text cap; remove audiobook leaves no Notes (via `spike:audio:zip-import`).
3. **`spike:audio:store`** (real renderer store, scriptable `Audio`; real Main IPC underneath):
   - add on ready / unavailable while switching, failed, or not ready; a track with unknown duration still accepts a Note; ordering across tracks; edit in place; delete; on a failed current track existing Notes stay editable and deletable while add stays blocked; rapid add → edit → delete → add-back leaves the stored list equal to the final in-memory list (`bookmarkChain` kept);
   - **progress isolation (F-3)**: add, edit and delete issue **zero** `saveAudioProgress` calls (`calls.save` unchanged) and leave stored `audioProgress` untouched. A **jump** is a real navigation and therefore *does* move progress, but only by the existing rules: one forced save of the old track `{trackId: old, position}` before the switch, then saves of the target `{trackId: target, positionSeconds: note second}` with no `percent` / `durationSeconds` / `chapterId`; a failed jump never saves the target's id (stored progress ends at the origin);
   - jump same track (no new element, no new-track save), jump other track while playing / paused, exact start near the end, clamped start beyond the end, rapid jumps (last wins), the R-6 (a)–(e) fallback cases, D6 step 7 same-track-while-unsettled case, D9 (rejected read ⇒ Notes unavailable); 500-Note cap notice; refused save reloads; every observed state keeps `status === 'ready'`;
   - **all existing single-file Notes checks stay unmodified and green**: `bookmarks: create…restore…delete` (k8), `bookmarks and progress live side by side…` (k9), `bookmark storage is audio-only and validated` (k10), `notes: add…edit…delete`, `notes: a very long text is capped…`, and `single-file regression…` (the last one's `addNote()` truthiness stays). Only the multi-track assertions that today expect "Notes not read / `addNote()` null" are rewritten.
4. **Static**: desktop `npm run typecheck`, `npm run lint`, `npx vite build`; SDK `npm run verify`. These are the CI-equivalent checks.
5. **Manual (person), not automated**: the 68-track archive: add Notes in several tracks, restart, list order, jump while playing / paused, break a track file and jump to its Note, remove audiobook; a single-file audiobook's Notes; a PDF/EPUB sanity open.
6. **Not run**: E2E, Electron windows, `spike:e2e:*` (project rule: manual-only).

## Open points for approval (none block planning)

- **P-1 — APPROVED (2026-10-25)**: fallback to the origin track on a failed Note jump (D6), paused, with a notice naming the failed target; no retry loop; the failed target's progress is never saved.
- **P-2 — APPROVED (2026-10-25)**: the 500-Note cap notice applies to multi-track books only (FR-023 + FR-027). Single-file books keep their silent truncation as today.
- Orphan preservation (D2) and "Notes unavailable if the read fails" (D9) were also approved on 2026-10-25.

## Pre-tasks review (2026-10-25)

Three risks were re-checked against `audioPlayerStore.ts`, `sqlite-audio-store.ts`, `audio-bookmarks.ts` and the audio spikes. No source was changed.

| # | Risk | Status | Outcome |
|---|---|---|---|
| F-1 | Orphan Notes discarded by whole-array replace | **Confirmed** | `saveBookmarks` writes `audioBookmarks` as the incoming array only, and the renderer sends the filtered list, so one ordinary add/edit/delete would erase hidden entries. Also found: a *rejected read* (`.catch(() => [])` in today's single-file load) followed by one add would overwrite all valid Notes. Plan changed: D2 (Main preserves foreign entries, partitions before the cap) and D9 (multi-track Notes unavailable until the read succeeds). Single-file behaviour deliberately untouched; the single-file load's `.catch(() => [])` is a pre-existing, out-of-scope weakness. |
| F-2 | Fallback can override a newer switch / jump; both-fail case | **Confirmed as a gap in the first draft, closed in the plan** | The first draft said "fallback on that switch token" without saying how. D6 now specifies `pendingJump` bound to `trackSwitch`, nulled by every non-jump `openTrack`, cleared on `loadedmetadata`, with the guards that already exist in the repository doing the rest. Also found and closed: a same-track Note jump while the player is still switching would only seek and could be overwritten by the pending start offset (D6 step 7). Both-fail ends in the standard notice, no loop. |
| F-3 | Single-file regression and progress/other-key preservation not proven strongly enough | **Confirmed (verification gap)** | The existing spikes already cover single-file Notes and progress side by side, but not the multi-track equivalents, and the "NOTES guard" check bundles the multi refusal with the single-file half. Verification section now requires characterization goldens before any edit, splits that check, adds a multi-track preservation matrix (every key except `audioBookmarks` deep-equal, `audioProgress` byte-identical, `percent` absent) and zero `saveAudioProgress` calls for add/edit/delete. A jump legitimately moves progress (like a Contents click); what is verified is *how*. |

## Complexity Tracking

No constitution violations; nothing to justify.
