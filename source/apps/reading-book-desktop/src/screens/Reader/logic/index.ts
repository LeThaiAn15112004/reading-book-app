export { parseResumeLocation } from './book/parseResumeLocation'
export { highlightPopoverPosition } from '@reading-book/book-reader-sdk'
export { useDismissOnOutsideOrEscape } from './highlights/useDismissOnOutsideOrEscape'
export { FAKE_CHAPTERS, chapterLocationLabel, type FakeChapter } from './demo/fakeReaderContent'
export {
  useBookIndexing,
  useBookRelink,
  useReaderBookmarks,
  useReaderHighlights,
  useReaderBookOpen,
  useReaderChromeUi,
  useReaderNavigation,
  useReaderSearch,
  useReaderSessionBridge,
  useReaderFullscreen,
  useImmersiveChromeReveal,
  useReaderZoomControls,
  useSnapshotTool,
  useWordCount,
  useReadAloud,
  useReaderTranslation,
  type HighlightShortcuts,
  type ReaderChromeEscapeUi,
  type SnapshotRect,
} from './hooks'
export { type WordCountStats, type WordCountStatus } from './wordCount/wordCountStore'
export { READ_ALOUD_RATES, type ReadAloudStatus } from './readAloud/readAloudStore'
export { useRightPanelStore, type RightPanelId } from './rightPanel/rightPanelStore'
export { useDraggableWordCountPanel } from './wordCount/useDraggableWordCountPanel'
export { useResizableWordCountPanel } from './wordCount/useResizableWordCountPanel'
export {
  useBookSearchStore,
  type BookSearchStatus,
  type SearchPanelPosition,
} from './search/bookSearchStore'
export { useDraggableSearchPanel } from './search/useDraggableSearchPanel'
export { useResizableSearchPanel } from './search/useResizableSearchPanel'
export { useDraggableTranslationPanel } from './translation/useDraggableTranslationPanel'
export { useResizableTranslationPanel } from './translation/useResizableTranslationPanel'
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
