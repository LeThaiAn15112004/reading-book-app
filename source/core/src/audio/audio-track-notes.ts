import { MAX_AUDIO_BOOKMARKS, type AudioBookmark } from './audio-bookmarks.js'
import { clampSeekPosition } from './audio-playback.js'
import type { AudioTrack } from './audio-tracks.js'

/**
 * Notes of a multi-track audiobook: the platform-free decisions (ordering, label, jump target, cap).
 * A track Note carries `trackId`, and its `positionSeconds` is seconds INSIDE that track. Single-file Notes
 * (no `trackId`) are never touched by these functions. No function mutates its inputs.
 */

function trackIndexById(tracks: readonly AudioTrack[]): Map<string, number> {
  const byId = new Map<string, number>()
  tracks.forEach((track, index) => {
    if (!byId.has(track.id)) byId.set(track.id, index)
  })
  return byId
}

/**
 * Notes that name a track in `tracks`, ordered by track index, then `positionSeconds`, then `createdAt`.
 * Notes without a `trackId` or with an unknown one are excluded. The order is stable: Notes that tie on all
 * three keep their input order.
 */
export function orderTrackNotes(notes: readonly AudioBookmark[], tracks: readonly AudioTrack[]): AudioBookmark[] {
  const byId = trackIndexById(tracks)
  const keyed: { note: AudioBookmark; index: number }[] = []
  for (const note of notes) {
    const index = note.trackId === undefined ? undefined : byId.get(note.trackId)
    if (index !== undefined) keyed.push({ note, index })
  }
  keyed.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    if (a.note.positionSeconds !== b.note.positionSeconds) return a.note.positionSeconds - b.note.positionSeconds
    if (a.note.createdAt === b.note.createdAt) return 0
    return a.note.createdAt < b.note.createdAt ? -1 : 1
  })
  return keyed.map((k) => k.note)
}

/** One row of the grouped Notes tab: a track that has Notes, and those Notes. */
export interface TrackNoteGroup {
  /** The track's id. */
  trackId: string
  /** The track's 0-based position in `tracks` (the number shown is `index + 1`). */
  index: number
  /** The track (live title). */
  track: AudioTrack
  /** This track's Notes: by `positionSeconds`, then `createdAt`, then input order. Never empty. */
  notes: AudioBookmark[]
  /** `notes.length`. */
  count: number
}

/**
 * One group per track that has at least one Note, in `tracks` order; Notes inside a group in time order.
 * Notes with no / an unknown `trackId` are in no group. A repeated track id in `tracks` counts once (the first). Does not
 * mutate its inputs.
 */
export function groupNotesByTrack(notes: readonly AudioBookmark[], tracks: readonly AudioTrack[]): TrackNoteGroup[] {
  const byId = trackIndexById(tracks)
  const groups = new Map<number, TrackNoteGroup>()
  for (const note of orderTrackNotes(notes, tracks)) {
    const index = byId.get(note.trackId as string) as number
    let group = groups.get(index)
    if (!group) {
      const track = tracks[index] as AudioTrack
      group = { trackId: track.id, index, track, notes: [], count: 0 }
      groups.set(index, group)
    }
    group.notes.push(note)
    group.count += 1
  }
  // `orderTrackNotes` already sorted by track index, so insertion order is the track order.
  return [...groups.values()]
}

/** Notes of one track (current-track markers, "Here" highlight). An unknown or empty track id gives `[]`. */
export function notesForTrack(notes: readonly AudioBookmark[], trackId: string): AudioBookmark[] {
  if (!trackId) return []
  return notes.filter((note) => note.trackId === trackId)
}

/** "12 · Track title": the 1-based track number and the live title; `null` when the Note's track is not in `tracks`. */
export function trackNoteLabel(note: AudioBookmark, tracks: readonly AudioTrack[]): string | null {
  if (note.trackId === undefined) return null
  const index = trackIndexById(tracks).get(note.trackId)
  if (index === undefined) return null
  const track = tracks[index] as AudioTrack
  return `${index + 1} · ${track.title}`
}

/**
 * Where a Note jump goes; `null` when the Note has no / an unknown `trackId`.
 * `seconds` is `positionSeconds` clamped into [0, track duration] when the duration is known, otherwise
 * max(0, position) (a negative or non-finite position gives 0). It is NOT subject to the "restart near the end"
 * rule used when resuming a track: a Note made in the last seconds lands exactly there.
 */
export function trackNoteJumpTarget(note: AudioBookmark, tracks: readonly AudioTrack[]): { index: number; seconds: number } | null {
  if (note.trackId === undefined) return null
  const index = trackIndexById(tracks).get(note.trackId)
  if (index === undefined) return null
  const track = tracks[index] as AudioTrack
  return { index, seconds: clampSeekPosition(note.positionSeconds, track.durationSeconds) }
}

/** True while another Note may be added (`count < MAX_AUDIO_BOOKMARKS`). */
export function canAddAnotherNote(count: number): boolean {
  return Number.isFinite(count) && count < MAX_AUDIO_BOOKMARKS
}
