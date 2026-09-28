export {
  DEFAULT_CHARS_PER_CSS_PAGE,
  EpubPaginationTracker,
  buildSectionOffsets,
  calculateCumulativePages,
  estimatePagesFromChars,
  resolveCumulativeTarget,
  type CumulativePageMetrics,
  type TargetPageLocation,
} from './epub-pagination.js'
export {
  PAGINATION_CACHE_RECORD_VERSION,
  buildLayoutFingerprint,
  buildPaginationCacheKey,
  buildPaginationCacheRecord,
  fingerprintEpubBytes,
  isUsablePaginationRecord,
  type EpubPaginationCacheKeyInput,
  type EpubPaginationCacheRecord,
} from './pagination-cache-key.js'
