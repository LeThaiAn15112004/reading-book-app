export type { BookSession } from './book-session.js'
export {
  bookmarkDtoToReaderBookmark,
  chapterIndexFromLocatorRef,
  findReaderBookmarksAtLocation,
  packBookmarkLocator,
  parseBookmarkLocation,
  readerBookmarkJumpLocation,
  readerBookmarkMatchesLocation,
  resolveCurrentBookmarkLocation,
  type ReaderBookmark,
} from './bookmark-location.js'
export type { CollectionSummary } from './collection-summary.js'
export {
  formatHighlightCitation,
  type HighlightCitationInput,
} from './highlight-citation.js'
// `highlight-colors.js` duplicates `annotations/colors.js` (same names, same values) — not
// re-exported here to avoid an ambiguous duplicate export; import it directly if ever needed.
export {
  createHighlightHistory,
  highlightAdd,
  highlightRemove,
  highlightReplace,
  type HighlightAction,
  type HighlightHistory,
} from './highlight-history.js'
export {
  highlightDtoToReaderHighlight,
  packHighlightLocator,
  packSelectionTextRef,
  parseSelectionTextRef,
  type ReaderHighlight,
} from './highlight-location.js'
export {
  applyHighlightHistoryStep,
  type HighlightUndoHandlers,
} from './highlight-undo.js'
export type {
  ImportClientResult,
  ImportErrorCode,
  ImportToastVariant,
} from './import-client.js'
export {
  NAV_FILTERS,
  filterByNav,
  filterByShelf,
  formatFileSizeMb,
  formatRelativeLastRead,
  mapBookSummary,
  matchesSearch,
  pickContinueReading,
  type BookSummaryInput,
  type LibraryBook,
  type LibraryReadingStatus,
  type NavFilterId,
  type ShelfId,
} from './library-book.js'
export {
  type InteractionTool,
  type PageLayout,
  type ViewportRect,
} from './reader-session.js'
export {
  DEFAULT_GLOBAL_READING_PREFS,
  GLOBAL_READING_PREFS_STORAGE_KEY,
  READER_THEME_PRESETS,
  fontFamilyCss,
  isFontFamily,
  isFontWeight,
  isReaderTheme,
  isReadingViewMode,
  isTextAlign,
  normalizeGlobalReadingPrefs,
  parseGlobalReadingPrefsJson,
  resolveReadingPrefs,
  toAppThemeAttr,
  type AppChromeTheme,
  type FontFamily,
  type FontWeight,
  type GlobalReadingPrefs,
  type ReaderTheme,
  type ReadingLayout,
  type ReadingMarginPreset,
  type ReadingPreferenceOverrides,
  type ReadingViewMode,
  type ResolvedReadingPrefs,
  type TextAlign,
} from './reading-prefs.js'
export {
  READING_FONT_SIZE_MAX,
  READING_FONT_SIZE_MIN,
  clampReadingFontSize,
  parseReadingLayoutMode,
  readingPrefsFromGlobal,
  readingPrefsFromSession,
  type ReadingSessionPrefsFields,
} from './reading-session-prefs.js'
export {
  formatLastReadLine,
  shelfProgressForBook,
  type ShelfProgressView,
} from './shelf-progress.js'
