export {
  anchorFromLocator,
  chapterAnchorLocation,
  chapterIndexOf,
  hydrateLocator,
  packLocator,
  toNoteLocator,
  unpackLocator,
} from './locator.js'
export {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLOR_PRESETS,
  HIGHLIGHT_TAG_PRESETS,
  isValidHexColor,
  normalizeTags,
  splitHighlightColor,
  withHighlightAlpha,
  type HighlightColorPreset,
} from './colors.js'
export { formatCitation, type CitationInput } from './citation.js'
export {
  applyHistoryStep,
  createUndoHistory,
  type HistoryAction,
  type HistoryStepHandlers,
  type UndoHistory,
} from './history.js'
export {
  collectTags,
  compareAnchors,
  filterMarkups,
  findBookmarksAt,
  findMarkupsOverlapping,
  groupByChapter,
  sortByDocumentOrder,
  type MarkupFilter,
} from './query.js'
