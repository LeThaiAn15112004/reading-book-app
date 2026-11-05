/**
 * Audio formats the app imports, and the MIME type the app itself sends for each.
 *
 * The MIME is decided here, never taken from the renderer or from the file name. A MIME mapping or an
 * extension is NOT evidence that a format plays: `AUDIO_FORMAT_STATUS` records what has actually been
 * shown (docs/implementation_plan/audiobook_implementation_plan.md).
 *
 *  - `verified`    — played, paused, resumed and seeked in the app's Chromium with a real encoder-made file.
 *  - `pending`     — accepted and wired end to end, but not yet played with a real encoder-made file
 *                    (no format is pending today; a new one starts here).
 *  - `unsupported` — the bundled Chromium cannot decode it; recognised only so the import can say why.
 */
export type AudioPlaybackStatus = 'verified' | 'pending' | 'unsupported'

interface AudioFormatInfo {
  readonly mime: string
  readonly status: AudioPlaybackStatus
}

const AUDIO_FORMATS: Readonly<Record<string, AudioFormatInfo>> = {
  mp3: { mime: 'audio/mpeg', status: 'verified' },
  m4a: { mime: 'audio/mp4', status: 'verified' },
  m4b: { mime: 'audio/mp4', status: 'verified' },
  aac: { mime: 'audio/aac', status: 'verified' },
  wav: { mime: 'audio/wav', status: 'verified' },
  flac: { mime: 'audio/flac', status: 'verified' },
  ogg: { mime: 'audio/ogg', status: 'verified' },
  opus: { mime: 'audio/ogg', status: 'verified' },
  aiff: { mime: 'audio/aiff', status: 'unsupported' },
}

/** Extension (with or without dot, any case) → format key. `.aif` is an alias of `aiff`. */
const FORMAT_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp3: 'mp3',
  m4a: 'm4a',
  m4b: 'm4b',
  aac: 'aac',
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'opus',
  aiff: 'aiff',
  aif: 'aiff',
}

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Format key for a file extension (`'.AIF'` → `'aiff'`), or undefined. Recognises unsupported ones too. */
export function audioFormatFromExtension(ext: string | null | undefined): string | undefined {
  if (typeof ext !== 'string') return undefined
  const key = ext.trim().toLowerCase().replace(/^\./, '')
  return has(FORMAT_BY_EXTENSION, key) ? FORMAT_BY_EXTENSION[key] : undefined
}

/** True for an audiobook format the app can import and stream (never `unsupported` ones). */
export function isAudioFormat(format: string | null | undefined): boolean {
  return audioPlaybackStatus(format) !== undefined && audioPlaybackStatus(format) !== 'unsupported'
}

export function audioMimeForFormat(format: string | null | undefined): string | undefined {
  return isAudioFormat(format) ? AUDIO_FORMATS[format as string]?.mime : undefined
}

export function audioPlaybackStatus(format: string | null | undefined): AudioPlaybackStatus | undefined {
  return typeof format === 'string' && has(AUDIO_FORMATS, format) ? AUDIO_FORMATS[format]?.status : undefined
}

/** Every importable audio format key, in a stable order. */
export const AUDIO_FORMAT_KEYS: readonly string[] = Object.keys(AUDIO_FORMATS).filter(
  (k) => AUDIO_FORMATS[k]?.status !== 'unsupported',
)
