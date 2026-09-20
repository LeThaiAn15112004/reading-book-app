export { parseResumeLocation } from './book/parseResumeLocation'
export { highlightPopoverPosition } from './highlights/highlightPopoverPosition'
export { useDismissOnOutsideOrEscape } from './highlights/useDismissOnOutsideOrEscape'
export { FAKE_CHAPTERS, chapterLocationLabel, type FakeChapter } from './demo/fakeReaderContent'
export { FAKE_SIGNATURES } from './demo/fakeSignatures'
export {
  useBookIndexing,
  useReaderBookmarks,
  useReaderHighlights,
  useReaderBookOpen,
  useReaderChromeUi,
  useReaderNavigation,
  useReaderSessionBridge,
  useReaderFullscreen,
  useImmersiveChromeReveal,
  useReaderZoomControls,
  type HighlightShortcuts,
  type ReaderChromeEscapeUi,
} from './hooks'
export { fromReadingPrefs, toReadingPrefs } from './prefs/toReadingPrefs'
export {
  flushRegisteredSession,
  registerSessionFlushHandler,
} from './session/sessionFlushRegistry'
export {
  useReadingSessionAutosave,
  type SessionLatestSnapshot,
  type SessionNavMeta,
  type SessionThemeFields,
} from './session/useReadingSessionAutosave'
export {
  ZOOM_DEFAULT,
  ZOOM_LAYOUT_PRESETS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_PERCENT_PRESETS,
  ZOOM_STEP_FACTOR,
  clampZoom,
  formatZoomPercent,
  parseZoomPercentInput,
  scrollAfterFocalZoom,
  stepZoom,
  zoomFactorFromWheelDelta,
  zoomForLayoutPreset,
  zoomFromPercent,
  zoomToPercent,
  type FitMetrics,
  type ZoomFocalPoint,
  type ZoomLayoutPreset,
} from './zoom/readerZoom'
