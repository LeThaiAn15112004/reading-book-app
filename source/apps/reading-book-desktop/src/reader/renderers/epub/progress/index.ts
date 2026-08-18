export {
  cfiFromLocation,
  displayedPagesFromLocation,
  type EpubDisplayedPages,
  DEFAULT_CHARS_PER_CSS_PAGE,
  EpubPaginationTracker,
  buildSectionOffsets,
  calculateCumulativePages,
  estimatePagesFromChars,
  resolveCumulativeTarget,
  type CumulativePageMetrics,
  type TargetPageLocation,
} from './reader-position'

export {
  buildLayoutFingerprint,
  buildPaginationCacheKey,
  fingerprintEpubBytes,
  readPaginationCache,
  writePaginationCache,
  type EpubPaginationCacheKeyInput,
  type EpubPaginationCacheRecord,
} from './epub-pagination-cache'

