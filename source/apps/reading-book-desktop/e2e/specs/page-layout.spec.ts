import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { buildTocPdf } from '../support/build-toc-pdf.mjs'
import { expect, test, type ReaderApp } from '../fixtures/app'
import {
  expectActiveTocEntry,
  expectCurrentPage,
  openBook,
  pdfPage,
  tocEntry,
  waitForStableBox,
} from '../support/reader'

// Tracked two-chapter sample (spikes/epub-engine/build-fixture.mjs): "Chapter One", "Chapter Two".
const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

/** Rail button of the left sidebar (`SidebarEdgeRail`). */
const railButton = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: label, exact: true })

/** Title of the open left sidebar panel. */
const panelHeading = (page: Page) => page.getByRole('heading', { level: 2 }).first()

/** A Page layout card (`PageLayoutPanel`): PDF cards are labelled "Page N". */
const layoutCard = (page: Page, n: number) => page.getByRole('button', { name: `Go to Page ${n}`, exact: true })

const readerTab = (page: Page, title: string) =>
  page.getByRole('tablist', { name: 'Open books' }).getByRole('tab').filter({ hasText: title })

/** Distinct card columns currently laid out in the Page layout grid. */
async function layoutColumnCount(page: Page): Promise<number> {
  const xs = await page
    .getByRole('button', { name: /^Go to Page \d+$/ })
    .evaluateAll((cards) => cards.map((c) => Math.round(c.getBoundingClientRect().left)))
  return new Set(xs).size
}

/** True when the drawn thumbnail of `n` has dark (text) pixels, i.e. the real page was rendered. */
async function thumbnailHasInk(page: Page, n: number): Promise<boolean> {
  return page.locator(`[data-thumbnail-page="${n}"] canvas`).evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx || canvas.width === 0) return false
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 100 && data[i + 3]! > 0) return true
    return false
  })
}

async function openPdf(reader: ReaderApp) {
  await openBook(reader, reader.writeFixture('toc.pdf', buildTocPdf()))
  await expectCurrentPage(reader.page, 1)
}

async function openEpub(reader: ReaderApp) {
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  await expect(epubContent(reader.page).getByRole('heading', { name: 'Chapter One' })).toBeVisible()
}

const epubContent = (page: Page) => page.frameLocator('iframe').first()

async function openPageLayoutAndJump(page: Page, target: number) {
  await expect(railButton(page, 'Page layout')).toBeVisible()
  await railButton(page, 'Page layout').click()
  await expect(panelHeading(page)).toHaveText('Page layout')
  // One card per PDF page.
  await expect(page.getByRole('button', { name: /^Go to Page \d+$/ })).toHaveCount(30)
  await layoutCard(page, target).click()
  await expectCurrentPage(page, target)
  await expect(pdfPage(page, target)).toBeInViewport({ ratio: 0.5 })
  await expect(pdfPage(page, target)).toContainText(`Page ${target} marker`)
  await expect(layoutCard(page, target)).toHaveAttribute('aria-current', 'page')
}

/** EPUB: no Page layout anywhere the sidebar can be opened from. */
async function expectNoPageLayout(page: Page) {
  await expect(railButton(page, 'Contents')).toBeVisible()
  await expect(railButton(page, 'Page layout')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Page layout', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Page layout' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Go to / })).toHaveCount(0)
}

/** Every other sidebar entry point: the edge handle and the "T" (Table of Contents) shortcut. */
async function expectAlternateEntryPointsShowContents(page: Page) {
  const handle = page.getByRole('button', { name: /^(Open|Close) sidebar$/ })
  if ((await handle.getAttribute('aria-label')) === 'Close sidebar') await handle.click()
  await expect(handle).toHaveAttribute('aria-label', 'Open sidebar')
  await handle.click()
  await expect(panelHeading(page)).toHaveText('Contents')
  await expect(page.getByRole('heading', { name: 'Page layout' })).toHaveCount(0)

  await handle.click() // close
  await expect(handle).toHaveAttribute('aria-label', 'Open sidebar')
  await page.keyboard.press('t')
  await expect(panelHeading(page)).toHaveText('Contents')
  await expect(page.getByRole('heading', { name: 'Page layout' })).toHaveCount(0)
}

async function epubTocJumpToChapterTwo(page: Page) {
  await waitForStableBox(page.locator('iframe').first())
  if (!(await page.getByRole('heading', { name: 'Contents' }).isVisible())) {
    await railButton(page, 'Contents').click()
  }
  await expect(panelHeading(page)).toHaveText('Contents')
  // epub.js can drop a TOC jump issued right after the book / sidebar opened (pre-existing, see
  // docs/implementation_plan/pdf_toc_sync.md §9) — re-click until it lands.
  await expect(async () => {
    await tocEntry(page, 'Chapter Two').click()
    await expect(epubContent(page).getByRole('heading', { name: 'Chapter Two' })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expectActiveTocEntry(page, 'Chapter Two')
}

test('E2E 1 — PDF: Page layout shows rendered pages, navigates, columns follow the sidebar width', async ({ reader }) => {
  const { page } = reader
  await openPdf(reader)
  await openPageLayoutAndJump(page, 12)
  await layoutCard(page, 3).click()
  await expectCurrentPage(page, 3)

  // Real page renders (PDF is fixed layout), not placeholder cards.
  await layoutCard(page, 1).scrollIntoViewIfNeeded()
  await expect(page.locator('[data-thumbnail-page="1"][data-thumbnail-drawn]')).toHaveCount(1)
  await expect(page.locator('[data-thumbnail-page="1"] canvas')).toBeVisible()
  expect(await thumbnailHasInk(page, 1)).toBe(true)
  // Lazy: far-away pages are not drawn yet.
  await expect(page.locator('[data-thumbnail-page="30"][data-thumbnail-drawn]')).toHaveCount(0)

  // No +/- column buttons; the column count comes from the sidebar width.
  await expect(page.getByRole('button', { name: /section cards/ })).toHaveCount(0)
  const narrow = await layoutColumnCount(page)
  const handle = page.getByRole('separator', { name: 'Resize sidebar' })
  const box = await handle.boundingBox()
  if (!box) throw new Error('resize handle not laid out')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 260, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => layoutColumnCount(page)).toBeGreaterThan(narrow)
  await page.screenshot({ path: test.info().outputPath('page-layout-wide.png') })
})

test('E2E 2 — EPUB: Page layout is unavailable, Contents still navigates', async ({ reader }) => {
  const { page } = reader
  await openEpub(reader)
  await expectNoPageLayout(page)
  await expectAlternateEntryPointsShowContents(page)
  await expectNoPageLayout(page)
  await epubTocJumpToChapterTwo(page)
})

test('E2E 3 — switching PDF → EPUB → PDF keeps Page layout PDF-only', async ({ reader }) => {
  const { page } = reader
  await openPdf(reader)
  await openPageLayoutAndJump(page, 7)

  // Second book through the normal workflow: Library → Add file → Open (a new reader tab).
  await page.getByRole('link', { name: 'Library', exact: true }).or(page.getByRole('button', { name: 'Library', exact: true })).first().click()
  await openEpub(reader)
  await expect(readerTab(page, 'toc')).toHaveCount(1)
  await expect(readerTab(page, 'Spike Sample Book')).toHaveAttribute('aria-selected', 'true')
  await expectNoPageLayout(page)
  await expectAlternateEntryPointsShowContents(page)
  await epubTocJumpToChapterTwo(page)

  // Back to the PDF tab: Page layout is there again and works; reading position kept.
  await readerTab(page, 'toc').getByRole('button').first().click()
  await expect(readerTab(page, 'toc')).toHaveAttribute('aria-selected', 'true')
  await expectCurrentPage(page, 7)
  await openPageLayoutAndJump(page, 20)

  // And EPUB again: still no Page layout, chapter position kept.
  await readerTab(page, 'Spike Sample Book').getByRole('button').first().click()
  await expect(readerTab(page, 'Spike Sample Book')).toHaveAttribute('aria-selected', 'true')
  await expect(epubContent(page).getByRole('heading', { name: 'Chapter Two' })).toBeVisible()
  await expectNoPageLayout(page)
})
