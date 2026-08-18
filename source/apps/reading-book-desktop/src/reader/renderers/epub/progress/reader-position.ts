export type EpubDisplayedPages = {
  page: number
  total: number
}

type EpubjsLocationLike = {
  start?: {
    index?: number
    cfi?: string
    displayed?: { page?: number; total?: number }
  }
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback
}

export function displayedPagesFromLocation(
  location: unknown,
): EpubDisplayedPages {
  const start = (location as EpubjsLocationLike | undefined)?.start?.displayed
  return {
    page: positiveInt(start?.page, 1),
    total: positiveInt(start?.total, 1),
  }
}

export function cfiFromLocation(location: unknown): string {
  const cfi = (location as EpubjsLocationLike | undefined)?.start?.cfi
  return typeof cfi === 'string' ? cfi.trim() : ''
}

export {
  DEFAULT_CHARS_PER_CSS_PAGE,
  EpubPaginationTracker,
  buildSectionOffsets,
  calculateCumulativePages,
  estimatePagesFromChars,
  resolveCumulativeTarget,
  type CumulativePageMetrics,
  type TargetPageLocation,
} from './epub-pagination'

