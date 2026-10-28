# Multi-track audiobook playback (Stage B) — plan, starting with the track list in the left "Contents" sidebar

Status: **final review — plan only, not implemented.** Revision 2: incorporates the review decisions (§9) and the four pre-implementation checks (§6 gate,
§3.4 track-switch race, §3.3 `switching` vs screen `loading`, §3.5 guards). Continues `audiobook_multi_chapter_import.md` (Revision 4, §4–§6) after A1
(schema, store, SDK layout, `trackId` patch) and A2 (real ZIP import, remove audiobook, flag). Every statement about the current player was checked in
`src/screens/AudioBook/**`, `electron/audio/**` and `electron/persistence/**`.

## 0. Where we are (what the screenshot shows)

An imported multi-chapter ZIP opens in the existing audiobook screen and behaves like a single file: it streams `rb-audio://local/{bookId}`, which resolves
to **chapter 0 only** (`books.file_path`). The screen shows chapter 0's length (14:31), "100% · finished" when that one file ends, and the Contents panel says
*"This audiobook has no chapter information"* — that panel (`ChaptersTab` in `AudioSidebar.tsx`) lists only chapters **declared inside the one file**
(`audio:getChapters`); the 68 imported tracks are nowhere in it.

Goal of Stage B: the Contents panel lists the **tracks** (the chapters the user selected in the ZIP preview), any track can be played, and the player moves
through them like one audiobook. **B1** delivers the visible list + playing any track; **B2** delivers navigation, auto-advance, restore and error polish.
**B1 and B2 are one user-facing release** (decision D1 of the main plan): nothing may reach users with only B1.

## 1. Target UI — the left "Contents" sidebar

Same panel, same rail icon, same row style as the chapters list; only the data differs. For a multi-track book (`tracks.length > 0`):

```
Contents                                  ✕
68 tracks
 01  war_peace_v1_…_01_tolstoy        14:31      ← current: accent number, bold title,
 ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔░░░░░░░░░░                    thin progress bar of THIS track
 02  war_peace_v1_…_02_tolstoy        20:53
 03  Part Two – Chapter 3               —        ← unknown duration shows "—"
 …
```

- **Row label (decided):** `NN` (zero-padded position + 1) · the track's **tag title, or the file stem when it has none** (that is what `book_audio_chapters.title` already holds).
  Truncated to one line, full title as tooltip. **No second line with the archive-relative file name in this release.**
- **Duration** at the right: `mm:ss` / `h:mm:ss`, or `—` when `duration_seconds` is NULL (a duration learned while playing is kept in memory only).
- **Current track**: `aria-current="true"`, accent background, thin bar showing position inside the track (the existing `CurrentChapterBar` with `start = 0`, `end = track duration`; hidden while the duration is unknown).
- **Click on another track (decided):** switch to it from 0 **and preserve the play state**: playing ⇒ the new track plays; paused ⇒ the new track is loaded and stays paused.
  **Click on the already-current track does nothing** (never restarts it, no seek, no save).
- **Scroll**: the current row scrolls into view when the track changes (`scrollIntoView({block:'nearest'})`, as chapters do today).
- **A track that cannot be played** (file missing / media error) shows `⚠` and "Can't play" instead of the duration; all other rows keep working (§3.4).
- **Empty/loading**: "Reading tracks…" until `audio:getTracks` returns (read together with the other `load()` calls).
- **Long lists**: up to 5 000 tracks are possible (ZIP limit). Rows get `content-visibility: auto; contain-intrinsic-size: auto 40px`; real windowing only if profiling shows a need.
- **Tabs**: Notes (pencil) is **removed from the left rail** for multi-track books until Stage C; Contents and Attachments rail icons stay. Single-file books keep all tabs and `ChaptersTab` exactly as today.

Elsewhere on the screen (so nothing lies in multi mode, all in B1):
- **Title block (decided):** the **current track's title is the main heading** (h1); eyebrow **"Track 3 of 68"** above it; the audiobook title and author are the secondary line (same layout as the chapter eyebrow/meta now).
- The whole-book progress bar/percent (`BookProgress`) is **not shown** — its numbers would be per-track.
- Timeline: one seek bar for the **current track** (label "Track 3 of 68" instead of "Whole book"); the Book/Chapter selector is hidden.
- Controls (B2): previous/next enabled ("Previous track"/"Next track"); "+ Note" hidden; Sleep "End of chapter" reads "End of track".

## 2. Design (approved): track-relative player — no virtual book timeline

- The player plays **one track at a time**; `positionSeconds` and `durationSeconds` in the store are those of the **current track**. **No virtual whole-book timeline is built, and no code requires every track's duration to be known.**
- New store state: `tracks: AudioTrack[]` (`{ id, title, durationSeconds | null }`), `trackIndex` (−1 for single-file books), `switching: boolean`, `trackErrors: ReadonlySet<string>`.
- Multi mode = `tracks.length > 0`. With no tracks the existing code paths run untouched.
- `chapters`/`chapterStatus` stay empty/`'none'` in multi mode (embedded chapters ignored, D4).
- Totals, Book scope and percent are Stage C. The `trackId` + position-in-track storage written by A1 is what that model needs. `tracksToChapters` from the earlier plan is **dropped**.

## 3. Exact current code paths and what changes

### 3.1 Main / IPC (B1)
| Today | Change |
|---|---|
| `audio-stream-handler.ts`: `parseAudioRequestUrl` accepts only `rb-audio://local/{bookId}`; `AudioFileLookup(bookId)` | add `parseAudioRequestTarget(url) → { bookId, trackId? }` (optional 2nd segment; same rejections for `/ \ NUL`, other hosts; `trackId` must be a UUID); keep the old function (used by `spike:audio:main`). `AudioFileLookup(bookId, trackId?)`; MIME from the **found** format |
| `audio-protocol.ts`: book → `isAudioFormat(book.format)` → `resolveBookFile(book)` | with a `trackId`: chapter row via new store method `getAudioChapter(bookId, trackId)`, path = `dirname(book.filePath)/file_name`, containment check (`path.relative` not starting with `..`), then `resolveBookFile({ filePath, format: row.fileFormat })`. **Format = the chapter's, not the book's.** No `trackId` ⇒ the book's file = chapter 0 (back-compat; the preflight uses it) |
| `audio.ipc.ts`: `audio:getChapters` reads tags of `file_path` | multi-track ⇒ `{ ok:true, chapters: [] }`; **new** `audio:getTracks(bookId)` → `{ ok, tracks: [{ id, title, durationSeconds|null }] }` (`[]` for single-file); no paths cross IPC |
| `sqlite-overlay-store.ts` `saveAudioProgress` | **Main-layer guard (Revision 4 §5.6, unchanged):** multi book ⇒ require a `trackId` that belongs to **that** book, else `false`; single-file book ⇒ a `trackId` is rejected. Not gated by the flag |
| `sqlite-audio-store.ts` `getBookmarks`/`saveBookmarks` | **Main-layer guard (Revision 4, unchanged):** multi book ⇒ `[]` / `false`. Not gated by the flag |
| `api-types.ts` / `channels.ts` / `preload.ts` / `bridge/audio.ts` | `AudioTrackDto`, `AudioTracksResult`, `audio.getTracks`; `trackId?` on `AudioProgressDto` and `SaveAudioProgressInput` |

### 3.2 SDK (B1)
New `src/audio/audio-tracks.ts` (pure, vitest): `AudioTrack`, `resolveInitialTrack(tracks, progress)` (a saved `trackId` found in `tracks` ⇒ that index + the saved position; missing, non-string or unknown `trackId` ⇒ index 0, position 0 and **the saved position is discarded**),
`previousTrackAction(index, positionSeconds)` (`restart` if > 3 s into the track or already first, else `previous`), `nextTrackIndex(index, count)`, `trackEyebrow(index, count)`, `trackDurationLabel(durationSeconds)` (`—` for null).

### 3.3 Renderer — and `switching` vs the screen-level `loading` (B1 → B2)
`AudioBookScreen` renders `ReaderOpenStatus` (a full-screen "opening…") whenever the store's **`status`** is `'idle' | 'loading'`, and a full-screen error for `'error'`. Therefore:
- `status` keeps its current, **screen-level** meaning (book-level load/failure only). During a track switch **`status` stays `'ready'`** — it is never set to `'loading'`, and a failed track never sets `'error'`.
- A **separate** boolean `switching` marks "a track change is in flight". `persist()` returns early while `switching` (as it already does when `status !== 'ready'`). `switching` is cleared on the new element's `canplay`/`loadedmetadata` (or its error).
- **Per-track media errors never call `fail()`** in multi mode (that would blank the player): they set `trackErrors` (+ an inline message under the controls with a "Skip to next track" action) and leave `status: 'ready'`. The screen-level error stays only for book-level failures (book not found, `audio:getTracks` failure, the preflight).
- Same for the **initial** track: if the restored track cannot be opened the player shows the inline error and the list, so the user can pick another track.
- Test assertion (store spike): every observed store state during any switch has `status === 'ready'`.

| File | Change |
|---|---|
| `logic/audioPlayerStore.ts` | **B1:** `tracks`, `trackIndex`, `switching`, `trackErrors`; `load()` reads `audioApi.getTracks` with the other calls; multi ⇒ skip `getChapters`/`getBookmarks`, pick the start track via `resolveInitialTrack`, `audioStreamUrl(bookId, trackId?)`; `goToTrack(index, …)` (§3.4); `persist()` adds `trackId` (multi) and sends **no** `durationSeconds`/`chapterId`. **B2:** `previousChapter`/`nextChapter` → track navigation, auto-advance on `ended`, sleep "end of track", per-track error UI, `addNote`/`goToNote` no-ops |
| `components/AudioSidebar.tsx` | **B1:** new `TracksTab`; `PanelBody` renders it instead of `ChaptersTab` when `tracks.length > 0` |
| `AudioBookScreen.tsx` | **B1:** `TitleBlock` (track title h1 + eyebrow + book/author secondary); hide `BookProgress` and `ProgressScopeSelector`; remove the Notes rail tab (`SIDEBAR_TABS` filter) in multi mode |
| `components/AudioTimeline.tsx` | **B1:** multi mode = track-relative bar over `[0, trackDuration]`, "Track i of N" label, no chapter ticks, no note markers |
| `components/AudioControls.tsx` | **B2:** prev/next enabled and relabelled; "+ Note" hidden; Sleep option relabelled |
| `bridge/audio.ts` | `getTracks` |

### 3.4 Track switching: one `Audio` element per track, so stale events cannot reach the current track
The current player reuses ONE `Audio` element for the whole book. If a track switch only reassigned `el.src`, events of the previous file (`loadedmetadata`, `error`, `timeupdate`, `pause`, `ended`) could still fire on that same element after the switch, and a handler cannot tell which file an event belongs to (`currentSrc` updates asynchronously). A counter token alone is therefore not a sufficient guarantee. Stage B does this instead:

1. **A new `Audio` element for every track change.** The previous element is retired synchronously: its listeners are removed, then `pause()`, `removeAttribute('src')`, `load()`; the module-level `audio` reference is replaced. Volume and playback rate are copied to the new element.
2. **Every handler is bound to its own element** and starts with `if (el !== audio) return` — an event of a retired element is dropped even if the browser still delivers it.
3. **`trackSwitch` token** (incremented synchronously per switch) guards the *asynchronous* continuations that are not element events: the forced save, the `play()` promise, the saves chained after it.
4. **Order inside `goToTrack(index)`** (all synchronous except the awaited save):
   a. if `index === trackIndex` return (clicking the current track does nothing);
   b. remember `wasPlaying`; read `{ trackId: A, position: A.currentTime }` and issue the forced `persist(true)` **before anything changes** (the payload is built from the *old* element and store state);
   c. set `switching: true`, `trackIndex = index`, clear `trackErrors[target]` (retry), create the new element, attach listeners, `el.src = …`;
   d. on the new element's `loadedmetadata`: apply the start offset (0, or the restored position), `switching: false`; if `wasPlaying` ⇒ `play()`.
5. **`persist()` rules:** never while `switching`; never for an element that is not the current one; the payload's `trackId` is read from the store **at the same instant** as `currentTime` of the current element, so A's position can never be written with B's `trackId` (or the reverse). Writes keep going through the existing `saveChain`, so a slow save of A can never land after C's.
6. **A track that errors or never loads** (B): `trackErrors += B`, `switching: false`, the element is paused, **nothing is saved for B**, the last saved progress stays A's. The user can pick any other track — including C — immediately: `goToTrack(C)` is allowed in this state (it retires B's element like any other switch) and plays C normally.
7. **`ended`** on a retired element is ignored, so a stale `ended` can never trigger an auto-advance (B2).
8. A pending `play()` of the retired element rejecting with `AbortError` is not a failure (already handled today).

### 3.5 Guards that must hold (unchanged requirements)
- **Single-file audiobooks:** `tracks.length === 0` ⇒ the existing `load()` branch, one element for the whole book, `ChaptersTab`, `BookProgress`, scope selector, Notes, chapter navigation and the existing progress payload (no `trackId`) are **byte-for-byte the same code paths**. The store spike's existing 33 checks must stay green unchanged.
- **Main-layer progress guards and Notes guards (Revision 4 §5.6)** ship in B1 and are not gated by the feature flag: they protect data regardless of what the renderer does.
- Single-file `saveAudioProgress` without `trackId` takes the old path; `audioProgressPatch` without `trackId` is unchanged (A1 golden tests).

## 4. Staging inside Stage B (one release)

**B1 — "see the tracks, play any of them"**
1. SDK `audio-tracks.ts` + vitest.
2. Main: `getAudioChapter`, URL target parsing, lookup/containment, `audio:getTracks`, empty `getChapters` for multi, **progress write guard**, **Notes guards**, DTOs/channels/preload/bridge.
3. Store: `tracks`/`trackIndex`/`switching`/`trackErrors`, load path, **element-per-track `goToTrack`** (§3.4), `persist` with `trackId`.
4. UI: `TracksTab`, title block, hide `BookProgress`/scope selector/Notes tab, track timeline.
*Exit:* the 68-track book shows 68 rows; clicking row N plays that track (play state preserved); nothing shows a wrong percent/total; single-file books unchanged.

**B2 — "behaves like one audiobook"** (same release)
5. Previous/next track, auto-advance (last track stops), sleep "end of track".
6. Restore: reopening resumes the saved `trackId` + position; invalid/missing `trackId` ⇒ track 0 at 0 (`resolveInitialTrack`).
7. Per-track error UI (`⚠` row, inline message, skip), Notes controls hidden, controls relabelled.
*Exit:* play across a track boundary with no interaction, close and reopen, land on the same track and second.

**Implementation starts with B1** (step 0 below, then steps 1–4). B2 is not optional and not a later release.

## 5. Tests

- **SDK vitest** (`npm run verify`): `resolveInitialTrack` (found / unknown / missing / non-string / negative position / empty tracks), `previousTrackAction` (3 s rule, first track), `nextTrackIndex` (last), `trackEyebrow`, `trackDurationLabel` (`—`).
- **Gate test (SDK vitest, node)** `tests/config/audiobook-zip-gate.test.ts`: reads `packages/config/features.ts` as text and asserts `audiobookZipImportEnabled: false` — see §6.
- **`spike:audio:main`** (extend): per-track `rb-audio://local/{book}/{track}` → 206/416 with the **track's own MIME** (mixed mp3 + wav book); forged/other-book/unknown `trackId`, `..`, a symlinked chapter file ⇒ 404; book-only URL still serves chapter 0; `audio:getTracks` order/shape and `[]` for single-file; `getChapters` empty for multi; **progress guards** (multi without/foreign `trackId` ⇒ `ok:false`; single-file with `trackId` ⇒ `ok:false`; single-file normal save unchanged); **Notes guards** (multi `saveBookmarks` false / `getBookmarks` `[]`; single-file Notes round trip unchanged).
- **`spike:audio:store`** (extend; the scriptable `Audio` mock must record every instance and let a test fire any event on any instance, in any order):
  - **Track-switch race/error suite (mandatory):**
    1. *A → B fails → C.* A is playing at 12 s. `goToTrack(B)`: assert the forced save `{trackId:A, positionSeconds:12}` was issued **before** the new element's `src` was set, `switching === true`, `status === 'ready'`. B's element fires `error`: assert `trackErrors` has B, `switching === false`, `status` still `'ready'`, **no save with `trackId: B`**, last saved progress is still A@12. `goToTrack(C)`: assert B's element was retired (listeners removed, `src` cleared). **Then fire B's late events on the retired element** — `loadedmetadata`, `canplay`, `timeupdate` (position 99), `pause`, `ended`, a second `error`: assert none changes `positionSeconds`, `trackIndex`, `trackErrors`, `switching`, `playing`, `ended`, and none triggers a seek on C's element or an auto-advance. C's `loadedmetadata` seeks C to **its** start offset only; `play()` works; the next save is `{trackId:C, position:C.currentTime}`.
    2. *A → B (slow load) → C before B is ready.* B's `loadedmetadata` arrives after the switch to C: dropped; C's offset is applied once; exactly **one** forced save for A in total, none for B.
    3. *Rapid A → B → C → D clicks:* only D ends up current/loaded, one save for A, none for B/C; `saveChain` order preserved (a deliberately slow save of A resolves **after** a later save and the final stored `trackId` is still the latest).
    4. *Play-state preservation:* playing ⇒ the new track plays; paused ⇒ stays paused; **click on the current track ⇒ no new element, no save, no seek**.
    5. *Retry:* click B again after its error ⇒ B loads again (`trackErrors` cleared).
    6. *`switching` is not `loading`:* collect every state change during all of the above; assert `status === 'ready'` in all of them (the screen never shows the opening view) and that `persist()` writes nothing while `switching`.
  - Multi load starts on the restored track; unknown/missing `trackId` ⇒ track 0 at 0 and **the saved position is never applied** (`currentTime === 0`); auto-advance and last-track stop (B2); previous/next (B2); saved payload has `trackId` and **no** `percent`/`durationSeconds`/`chapterId`; `addNote()` null; `getBookmarks` not called in multi mode.
  - **Single-file regression:** all existing store checks unchanged; additionally a single-file book never creates a second `Audio` element and never sends `trackId`.
- **Typecheck / lint / `vite build`**. No Electron/E2E window.
- **Manual release check (person), part of the gate:** the 68-track LibriVox ZIP: list shows 68 rows with the tag/stem titles; click track 30 while playing and while paused; let a track end and watch it advance; break one chapter file on disk and verify the player still plays the next track; close and reopen; Notes tab absent; no percent anywhere; a single-file audiobook still has Notes, chapters, percent.
- The Contents list rendering has no component runner; its decisions (current index, labels, `—`, eyebrow) come from the unit-tested SDK helpers and the JSX stays trivial.

## 6. Feature gate — `audiobookZipImportEnabled` must be `false` in anything users get

**Current state (blocker until fixed):** the working tree has the flag set to `true` (switched on locally on request, uncommitted). That must not be committed or built into a user-facing build. "Only use test ZIPs" is **not** an accepted safeguard. Safeguards, in order of strength:
1. **Step 0 of implementation:** set `defaultFeatures.audiobookZipImportEnabled` back to `false` (the only committed value until the release commit). Local developers who need the menu flip it in their working copy and never stage `features.ts`.
2. **Guard test** `tests/config/audiobook-zip-gate.test.ts` (runs in CI with `npm test`): fails if `features.ts` contains `audiobookZipImportEnabled: true`. Flipping the flag is therefore a deliberate edit of **both** files in the single release commit — the explicit review point. It is the only code allowed to change in that commit besides release notes.
3. **Main does not register** any `zipImport:*` handler while the flag is `false` (already implemented in A2) — a renderer cannot reach the importer by calling `window.api`.
4. **UI**: `ImportMenu` renders no ZIP entry while `false` (already implemented in A2).
5. **Release condition:** the flag flips only when **B1 and B2 are both merged** and the §5 checklist (SDK `verify`, desktop typecheck/lint/build, all audio spikes incl. the race suite, manual 68-track check, single-file regression) is green. B1 alone never satisfies it.
6. **Books imported while the flag was on stay usable** after it is turned off (they exist in the user's library with chapter rows): the Main guards, the track list, playback, "Remove audiobook…" and the library DTO are **not** gated by the flag — only *creating* new multi-chapter imports is.

## 7. Risks

- **R-B1 (high)** track switching races (stale events, double save, wrong `trackId`) — structural fix: element-per-track + `el !== audio` guard + `trackSwitch` token + save ordering, proven by the mandatory race suite (§5).
- **R-B2** `book.format` is only chapter 0's: protocol MIME/extension must use the chapter's format (tested with a mixed mp3/wav book).
- **R-B3** gaps: a new element per track means a short silence between tracks (no gapless playback in v1). Acceptable for spoken audio; stated in release notes.
- **R-B4** `skipBy(+30)` near the end of a track does not spill into the next track in v1 (clamped to the track).
- **R-B5** a new element created from an `ended` handler (auto-advance) relies on Chromium's autoplay policy; Electron's default (`no-user-gesture-required`) allows it and the document already has user activation from the first play. Covered by the manual check.
- **R-B6** durations: unknown ones show "—"; a duration learned while playing is kept in memory only (writing it back is Stage C).
- **R-B7** the flag is currently `true` in the working tree (§6): risk of an accidental commit — mitigated by implementation step 0 and the guard test.
- **R-B8** per-track errors must never reach `fail()` in multi mode (it blanks the player); covered by the `status === 'ready'` assertion in the race suite.

## 8. Out of scope (Stage C)
> **Delivered separately:** Notes for multi-track books — see `specs/001-multi-track-audiobook-notes/` (spec, plan, tasks). The Notes rail tab, "+ Note", timeline markers and Note jumps are on for multi-track books; the "Notes controls hidden" / "remove the Notes rail tab" items above no longer apply.

Still out of scope: book-level percent / total / remaining time, the Book scope timeline, writing learned durations back, Continue Reading, gapless playback, spill-over seeking, a second file-name line in the track list.

## 9. Decisions (resolved)
1. Track-relative playback/timeline approved; no virtual book timeline; no requirement that all durations are known.
2. Row label = tag title or file stem; no second archive-path line in this release.
3. Clicking another track preserves play state (playing stays playing, paused stays paused); clicking the current track does nothing.
4. The current track title is the main heading; audiobook title and author are secondary.

## 10. Readiness and implementation boundaries

**Blockers: none for the plan.** One pre-existing working-tree condition must be corrected as the first implementation step (not a plan blocker): `audiobookZipImportEnabled` is `true` locally and must go back to `false` (§6).

**The plan is ready for implementation. Implementation starts with B1** (step 0: restore the flag + add the guard test; then steps 1–4). **B2 (steps 5–7) must be completed and verified before any user-facing release; B1 is never released alone.**

Boundaries for B1: it may change only the files listed in §3 and §7 of this plan's scope table; it must not touch the single-file import or single-file playback paths, the ZIP reader/preview/importer, migrations (028 already has everything), EPUB/PDF/TXT/MD, or `tracksToChapters`/virtual timeline code (none will exist). It must keep the Main-layer progress/Notes guards and must not gate them behind the flag.

## 11. File-by-file scope
New: `book-reader-sdk/src/audio/audio-tracks.ts` (+ `tests/audio/audio-tracks.test.ts`), `book-reader-sdk/tests/config/audiobook-zip-gate.test.ts`.
Changed (B0/B1): `packages/config/features.ts` (flag back to `false`), `electron/audio/audio-stream-handler.ts`, `audio-protocol.ts`, `ipc/audio.ipc.ts`, `ipc/channels.ts`, `ipc/api-types.ts`, `preload.ts`, `persistence/sqlite-library-store.ts` (`getAudioChapter`), `sqlite-overlay-store.ts`, `sqlite-audio-store.ts`, `src/bridge/audio.ts`, `AudioBook/logic/audioPlayerStore.ts`, `AudioBook/components/AudioSidebar.tsx`, `AudioBookScreen.tsx`, `AudioTimeline.tsx`, SDK `audio/index.ts`, `spikes/audio/run-audio-main.mjs`, `run-audio-store.mjs` (scriptable `Audio` records instances).
Changed (B2): `audioPlayerStore.ts`, `AudioControls.tsx`, the same two spikes.
Release commit (after the gate): flag → `true` **and** the guard test updated, nothing else.
