# Data Model: Notes for Multi-Track Audiobooks

No schema change and no migration. All data already exists except one optional field on a JSON entry.

## Entities

### Audiobook (multi-track) — existing
`books` row + ordered `book_audio_chapters` rows (migration 028). It is multi-track **iff** it has chapter rows. `books.reading_state_json` holds, among other keys, `audioProgress` and `audioBookmarks`.

### Track — existing (`book_audio_chapters`)
| Field | Meaning | Used by this feature |
|---|---|---|
| `id` | UUID, stable for the life of the book | the `trackId` stored in a Note |
| `book_id` | parent | ownership check |
| `position` | 0-based playback order | display order of the Notes list |
| `title` | tag title or file stem | shown in Notes |
| `duration_seconds` | may be NULL | limits only marker drawing and clamping |

Tracks are never added, removed or reordered after import, so a stored `trackId` stays valid for the life of the audiobook.

### Note (`AudioBookmark`) — one optional field added

| Field | Single-file Note (unchanged) | Track Note (new use) |
|---|---|---|
| `id` | unique id, ≤ 100 chars | same |
| `label` | text, ≤ 200 chars | same; default `Track N · m:ss` |
| `positionSeconds` | seconds from the start of the file | **seconds inside the Note's track** |
| `note` | optional text, trimmed, ≤ 2000 chars | same |
| `chapterId`, `chapterOffsetSeconds` | embedded-chapter reference, optional | **never set** |
| `createdAt` | ISO string | same |
| **`trackId`** | **absent; a save carrying it is refused** | **required; must be a `book_audio_chapters.id` of this book** |

Stored as an element of `reading_state_json.audioBookmarks` (array, replaced as a whole on every save). Maximum 500 per audiobook.

### Note list
The whole array for one audiobook. Display order (computed, not stored): track `position`, then `positionSeconds`, then `createdAt`.

## Validation rules

1. `trackId`: non-empty string, ≤ 100 chars, otherwise the field is dropped by the sanitizer (same rule as `chapterId`).
2. `positionSeconds`: finite, 0 ≤ value ≤ 10 000 000 (existing rule). At creation it is `clampSeekPosition(currentTime, duration)`.
3. **Save, multi-track book**: every *incoming* Note must have an owned `trackId`; otherwise the entire save is refused (`ok:false`) and the stored list is unchanged. On success the stored array becomes `incoming + preserved foreign entries` (rule 5b).
4. **Save, single-file book**: no Note may have a `trackId`; otherwise refused. The stored array is replaced by the incoming one, as today.
5. **Read, multi-track book**: the raw stored array is partitioned first; entries whose `trackId` is missing or not owned by the book ("foreign entries") are skipped, then the owned ones are sanitized and capped at 500. Foreign entries therefore never occupy one of the 500 visible slots. **Read, single-file**: output as today.
5b. **Foreign entries are preserved on save (multi-track only)**: Main partitions the RAW stored array into owned and foreign entries (missing or unowned `trackId`) **before sanitizing either set**, sanitizes the foreign set independently (its own cap of 500, so it is never cut because the combined array exceeds 500), and writes it back after the incoming Notes. "Preserved" means preserved after sanitization (canonical form), not byte-identical raw JSON. They are never shown, never sent to the renderer, never navigated to, and are removed only by deleting the audiobook. If an incoming id equals a foreign entry's id, the incoming Note wins and the foreign duplicate is dropped. The stored array is bounded (visible ≤ 500, foreign ≤ 500).
5c. **Unavailable Notes (renderer, multi-track)**: if the read fails, Notes stay unavailable and no save is issued, so an unread list can never overwrite stored Notes.
6. Count ≤ 500 (`MAX_AUDIO_BOOKMARKS`); text ≤ 2000 (`MAX_NOTE_CHARS`). **At the Main boundary, multi-track**: the cap is checked on the RAW incoming array (before `sanitizeAudioBookmarks`, which would silently keep only the first 500 in input order). Raw length > 500 ⇒ the whole save is refused (`ok:false`, nothing written, nothing truncated, nothing deleted); ≤ 500 ⇒ saved in full. Preserved foreign entries (rule 5b) do not count toward the 500, so the stored array may hold up to 500 owned + the carried foreign entries. **Single-file**: unchanged — the sanitizer keeps the first 500 in input order and drops the rest silently (FR-027). The renderer already refuses to create the 501st Note (D4), so the Main refusal is a second barrier that only a faulty caller can reach.
7. A save never writes any key other than `audioBookmarks` (and `updated_at`); `audioProgress`, location, typography and unknown keys are preserved by `json_patch`.

## Relationships

- Audiobook 1 — N Tracks (existing, fixed at import).
- Audiobook 1 — N Notes (JSON array on the same row).
- Track 1 — N Notes (by `trackId`); a Note has exactly one track.
- Deleting the audiobook deletes the row and therefore its Notes; chapter rows cascade.

## State transitions (renderer, `audioPlayerStore`)

```text
Note creation
  precondition: status=ready ∧ ¬switching ∧ current track ∉ trackErrors ∧ notes.length < 500
  effect: notes' = order(notes ∪ {new Note(trackId=current, position=clamp(currentTime))}); save
  save result ok:false ⇒ reload notes from Main + notice

Note jump (note n)
  target = (index of n.trackId, clamp(n.positionSeconds, track duration))
  target.index = current ∧ settled (¬switching ∧ current ∉ trackErrors)  ⇒ seek only
  else ⇒ origin = settled ? (current track, currentTime) : (pendingJump?.origin | none)
          save old track (only if settled) → openTrack(target.index, exact start, keep play state, jump={origin})
          pendingJump = {token = trackSwitch, origin}
          target loadedmetadata ⇒ pendingJump = null (done)
          target fails ∧ pendingJump.token = trackSwitch ∧ origin ⇒ pendingJump = null;
                mark target failed; openTrack(origin, origin position, paused, no jump); noteNotice
          target fails ∧ no origin ⇒ standard TrackErrorNotice state (no fallback)
          origin fails too ⇒ standard TrackErrorNotice state (no second fallback)
  any other openTrack (Contents click, prev/next, auto-advance, another jump) bumps trackSwitch and sets pendingJump to
  null/its own, so an older jump can neither fall back nor apply its second afterwards

Edit / delete
  notes' = list with the text replaced / the Note removed; save; playback untouched
```

## Compatibility

- Existing single-file Notes: no field changes, same key, same ordering by position.
- Existing multi-track books: have no Notes today (blocked since import), so nothing to convert.
- Older app builds: return `[]` / refuse for multi-track books and ignore `trackId` elsewhere.
