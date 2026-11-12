import { getFormat, getT } from '../../../i18n'

/**
 * Plain-language text for a transcription error code (FR-014): what happened and what the person can do about it.
 * Built when rendered, in the current interface language (spec 012).
 */
export function transcriptionErrorText(code: string | undefined, detail?: string): string {
  const t = getT()
  switch (code) {
    case 'MODEL_MISSING':
      return t('audiobook.transcription.errors.modelMissing')
    case 'DISK_FULL':
      return t('audiobook.transcription.errors.diskFull')
    case 'FILE_MISSING':
      return t('audiobook.transcription.errors.fileMissing')
    case 'UNSUPPORTED_LANGUAGE':
      return t('audiobook.transcription.errors.unsupportedLanguage')
    case 'NO_SPEECH':
      return t('audiobook.transcription.errors.noSpeech')
    case 'DECODE_FAILED':
      return detail
        ? t('audiobook.transcription.errors.decodeFailedDetail', { detail })
        : t('audiobook.transcription.errors.decodeFailed')
    case 'INTEGRITY_FAILED':
      return t('audiobook.transcription.errors.integrityFailed')
    case 'INVALID_ARGUMENT':
      return detail ? t('audiobook.transcription.errors.invalidDetail', { detail }) : t('audiobook.transcription.errors.invalid')
    case 'FEATURE_DISABLED':
      return t('audiobook.transcription.errors.featureDisabled')
    case 'ABORTED':
      return t('audiobook.transcription.errors.aborted')
    case 'INTERRUPTED':
      return t('audiobook.transcription.errors.interrupted')
    default:
      return detail || t('audiobook.transcription.errors.generic')
  }
}

/** Plain-language text for why the bundled audio decoder cannot run (the decoder status reason). */
export function decoderUnavailableText(reason: string | undefined): string {
  const t = getT()
  switch (reason) {
    case 'UNSUPPORTED_PLATFORM':
      return t('audiobook.transcription.decoder.unsupportedPlatform')
    case 'NOT_BUNDLED':
      return t('audiobook.transcription.decoder.notBundled')
    case 'INTEGRITY_FAILED':
      return t('audiobook.transcription.decoder.integrityFailed')
    case 'NOT_RUNNABLE':
      return t('audiobook.transcription.decoder.notRunnable')
    default:
      return transcriptionErrorText('DECODE_FAILED', reason)
  }
}

/** A model download size in the interface language ("123 MB" / "1,4 GB"). */
export function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return getFormat().bytes(0)
  return getFormat().bytes(bytes)
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
