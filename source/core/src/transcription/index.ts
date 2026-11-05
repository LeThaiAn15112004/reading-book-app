export {
  MAIN_TRACK_KEY,
  TRANSCRIPTION_ERROR_CODES,
  TRANSCRIPT_STATUSES,
  isTranscriptStatus,
  isTranscriptionErrorCode,
  isValidPassage,
  isValidTimeRange,
  normalisePassageText,
  parseCoveredRanges,
  trackKey,
  type CoveredRanges,
  type TimeRange,
  type TranscriptPassage,
  type TranscriptStatus,
  type TranscriptionErrorCode,
  type TranscriptionScope,
} from './transcript-model.js'
export { dropSupersededPassages, isCovered, mergeRanges, subtractRanges, totalRangeMs } from './range-merge.js'
export {
  TRANSCRIPTION_WINDOW_MS,
  TRANSCRIPTION_WINDOW_OVERLAP_MS,
  planWindows,
  type DecodeWindow,
  type WindowPlanOptions,
} from './window-plan.js'
export { findActivePassage, findActivePassageIndex, type PlaybackPoint } from './active-passage.js'
export {
  formatTimestamp,
  formatTranscriptText,
  transcriptExportFileName,
  type ExportTrack,
  type TranscriptExportOptions,
} from './transcript-export.js'
export {
  AUTO_LANGUAGE,
  WHISPER_LANGUAGES,
  isSupportedTranscriptionLanguage,
  resolveDefaultTranscriptionLanguage,
  whisperLanguageForTag,
  type TranscriptionLanguage,
} from './languages.js'
