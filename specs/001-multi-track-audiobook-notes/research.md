# Research: Notes for Multi-Track Audiobooks

All unknowns from the Technical Context were resolved by reading the repository (2026-10-25). No external research was needed; there are no new dependencies. Each entry: Decision / Rationale / Alternatives.

## R1. Where do track Notes live?

- **Decision**: In the existing `reading_state_json.audioBookmarks` array of the parent book row, with one new optional field `trackId` per Note. `positionSeconds` of such a Note is seconds inside that track.
- **Rationale**: The spec requires "the existing app persistence system"; Notes already travel with the book row (so removing the audiobook removes them, FR-025), are written by `json_patch` without disturbing `audioProgress` (FR-026), and need no migration. The single-file code path stays identical when `trackId` is absent (FR-027).
- **Alternatives**: (a) A `book_audio_notes` table with a foreign key to `book_audio_chapters` — real referential integrity and cascade, but needs migration 029, a second persistence path for the same concept, and a data-model split between single-file and multi-track Notes. Rejected as disproportionate. (b) Store Notes inside the chapter rows — wrong granularity, and would couple Notes to import data. Rejected.

## R2. How is "belongs to a track of this audiobook" enforced?

- **Decision**: In Main, inside `SqliteAudioStore`, against `book_audio_chapters`: multi ⇒ every Note must carry an owned `trackId` or the whole save is refused; single-file ⇒ any `trackId` refuses the save. Reads in multi mode skip Notes with an unowned `trackId`.
- **Rationale**: Mirrors the already-shipped progress guard in `SqliteOverlayStore.saveAudioProgress` (multi needs an owned `trackId`, single-file rejects one), so the two overlay writers follow one rule and the renderer is never the only barrier. Atomic refusal avoids half-saved lists.
- **Alternatives**: Dropping offending Notes and saving the rest — hides bugs and silently loses user text. Rejected. Enforcing only in the renderer — contradicts the project's two-barrier pattern. Rejected.

## R3. How does `trackId` survive the sanitizer?

- **Decision**: Extend `AudioBookmark` and `sanitizeAudioBookmarks` to keep a non-empty string `trackId` ≤ 100 chars (same rule as `chapterId`) and drop anything else.
- **Rationale**: The sanitizer is a whitelist applied at the IPC boundary and on read; without this the field is erased on the first save (finding 3). Behaviour for inputs without `trackId` is unchanged.
- **Alternatives**: A separate sanitizer for track Notes — duplicates validation and risks drift. Rejected.

## R4. How are track Notes ordered?

- **Decision**: A pure SDK function orders by (track index in the supplied track list, `positionSeconds`, `createdAt`). The store keeps `notes` in this order in multi mode; the sanitizer's own position-only sort is not relied on.
- **Rationale**: Only the renderer knows track order. FR-006.
- **Alternatives**: Persist an order index per Note — redundant and goes stale. Rejected. Sort in Main — Main would need track order on every read for no benefit. Rejected.

## R5. How does a Note jump reach the exact second?

- **Decision**: Same-track jump uses `seekTo` (clamped to the element's duration). Cross-track jump reuses `openTrack` with a new "exact start" option that clamps instead of applying `resolveRestorePosition`.
- **Rationale**: `resolveRestorePosition` deliberately restarts a track when the saved position is within 2 s of the end (right for resuming a finished track, wrong for a Note made in the last seconds). Clamping also covers FR-015 (position beyond the real length).
- **Alternatives**: Changing `resolveRestorePosition` — would alter single-file resume behaviour. Rejected. Seeking after `play()` — races with metadata loading. Rejected.

## R6. Overlapping jumps and stale events

- **Decision**: No new mechanism. A jump to another track goes through `openTrack`, which retires the previous element, bumps `trackSwitch`, and drops events from retired elements. Rapid clicks therefore resolve to the last request, and a late `loadedmetadata` cannot apply a start second to the wrong track (FR-013).
- **Rationale**: This is exactly the problem the element-per-track design was built and tested for (race suite in `spike:audio:store`); adding a second token would duplicate it.
- **Alternatives**: A debounce on Note clicks — adds latency and still needs the token. Rejected.

## R7. What happens when the Note's track cannot be played?

- **Decision**: A Note jump records its origin (track index, position; play state is not restored) from a *settled* state only, in a module-level `pendingJump` bound to the `trackSwitch` token (plan D6). If the target fails for that same token, the store reopens the origin track at the origin position, paused, marks the target track as failed, and shows a notice naming the target. If the fallback also fails, the existing `TrackErrorNotice` state applies. One fallback only. Every non-jump `openTrack` clears `pendingJump`; the target's `loadedmetadata` clears it too. No settled origin ⇒ no fallback.
- **Rationale**: Spec Story 3 #6 and FR-014 say the player must remain usable on the track it was on. Today's behaviour for a failed Contents click (stay on the failed track) does not meet that wording.
- **Alternatives**: Keep today's behaviour and relax the spec (cheaper; offered as open point P-1). Pre-flighting the target file before switching — would need a new IPC probe and still race with the real load. Rejected.

## R8. Visibility of save failures

- **Decision**: For multi-track books the store inspects the result of `audio:saveBookmarks`; on `ok:false` it reloads the list from Main and sets a store notice. Single-file keeps fire-and-forget.
- **Rationale**: Ownership refusal now makes `ok:false` possible; silently showing a Note that was never saved violates FR-020 and SC-005.
- **Alternatives**: Make single-file result-aware too — changes single-file behaviour for no requirement. Rejected.

## R9. Limits and the user message

- **Decision**: Reuse `MAX_AUDIO_BOOKMARKS` (500) and `MAX_NOTE_CHARS` (2000). Multi-track `addNote` refuses at 500 and sets a visible notice; text is capped by the existing `normalizeNoteText` and the textarea `maxLength`.
- **Rationale**: FR-023 says "same limits". Today the 501st single-file Note is silently truncated by the sanitizer; fixing that is outside scope.
- **Alternatives**: Per-track limits — not in the spec. Rejected.

## R10. Timeline markers and "Here"

- **Decision**: Markers and the "Here" highlight consider only Notes whose `trackId` equals the current track's id, compared on the track-relative position. Unknown duration ⇒ no markers (already the behaviour of `noteMarkerFraction`).
- **Rationale**: In multi mode the bar and `positionSeconds` are per track; comparing across tracks would draw wrong markers (FR-009).
- **Alternatives**: Draw other tracks' Notes at their relative position — meaningless. Rejected.

## R11. Add control while unavailable

- **Decision**: Show the control disabled (with a tooltip) rather than hiding it, driven by one derived condition: `status === 'ready' && !switching && current track not in trackErrors`.
- **Rationale**: FR-003 says unavailable, not absent; a stable control avoids layout jumps during track changes. The store's `addNote` re-checks the same condition, so the control is never the only guard.
- **Alternatives**: Hide while unavailable — matches the old multi behaviour but makes the UI flicker on every track change. Rejected.

## R12. Label of a new track Note

- **Decision**: `label` defaults to `Track N · m:ss` (N = 1-based position at creation). The visible track line in the UI is derived live from `trackId` + the current track list, not from the stored label.
- **Rationale**: Track numbering is fixed for the life of the audiobook, but deriving the display from the live list keeps the UI correct if a title is ever edited and avoids trusting stored text.
- **Alternatives**: Store the track title in the Note — duplicates data that can go stale. Rejected.

## R13. Orphaned Notes

- **Decision (revised after the 2026-10-25 review)**: Skipped on read in Main (multi mode), so they never reach the UI or navigation, **and carried over unchanged on every multi-track save**. Read partitions before the 500 cap.
- **Rationale**: The first draft accepted loss. Re-checking `saveBookmarks` showed the stored array is replaced by whatever the renderer sends, and the renderer only ever holds the filtered list, so one ordinary add / edit / delete would have discarded them permanently. Orphans should be rare (tracks are fixed at import), but silently destroying user text is not acceptable when preserving costs a few lines inside the one Main method that already owns the array. FR-024 only requires tolerance; preservation goes slightly beyond it at near-zero scope cost and does not add any user-visible behaviour.
- **Alternatives**: Accept loss (first draft) — rejected, see above. Surface orphans in the UI as "unavailable" Notes with delete — more UI and a new state for a case that should not occur. Rejected. Make the renderer send the stored array verbatim — leaks unreadable entries into the UI layer. Rejected.

## R15. Notes read fails

- **Decision**: In multi-track mode a rejected `audio:getBookmarks` marks Notes unavailable (no add / edit / delete); it is not treated as an empty list. The single-file branch of `load()` is untouched (its `.catch(() => [])` is a pre-existing weakness, out of scope).
- **Rationale**: With whole-array replacement an unread list would overwrite every stored Note on the next save.
- **Alternatives**: Merge-on-save by id in Main — would also defeat intentional deletions. Rejected.

## R14. Where is the pure logic tested?

- **Decision**: New `audio-track-notes.ts` in the SDK with vitest; everything in the renderer that needs a decision calls it, so the JSX stays trivial (the desktop has no component runner).
- **Rationale**: Matches how `audio-tracks.ts` is built and tested.
