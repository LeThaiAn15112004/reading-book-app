# Contract: SDK helpers for track Notes

Location: `source/apps/book-reader-sdk/src/audio/` — extension of `audio-bookmarks.ts` and a new pure module `audio-track-notes.ts`, exported from `audio/index.ts`. Pure TypeScript, no Node / DOM / Electron / React. Signatures are the intended contract; names may be adjusted during implementation if a collision appears, behaviour may not.

## `audio-bookmarks.ts` (extended, backward compatible)

- `AudioBookmark.trackId?: string`.
- `sanitizeAudioBookmarks(raw)`: keeps `trackId` when it is a non-empty string of at most 100 chars, otherwise omits it. For input without `trackId` the output is identical to today's.
- `createAudioBookmark({ …, trackId?: string, trackNumber?: number })`: with `trackId` the note gets that `trackId`, no `chapterId` / `chapterOffsetSeconds`, and a default label `Track N · m:ss`. Without `trackId` the output is identical to today's.

## `audio-track-notes.ts` (new)

```ts
import type { AudioBookmark } from './audio-bookmarks.js'
import type { AudioTrack } from './audio-tracks.js'

/** Notes that name a track in `tracks`, ordered by track index, then positionSeconds, then createdAt. Others are excluded. */
orderTrackNotes(notes: readonly AudioBookmark[], tracks: readonly AudioTrack[]): AudioBookmark[]

/** Notes of one track (current-track markers, "Here" highlight). Unknown track id ⇒ []. */
notesForTrack(notes: readonly AudioBookmark[], trackId: string): AudioBookmark[]

/** "12 · Chapter title" — 1-based number and the live title; null when the Note's track is not in `tracks`. */
trackNoteLabel(note: AudioBookmark, tracks: readonly AudioTrack[]): string | null

/**
 * Where a Note jump goes. null when the Note has no/unknown trackId.
 * seconds = positionSeconds clamped into [0, track duration] when the duration is known, else max(0, positionSeconds).
 * It is NOT subject to the "restart near the end" rule used for resuming.
 */
trackNoteJumpTarget(note: AudioBookmark, tracks: readonly AudioTrack[]): { index: number; seconds: number } | null

/** True while another Note may be added (count < MAX_AUDIO_BOOKMARKS). */
canAddAnotherNote(count: number): boolean
```

## Behavioural guarantees (all covered by vitest)

1. Ordering is total and stable; two Notes at the same second keep creation order.
2. Duplicate track titles are distinguished by the number in `trackNoteLabel`.
3. `trackNoteJumpTarget` handles: same/other track, unknown track, position beyond a known duration (clamped), position within 2 s of the end (kept exactly), unknown duration (kept, floored at 0), negative or non-finite position (0).
4. No function mutates its inputs.
5. Single-file inputs (no `trackId`) are never returned by `orderTrackNotes` / `notesForTrack`.
