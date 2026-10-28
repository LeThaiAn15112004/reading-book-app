# Data Model: Notes Grouped by Track

**No stored data changes.** No schema change, no migration, no new key in `reading_state_json`, no `localStorage` key. Everything below is derived at display time or kept in memory for the current session.

## Existing entities (unchanged)

- **Audiobook (multi-track)** — `books` row + ordered `book_audio_chapters`. Owns its tracks and its Notes.
- **Track** — `AudioTrack { id, title, durationSeconds | null }`, in playback order. "Chapter" in the request means Track.
- **Note** — `AudioBookmark` with `trackId`; `positionSeconds` is seconds inside its track. Stored in `reading_state_json.audioBookmarks`; limits (500 Notes, 2 000 characters) unchanged. See feature 001's [data-model](../001-multi-track-audiobook-notes/data-model.md).

## New derived entity: Track group (not stored)

One per track that has at least one Note. Computed by `groupNotesByTrack(notes, tracks)`.

| Field | Meaning |
|---|---|
| `trackId` | the track's id |
| `index` | the track's 0-based position in the playback order (the row number shown is `index + 1`) |
| `track` | the `AudioTrack` (live title) |
| `notes` | the track's Notes, ordered by `positionSeconds`, then `createdAt`, then input order |
| `count` | `notes.length` |

### Rules

1. A group exists iff its track has ≥ 1 Note; a track without Notes has no group (FR-001).
2. Groups are ordered by `index` (FR-002). Two tracks with the same title are two groups; the number tells them apart.
3. Every Note whose `trackId` names a track in `tracks` appears in exactly one group. Notes with no `trackId` or an unknown one appear in none (they are not shown today either — Main does not return them).
4. If `tracks` lists the same id twice, the first occurrence defines the track (same rule as `orderTrackNotes`).
5. Pure and non-mutating: inputs are never changed; the result is recomputed whenever `notes` or `tracks` change, so counts and rows follow add, edit and delete at once (FR-012).

Invariant (tested): `sum(group.count) === number of Notes whose track is in tracks` and each Note id occurs once across all groups.

## New in-memory entity: Row state (not stored)

Held by `audioNoteGroupsStore` for the audiobook that is currently open.

| Field | Meaning |
|---|---|
| `open` | set of track ids whose row is open (`Record<trackId, true>`) |
| `seeded` | whether the default has been applied for this audiobook |

### State transitions

```text
player bookId changes (load another book, dispose, reopen the same one)
  ⇒ open = {}, seeded = false                                   (FR-016: nothing carried over)

Notes tab (multi-track) is shown ⇒ ensureSeeded(currentTrackId)
  if seeded: nothing
  else:      seeded = true; open[currentTrackId] = true          (FR-009; only adds, never closes)

toggle(trackId)
  open[trackId] ⇒ closed, or closed ⇒ open; other rows untouched (FR-005, FR-006)

player.lastAddedNote changes to { id, trackId }  (multi-track addNote only)
  ⇒ open[trackId] = true                                         (FR-013)

track changes (Contents, previous/next, auto-advance, Note jump, jump fallback)
  ⇒ no transition                                                (FR-015)

Note edited / deleted / list reloaded / Notes unavailable
  ⇒ no transition (rows come and go with the derived groups)
```

Closing the Notes tab or the sidebar does not touch this state (FR-016).

## New field in the player store: `lastAddedNote`

| Field | Meaning |
|---|---|
| `lastAddedNote` | `{ id: string, trackId: string } | null` — the Note most recently added by `addNote` in a multi-track audiobook; a **new object on every add**; `null` initially, after `load`, and for single-file audiobooks. Not stored; it only tells the groups store which row to open. |

## Relationships

- Audiobook 1 — N Tracks; Track 1 — N Notes (unchanged).
- Track group 0..1 per Track (exists iff the track has Notes); a Note belongs to exactly one group.
- Row state 0..1 per Track group, in memory, for the current audiobook only.
