# Contract: SDK helper `groupNotesByTrack`

Location: `source/apps/book-reader-sdk/src/audio/audio-track-notes.ts` (existing file), exported from `audio/index.ts`. Pure TypeScript, no Node / DOM / Electron / React. Signatures are the intended contract; names may be adjusted if a collision appears, behaviour may not.

```ts
import type { AudioBookmark } from './audio-bookmarks.js'
import type { AudioTrack } from './audio-tracks.js'

export interface TrackNoteGroup {
  /** The track's id. */
  trackId: string
  /** The track's 0-based position in `tracks` (display number = index + 1). */
  index: number
  /** The track (live title). */
  track: AudioTrack
  /** This track's Notes: by positionSeconds, then createdAt, then input order. Never empty. */
  notes: AudioBookmark[]
  /** notes.length */
  count: number
}

/**
 * One group per track that has at least one Note, in `tracks` order.
 * Notes with no / an unknown `trackId` are in no group. Does not mutate its inputs.
 */
export function groupNotesByTrack(notes: readonly AudioBookmark[], tracks: readonly AudioTrack[]): TrackNoteGroup[]
```

## Behavioural guarantees (all covered by vitest)

1. **Only tracks with Notes**: a track without Notes has no group; no Notes at all → `[]`.
2. **Group order** is the order of `tracks`, regardless of the order of `notes`.
3. **Order inside a group** is `positionSeconds`, then `createdAt`, then input order (two Notes at the same second with the same time keep their input order; same-second Notes with different `createdAt` are in creation order).
4. **`count === notes.length`** and `count ≥ 1`.
5. **Each Note in exactly one group**: the sum of counts equals the number of Notes whose `trackId` is in `tracks`; no id appears twice across groups.
6. **Excluded**: Notes without a `trackId` (single-file Notes) and Notes of a track that is not in `tracks`.
7. **Duplicate track ids** in `tracks`: the first occurrence is the track; Notes go to its group once.
8. **Equal titles** produce separate groups (identity is the id; `index` differs).
9. **No mutation** of `notes`, `tracks` or any element; returned arrays are new.
10. **Scale**: 500 Notes over 68 tracks, and 500 in one track, are grouped in one pass (no quadratic behaviour is required by the tests; the test only asserts correctness on these sizes).
