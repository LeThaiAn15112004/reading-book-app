/**
 * Audio formats the app can play, and the MIME type the app itself sends for each.
 *
 * The MIME is decided here, never taken from the renderer or from the file name, and a format only
 * appears once playback has been verified for it (docs/implementation_plan/audiobook_implementation_plan.md).
 * Today that is MP3 only; other candidates (M4A, M4B, AAC, WAV, FLAC, OGG, Opus, AIFF) stay out
 * until they have been played with real, encoder-made files.
 */
const AUDIO_MIME_BY_FORMAT: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
}

export function isAudioFormat(format: string | null | undefined): boolean {
  return typeof format === 'string' && Object.prototype.hasOwnProperty.call(AUDIO_MIME_BY_FORMAT, format)
}

export function audioMimeForFormat(format: string | null | undefined): string | undefined {
  return isAudioFormat(format) ? AUDIO_MIME_BY_FORMAT[format as string] : undefined
}
