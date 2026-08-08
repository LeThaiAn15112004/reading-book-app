export { parseResumeLocation } from './book/parseResumeLocation'
export { FAKE_CHAPTERS, chapterLocationLabel, type FakeChapter } from './demo/fakeReaderContent'
export {
  usePagePreviewStore,
  type PagePreviewEntry,
  type PreviewRequestPriority,
} from './pagePreview/usePagePreviewStore'
export { FAKE_SIGNATURES } from './demo/fakeSignatures'
export {
  useReaderAnnotations,
  useReaderBookOpen,
  useReaderChromeUi,
  useReaderNavigation,
  useReaderSessionBridge,
  useReaderZoomControls,
  type ReaderChromeAnnotationBridge,
  type ReaderChromeEscapeUi,
  type SelectionMenuState,
} from './hooks'
export { toReadingPrefs } from './prefs/toReadingPrefs'
export { anchorFromSelectionRect } from './selection/selectionAnchor'
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
