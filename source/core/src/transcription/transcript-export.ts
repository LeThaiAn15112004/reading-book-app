import { trackKey, type TranscriptPassage } from './transcript-model.js'

/**
 * Plain-text export of a transcript (spec 004, US3). Pure: Main writes the returned string to the file the user chose.
 */

/** A track of a multi-track audiobook, in playback order. */
export interface ExportTrack {
  id: string
  title: string
}

export interface TranscriptExportOptions {
  /** Multi-track audiobook: its tracks in playback order. Omit for a single-file audiobook (no headings). */
  tracks?: readonly ExportTrack[]
  /** Prefix every passage with `[hh:mm:ss]` (the passage start inside its track). Default false. */
  timestamps?: boolean
}

/**
 * The suggested file name of an exported transcript: the audiobook's title made safe for every file system (no path separators or
 * reserved characters, no control characters, no trailing dots or spaces, not a reserved Windows device name), at most 80 characters,
 * plus `.txt`; "transcript.txt" when nothing usable is left. It is only a SUGGESTION: the person picks the real name and place in
 * the save dialog.
 */
export function transcriptExportFileName(title: string | null | undefined): string {
  let name = (title ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what a file name must not contain
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  name = name.slice(0, 80).replace(/[. ]+$/g, '')
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = 'transcript'
  return `${name}.txt`
}

/** `[hh:mm:ss]`, hours not capped (a long audiobook track can pass 99 h only in theory, but never wraps). */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return `[${two(hours)}:${two(minutes)}:${two(seconds)}]`
}

/**
 * The transcript as text, in reading order: tracks in playback order, passages by start time. A multi-track audiobook gets one
 * heading line per track that has passages ("Track 3 — Title") followed by its passages; groups are separated by a blank
 * line. A single-file audiobook is just its passages. Passages of a track that is not in `options.tracks` come last, under a
 * heading with the raw track id, so nothing is silently dropped. Empty input gives an empty string; the text ends with a newline.
 */
export function formatTranscriptText(passages: readonly TranscriptPassage[], options: TranscriptExportOptions = {}): string {
  if (passages.length === 0) return ''
  const stamp = options.timestamps === true
  const line = (p: TranscriptPassage): string => (stamp ? `${formatTimestamp(p.startMs)} ${p.text}` : p.text)
  const byStart = (a: TranscriptPassage, b: TranscriptPassage): number => a.startMs - b.startMs || a.endMs - b.endMs

  const { tracks } = options
  if (!tracks || tracks.length === 0) {
    return `${[...passages].sort(byStart).map(line).join('\n')}\n`
  }

  const groups = new Map<string, TranscriptPassage[]>()
  for (const passage of passages) {
    const key = trackKey(passage.trackId)
    const list = groups.get(key)
    if (list) list.push(passage)
    else groups.set(key, [passage])
  }
  const blocks: string[] = []
  const emit = (heading: string, list: TranscriptPassage[]): void => {
    blocks.push([heading, ...[...list].sort(byStart).map(line)].join('\n'))
  }
  tracks.forEach((track, index) => {
    const list = groups.get(track.id)
    if (list) emit(`Track ${index + 1} — ${track.title}`, list)
    groups.delete(track.id)
  })
  for (const [key, list] of groups) emit(`Track ${key}`, list)
  return `${blocks.join('\n\n')}\n`
}
