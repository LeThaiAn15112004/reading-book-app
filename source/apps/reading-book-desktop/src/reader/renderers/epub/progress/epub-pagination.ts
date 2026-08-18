/**
 * CSS-driven pagination calculation for EPUB readers.
 *
 * In paginated mode, EPUB pages are determined by the CSS multi-column layout
 * inside each spine section (`displayed.page` and `displayed.total`).
 *
 * Cumulative page count is:
 *   pageCurrent = sum(P[0] ... P[s-1]) + sectionPage
 *   pageTotal   = sum(P[0] ... P[N-1])
 *
 * Exact section page counts come from a hidden full-spine measurement (or an
 * IndexedDB cache of that measurement). Until every section is exact,
 * `pageCountReady` stays false so the footer does not treat estimates as final.
 */

export const DEFAULT_CHARS_PER_CSS_PAGE = 1200

export type CumulativePageMetrics = {
  pageCurrent: number
  pageTotal: number
  progress: number
  percentage: number
  pageCountReady: boolean
}

export type TargetPageLocation = {
  spineIndex: number
  sectionPage: number
}

/**
 * Calculate cumulative page numbers from an array of section page counts.
 */
export function calculateCumulativePages(
  sectionPages: number[],
  currentSpineIndex: number,
  currentSectionPage = 1,
  pageCountReady = true,
): CumulativePageMetrics {
  const n = sectionPages.length
  if (n === 0) {
    return {
      pageCurrent: 1,
      pageTotal: 1,
      progress: 0,
      percentage: 0,
      pageCountReady,
    }
  }

  const clampedSpine = Math.min(Math.max(currentSpineIndex, 0), n - 1)
  const currentSectionTotal = Math.max(1, sectionPages[clampedSpine] || 1)
  const clampedSectionPage = Math.min(
    Math.max(currentSectionPage, 1),
    currentSectionTotal,
  )

  let precedingSum = 0
  for (let i = 0; i < clampedSpine; i += 1) {
    precedingSum += Math.max(1, sectionPages[i] || 1)
  }

  let totalSum = precedingSum
  for (let i = clampedSpine; i < n; i += 1) {
    totalSum += Math.max(1, sectionPages[i] || 1)
  }

  const pageCurrent = precedingSum + clampedSectionPage
  const pageTotal = Math.max(1, totalSum)

  const progress =
    pageTotal > 1
      ? Math.min(1, Math.max(0, (pageCurrent - 1) / (pageTotal - 1)))
      : 0

  return {
    pageCurrent,
    pageTotal,
    progress,
    percentage: progress,
    pageCountReady,
  }
}

/**
 * Resolve a 1-based cumulative page number back to its (spineIndex, sectionPage).
 */
export function resolveCumulativeTarget(
  sectionPages: number[],
  targetPage: number,
): TargetPageLocation {
  const n = sectionPages.length
  if (n === 0) {
    return { spineIndex: 0, sectionPage: 1 }
  }

  let total = 0
  for (let i = 0; i < n; i += 1) {
    total += Math.max(1, sectionPages[i] || 1)
  }

  const clampedTarget = Math.min(Math.max(Math.round(targetPage), 1), Math.max(1, total))

  let accumulated = 0
  for (let i = 0; i < n; i += 1) {
    const count = Math.max(1, sectionPages[i] || 1)
    if (accumulated + count >= clampedTarget) {
      return {
        spineIndex: i,
        sectionPage: clampedTarget - accumulated,
      }
    }
    accumulated += count
  }

  return {
    spineIndex: n - 1,
    sectionPage: Math.max(1, sectionPages[n - 1] || 1),
  }
}

/**
 * Prefix sums for 1-based pageCurrent = offsets[spine] + sectionPage.
 */
export function buildSectionOffsets(sectionPages: number[]): number[] {
  const offsets = new Array(sectionPages.length).fill(0)
  let sum = 0
  for (let i = 0; i < sectionPages.length; i += 1) {
    offsets[i] = sum
    sum += Math.max(1, sectionPages[i] || 1)
  }
  return offsets
}

/**
 * Estimate section pages from raw character length.
 */
export function estimatePagesFromChars(
  charCount: number,
  charsPerPage = DEFAULT_CHARS_PER_CSS_PAGE,
): number {
  if (charCount <= 0) return 1
  return Math.max(1, Math.round(charCount / Math.max(100, charsPerPage)))
}

export class EpubPaginationTracker {
  private spineLength: number
  private sectionPages: number[]
  private sectionExact: boolean[]
  private sectionCharCounts: number[]
  private charsPerPage: number
  private isCalibrated = false
  private charScanApplied = false

  constructor(spineLength: number) {
    this.spineLength = Math.max(0, spineLength)
    this.sectionPages = new Array(this.spineLength).fill(1)
    this.sectionExact = new Array(this.spineLength).fill(false)
    this.sectionCharCounts = new Array(this.spineLength).fill(0)
    this.charsPerPage = DEFAULT_CHARS_PER_CSS_PAGE
  }

  getSpineLength(): number {
    return this.spineLength
  }

  isReady(): boolean {
    return this.isFullyMeasured()
  }

  isFullyMeasured(): boolean {
    return (
      this.spineLength === 0 ||
      this.sectionExact.every((exact) => exact)
    )
  }

  /**
   * Set scanned character counts for all spine sections to produce initial page estimates.
   * Applied once; later calls must not rewrite the frozen unmeasured snapshot.
   */
  initCharCounts(charCounts: number[]): void {
    const len = Math.min(this.spineLength, charCounts.length)
    for (let i = 0; i < len; i += 1) {
      this.sectionCharCounts[i] = Math.max(0, charCounts[i] || 0)
    }
    if (!this.charScanApplied) {
      this.applyEstimatesToUnmeasured()
      this.charScanApplied = true
    }
  }

  /**
   * Hydrate every spine section from a cached / hidden full-book measurement.
   * Marks all sections exact so `pageCountReady` becomes true immediately.
   */
  hydrateExactSectionPages(sectionPages: number[]): void {
    const len = Math.min(this.spineLength, sectionPages.length)
    for (let i = 0; i < len; i += 1) {
      this.sectionPages[i] = Math.max(1, Math.floor(sectionPages[i] || 1))
      this.sectionExact[i] = true
    }
    for (let i = len; i < this.spineLength; i += 1) {
      this.sectionPages[i] = Math.max(1, this.sectionPages[i] || 1)
      this.sectionExact[i] = true
    }
    this.isCalibrated = true
  }

  /**
   * Lock in the exact rendered CSS page count for a spine section (`displayed.total`).
   *
   * Used while a live section is on-screen so current-section page turns stay
   * 1:1 accurate even before the full-book measurement finishes.
   */
  updateSectionPage(spineIndex: number, displayedTotal: number): void {
    if (spineIndex < 0 || spineIndex >= this.spineLength) return
    const total = Math.max(1, Math.floor(displayedTotal))
    this.sectionPages[spineIndex] = total
    this.sectionExact[spineIndex] = true

    if (!this.isCalibrated) {
      this.calibrateFromSection(spineIndex, total)
    }
  }

  /**
   * One-shot global calibration. Later chapters never change `charsPerPage`
   * and never re-estimate unvisited sections from a new ratio.
   */
  private calibrateFromSection(spineIndex: number, displayedTotal: number): void {
    const charCount = this.sectionCharCounts[spineIndex]
    if (charCount <= 200 || displayedTotal <= 0) return

    this.charsPerPage = Math.min(3500, Math.max(300, Math.round(charCount / displayedTotal)))
    this.isCalibrated = true
    this.applyEstimatesToUnmeasured()
  }

  private applyEstimatesToUnmeasured(): void {
    for (let i = 0; i < this.spineLength; i += 1) {
      if (this.sectionExact[i]) continue
      this.sectionPages[i] = estimatePagesFromChars(
        this.sectionCharCounts[i],
        this.charsPerPage,
      )
    }
  }

  /**
   * Invalidate exact measurements when font size, line height, margins, or container size change.
   * Re-seeds unmeasured estimates from the last locked ratio, then allows one new calibration.
   */
  invalidate(): void {
    for (let i = 0; i < this.spineLength; i += 1) {
      this.sectionExact[i] = false
    }
    this.isCalibrated = false
    this.applyEstimatesToUnmeasured()
  }

  /**
   * Get live cumulative navigation metrics for the given position.
   *
   * Once every section is exact (cache hit or hidden measurement), live
   * `displayed.total` must NOT rewrite section pages — that is what made
   * footer totals drift while turning pages. Until then, live totals only
   * refine the current section for page-turn sync and keep ready=false.
   */
  getNavMetrics(
    spineIndex: number,
    sectionPage = 1,
    displayedTotal?: number,
  ): CumulativePageMetrics {
    if (
      !this.isFullyMeasured() &&
      typeof displayedTotal === 'number' &&
      displayedTotal >= 1 &&
      spineIndex >= 0 &&
      spineIndex < this.spineLength
    ) {
      this.sectionPages[spineIndex] = Math.max(1, Math.floor(displayedTotal))
      if (!this.isCalibrated) {
        this.calibrateFromSection(spineIndex, displayedTotal)
      }
    }

    return calculateCumulativePages(
      this.sectionPages,
      spineIndex,
      sectionPage,
      this.isFullyMeasured(),
    )
  }

  /**
   * Resolve a cumulative page target to (spineIndex, sectionPage).
   */
  resolveTargetPage(cumulativePage: number): TargetPageLocation {
    return resolveCumulativeTarget(this.sectionPages, cumulativePage)
  }

  /**
   * Return a snapshot copy of current section page counts.
   */
  getSectionPages(): number[] {
    return [...this.sectionPages]
  }

  /**
   * Prefix offsets for each spine section (0-based page index before the section).
   */
  getSectionOffsets(): number[] {
    return buildSectionOffsets(this.sectionPages)
  }

  /**
   * Total calculated pages across all sections.
   */
  getTotalPages(): number {
    let sum = 0
    for (let i = 0; i < this.spineLength; i += 1) {
      sum += Math.max(1, this.sectionPages[i] || 1)
    }
    return Math.max(1, sum)
  }
}
