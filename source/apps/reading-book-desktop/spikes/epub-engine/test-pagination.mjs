import assert from 'node:assert/strict'
import {
  calculateCumulativePages,
  resolveCumulativeTarget,
  estimatePagesFromChars,
  EpubPaginationTracker,
} from '../../src/reader/renderers/epub/progress/epub-pagination.ts'

console.log('--- Running EPUB CSS-Driven Pagination Tests ---')

// Test 1: calculateCumulativePages with multiple sections
{
  const sectionPages = [3, 5, 2] // 3 sections: 3 pages, 5 pages, 2 pages (total 10)

  // Section 0
  const p1 = calculateCumulativePages(sectionPages, 0, 1)
  assert.equal(p1.pageCurrent, 1)
  assert.equal(p1.pageTotal, 10)
  assert.equal(p1.progress, 0)

  const p2 = calculateCumulativePages(sectionPages, 0, 2)
  assert.equal(p2.pageCurrent, 2)

  const p3 = calculateCumulativePages(sectionPages, 0, 3)
  assert.equal(p3.pageCurrent, 3)

  // Turn to Section 1, page 1: must be exactly +1 (page 4)
  const p4 = calculateCumulativePages(sectionPages, 1, 1)
  assert.equal(p4.pageCurrent, 4)
  assert.equal(p4.pageCurrent - p3.pageCurrent, 1, 'Boundary transition must be exactly +1')

  // Section 1, page 5
  const p8 = calculateCumulativePages(sectionPages, 1, 5)
  assert.equal(p8.pageCurrent, 8)

  // Turn to Section 2, page 1: must be exactly +1 (page 9)
  const p9 = calculateCumulativePages(sectionPages, 2, 1)
  assert.equal(p9.pageCurrent, 9)
  assert.equal(p9.pageCurrent - p8.pageCurrent, 1, 'Boundary transition must be exactly +1')

  // Last page
  const p10 = calculateCumulativePages(sectionPages, 2, 2)
  assert.equal(p10.pageCurrent, 10)
  assert.equal(p10.progress, 1, 'Last page progress must be 1.0')

  console.log('✓ Test 1 Passed: 1:1 Page Turn & Section Boundaries')
}

// Test 2: resolveCumulativeTarget
{
  const sectionPages = [3, 5, 2] // Total 10

  assert.deepEqual(resolveCumulativeTarget(sectionPages, 1), { spineIndex: 0, sectionPage: 1 })
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 3), { spineIndex: 0, sectionPage: 3 })
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 4), { spineIndex: 1, sectionPage: 1 })
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 8), { spineIndex: 1, sectionPage: 5 })
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 9), { spineIndex: 2, sectionPage: 1 })
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 10), { spineIndex: 2, sectionPage: 2 })

  // Out of range clamping
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 0), { spineIndex: 0, sectionPage: 1 })
  assert.deepEqual(resolveCumulativeTarget(sectionPages, 999), { spineIndex: 2, sectionPage: 2 })

  console.log('✓ Test 2 Passed: Page Jump & Target Resolution')
}

// Test 3: estimatePagesFromChars
{
  assert.equal(estimatePagesFromChars(0), 1)
  assert.equal(estimatePagesFromChars(1200, 1200), 1)
  assert.equal(estimatePagesFromChars(3600, 1200), 3)
  assert.equal(estimatePagesFromChars(5000, 1200), 4)

  console.log('✓ Test 3 Passed: Character Estimation')
}

// Test 4: EpubPaginationTracker lifecycle and calibration
{
  const tracker = new EpubPaginationTracker(3)
  assert.equal(tracker.getSpineLength(), 3)
  assert.equal(tracker.getTotalPages(), 3) // Initial 1 per section

  // Initialize with character counts
  tracker.initCharCounts([3600, 7200, 2400])
  assert.deepEqual(tracker.getSectionPages(), [3, 6, 2])
  assert.equal(tracker.getTotalPages(), 11)

  // First section rendered: displayed.total = 4 (calibrates chars/page: 3600 / 4 = 900 chars/page)
  tracker.updateSectionPage(0, 4)
  // Section 1 (7200 chars / 900) = 8 pages
  // Section 2 (2400 chars / 900) = 3 pages
  assert.deepEqual(tracker.getSectionPages(), [4, 8, 3])
  assert.equal(tracker.getTotalPages(), 15)

  // Get live metrics
  const nav0 = tracker.getNavMetrics(0, 2)
  assert.equal(nav0.pageCurrent, 2)
  assert.equal(nav0.pageTotal, 15)

  const nav1 = tracker.getNavMetrics(1, 3)
  assert.equal(nav1.pageCurrent, 4 + 3) // 7
  assert.equal(nav1.pageTotal, 15)

  // Second section rendered with exact 7 pages (estimate was 8).
  // charsPerPage stays locked; the -1 page delta is absorbed into unvisited
  // section 2 so pageTotal does not move.
  tracker.updateSectionPage(1, 7)
  assert.deepEqual(tracker.getSectionPages(), [4, 7, 4])
  assert.equal(tracker.getTotalPages(), 15)

  const navAfterLock = tracker.getNavMetrics(1, 7)
  assert.equal(navAfterLock.pageTotal, 15)

  // Invalidate on font resize
  tracker.invalidate()
  // Rerender section 0 with larger font: displayed.total = 6 (3600 / 6 = 600 chars/page)
  tracker.updateSectionPage(0, 6)
  // Since we invalidated, it recalibrates globally!
  // Section 1 (7200 / 600) = 12 pages
  // Section 2 (2400 / 600) = 4 pages
  assert.deepEqual(tracker.getSectionPages(), [6, 12, 4])
  assert.equal(tracker.getTotalPages(), 22)

  console.log('✓ Test 4 Passed: Tracker Calibration & Invalidation')
}

// Test 5: After lock, later chapters must not move pageTotal
{
  const tracker = new EpubPaginationTracker(4)
  tracker.initCharCounts([3600, 7200, 2400, 4800])
  tracker.updateSectionPage(0, 4)
  const lockedTotal = tracker.getTotalPages()
  assert.equal(lockedTotal, 20)

  tracker.updateSectionPage(1, 10)
  assert.equal(tracker.getTotalPages(), lockedTotal)

  tracker.updateSectionPage(2, 1)
  assert.equal(tracker.getTotalPages(), lockedTotal)

  tracker.updateSectionPage(1, 10)
  assert.equal(tracker.getTotalPages(), lockedTotal)

  console.log('✓ Test 5 Passed: Frozen pageTotal after first calibration')
}

console.log('\nALL PAGINATION TESTS PASSED!')
