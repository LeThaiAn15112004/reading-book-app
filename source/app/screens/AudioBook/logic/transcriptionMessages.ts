/** Plain-language text for a transcription error code (FR-014): what happened and what the person can do about it. */
export function transcriptionErrorText(code: string | undefined, detail?: string): string {
  switch (code) {
    case 'MODEL_MISSING':
      return 'The speech model is not downloaded yet. Download it first.'
    case 'DISK_FULL':
      return 'There is not enough free disk space for the speech model. Free some space and try again.'
    case 'FILE_MISSING':
      return 'The audio file is missing or cannot be read. Locate the file or add the audiobook again.'
    case 'UNSUPPORTED_LANGUAGE':
      return 'That language is not supported. Choose another language or Auto-detect.'
    case 'NO_SPEECH':
      return 'No speech was found in this audio.'
    case 'DECODE_FAILED':
      return `The audio could not be processed. It may be damaged, or the audio decoder is not available on this system.${detail ? ` (${detail})` : ''}`
    case 'INTEGRITY_FAILED':
      return 'The speech model files failed their integrity check, so they were not used. Download the model again.'
    case 'INVALID_ARGUMENT':
      return detail ? `That request is not valid: ${detail}` : 'That request is not valid.'
    case 'FEATURE_DISABLED':
      return 'Audiobook transcription is not available in this version of the app yet.'
    case 'ABORTED':
      return 'Transcription was cancelled.'
    case 'INTERRUPTED':
      return 'Transcription was interrupted when the app closed. Resume to continue where it stopped.'
    default:
      return detail || 'Transcription failed.'
  }
}

/** Plain-language text for why the bundled audio decoder cannot run (`TranscriptionDecoderStatusDto.reason`). */
export function decoderUnavailableText(reason: string | undefined): string {
  switch (reason) {
    case 'UNSUPPORTED_PLATFORM':
      return 'Transcription is not available on this operating system or processor yet.'
    case 'NOT_BUNDLED':
      return 'The audio decoder that comes with Readmate is missing from this installation. Reinstall Readmate to restore it.'
    case 'INTEGRITY_FAILED':
      return 'The audio decoder that comes with Readmate failed its integrity check, so it was not run. Reinstall Readmate to restore it.'
    case 'NOT_RUNNABLE':
      return 'The audio decoder that comes with Readmate could not start on this system. Security software may have blocked it; reinstall Readmate or allow it, then try again.'
    default:
      return transcriptionErrorText('DECODE_FAILED', reason)
  }
}

/** "123 MB" / "1.4 GB" for a model download size. */
export function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}

/** `m:ss` or `h:mm:ss` for a position inside a track, from milliseconds. */
export function formatPassageTime(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}
