import { buildTocPdf } from '../support/build-toc-pdf.mjs'
import { expect, test, type ReaderApp } from '../fixtures/app'
import {
  activeTocEntry,
  currentPageInput,
  expectActiveTocEntry,
  expectCurrentPage,
  goToPage,
  openBook,
  openContents,
  pdfPage,
  scrollPdfBy,
  tocEntry,
} from '../support/reader'

/**
 * Expected active entry for a page of the fixture under the documented rule (largest destination
 * page <= current page; same-page tie → last in document order, i.e. the child).
 */
function expectedEntry(page: number): string {
  if (page === 1) return 'Part One'
  if (page <= 3) return 'Section 1.1'
  if (page <= 5) return 'Section 1.2'
  if (page <= 7) return 'Section 2.1'
  if (page <= 9) return 'Section 2.2'
  if (page === 10) return 'Appendix'
  return `A.${page - 10}`
}

async function openTocPdf(reader: ReaderApp) {
  await openBook(reader, reader.writeFixture('toc.pdf', buildTocPdf()))
  await expectCurrentPage(reader.page, 1)
  await openContents(reader.page)
}

async function currentPage(reader: ReaderApp): Promise<number> {
  return Number(await currentPageInput(reader.page).inputValue())
}

/**
 * After a scroll, page tracking may still report a page or two: wait until the page indicator is
 * unchanged across two reads and the active entry is the one the rule expects for that page.
 */
async function expectActiveEntryForSettledPage(reader: ReaderApp): Promise<number> {
  let last = -1
  let settled = -1
  await expect
    .poll(
      async () => {
        const now = await currentPage(reader)
        const stable = now === last
        last = now
        if (!stable) return 'page still changing'
        settled = now
        const active = await activeTocEntry(reader.page).getAttribute('aria-label')
        return active === expectedEntry(now) ? 'ok' : `page ${now}: active ${active}`
      },
      { timeout: 15_000, intervals: [250] },
    )
    .toBe('ok')
  return settled
}

test.describe('PDF TOC follows the current page', () => {
  test('E2E 1 — opening a PDF marks the entry for the initial page', async ({ reader }) => {
    await openTocPdf(reader)
    await expectActiveTocEntry(reader.page, 'Part One')
    await expect(activeTocEntry(reader.page)).toBeInViewport()
  })

  test('E2E 2 — clicking a TOC entry navigates and activates that entry', async ({ reader }) => {
    const { page } = reader
    await openTocPdf(reader)

    await tocEntry(page, 'Section 2.2').click()
    await expectCurrentPage(page, 8)
    await expect(pdfPage(page, 8)).toBeInViewport({ ratio: 0.5 })
    await expect(pdfPage(page, 8)).toContainText('Page 8 marker')
    await expectActiveTocEntry(page, 'Section 2.2')
    await expect(activeTocEntry(page)).toBeInViewport()

    // Part Two shares page 6 with its child Section 2.1 — the clicked one is the one lit.
    await tocEntry(page, 'Part Two').click()
    await expectCurrentPage(page, 6)
    await expectActiveTocEntry(page, 'Part Two')

    // Far entry: the list has to scroll for it to be visible.
    await tocEntry(page, 'A.20').click()
    await expectCurrentPage(page, 30)
    await expectActiveTocEntry(page, 'A.20')
    await expect(activeTocEntry(page)).toBeInViewport()
  })

  test('E2E 3 — scrolling the PDF moves the active entry and reveals it', async ({ reader }) => {
    const { page } = reader
    await openTocPdf(reader)

    // Real wheel input over the page until the reader reports page 4 or later.
    const box = await pdfPage(page, 1).boundingBox()
    if (!box) throw new Error('page 1 not laid out')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 400)
          return currentPage(reader)
        },
        { timeout: 20_000, intervals: [150] },
      )
      .toBeGreaterThanOrEqual(4)
    await expectActiveEntryForSettledPage(reader)

    // Put the TOC list at its top, then scroll the document far: the active entry (an A.x near the
    // bottom of the list) must be scrolled into view.
    await page.evaluate(() => {
      let el: HTMLElement | null = document.querySelector('button[aria-current="location"]')
      while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement
      if (el) el.scrollTop = 0
    })
    await expect(tocEntry(page, 'A.18')).not.toBeInViewport()
    await expect
      .poll(
        async () => {
          await scrollPdfBy(page, 2500)
          return currentPage(reader)
        },
        { timeout: 20_000, intervals: [200] },
      )
      .toBeGreaterThanOrEqual(25)
    await expectActiveEntryForSettledPage(reader)
    await expect(activeTocEntry(page)).toHaveCount(1)
    await expect(activeTocEntry(page)).toBeInViewport()
  })

  test('E2E 4 — Previous/Next follows the matching rule', async ({ reader }) => {
    const { page } = reader
    await openTocPdf(reader)
    const next = page.getByRole('button', { name: 'Next page' })
    const prev = page.getByRole('button', { name: 'Previous page' })

    for (const target of [2, 3, 4, 5, 6]) {
      await next.click()
      await expectCurrentPage(page, target)
      await expectActiveTocEntry(page, expectedEntry(target))
    }
    for (const target of [5, 4, 3]) {
      await prev.click()
      await expectCurrentPage(page, target)
      await expectActiveTocEntry(page, expectedEntry(target))
    }
  })

  test('E2E 5 — Go to page resolves the destination and the active entry', async ({ reader }) => {
    const { page } = reader
    await openTocPdf(reader)
    for (const target of [9, 5, 17, 1]) {
      await goToPage(page, target)
      await expect(pdfPage(page, target)).toBeInViewport({ ratio: 0.5 })
      await expectActiveTocEntry(page, expectedEntry(target))
    }
  })

  test('E2E 6 — nested entries: parent vs children, no nearby-sibling activation', async ({ reader }) => {
    const { page } = reader
    await openTocPdf(reader)

    // Parent alone on its page until the first child starts.
    await goToPage(page, 1)
    await expectActiveTocEntry(page, 'Part One')
    await goToPage(page, 2)
    await expectActiveTocEntry(page, 'Section 1.1')

    // Section 1.2 starts on page 4: being one page away does not make it active.
    await goToPage(page, 3)
    await expectActiveTocEntry(page, 'Section 1.1')
    await expect(tocEntry(page, 'Section 1.2')).not.toHaveAttribute('aria-current', 'location')

    // Parent and child share page 6: the child (more specific) is active, the parent is not.
    await goToPage(page, 6)
    await expectActiveTocEntry(page, 'Section 2.1')
    await expect(tocEntry(page, 'Part Two')).not.toHaveAttribute('aria-current', 'location')
    await goToPage(page, 7)
    await expectActiveTocEntry(page, 'Section 2.1')

    // A parent whose children start later is active on its own page only.
    await goToPage(page, 10)
    await expectActiveTocEntry(page, 'Appendix')
    await goToPage(page, 11)
    await expectActiveTocEntry(page, 'A.1')

    // Clicking a parent activates the parent, not a child on the same page.
    await tocEntry(page, 'Part One').click()
    await expectCurrentPage(page, 1)
    await expectActiveTocEntry(page, 'Part One')
  })

  test('E2E 8 — zooming keeps the page and the active entry, no scroll loop', async ({ reader }) => {
    const { page } = reader
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    await openTocPdf(reader)
    await goToPage(page, 8)
    await expectActiveTocEntry(page, 'Section 2.2')

    // Count scroll events on the TOC list while zooming.
    await page.evaluate(() => {
      let el: HTMLElement | null = document.querySelector('button[aria-current="location"]')
      while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
      const w = window as unknown as { tocScrolls: number }
      w.tocScrolls = 0
      el?.addEventListener('scroll', () => {
        w.tocScrolls += 1
      })
    })

    for (const name of ['Zoom in', 'Zoom in', 'Zoom out', 'Zoom out', 'Zoom out']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expectCurrentPage(page, 8)
      await expectActiveTocEntry(page, 'Section 2.2')
    }
    // Let pending page tracking settle, then re-check.
    await page.waitForTimeout(500)
    await expectCurrentPage(page, 8)
    await expectActiveTocEntry(page, 'Section 2.2')
    await expect(activeTocEntry(page)).toBeInViewport()
    const scrolls = await page.evaluate(() => (window as unknown as { tocScrolls: number }).tocScrolls)
    expect(scrolls).toBe(0)
    expect(errors).toEqual([])
  })
})
