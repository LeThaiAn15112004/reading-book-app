import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { buildMixedPdf, MIXED_PDF_PAGES } from '../support/build-mixed-pdf.mjs'
import { buildTocPdf } from '../support/build-toc-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { expectCurrentPage, goToPage, openBook, pdfPage } from '../support/reader'

const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

// Mirrors src/reader/renderers/pdf/pdfLayout.ts.
const PDF_TO_CSS = 96 / 72
const PAD_PX = 16
const PAGE_GAP_PX = 12

type Geometry = {
  vw: number
  vh: number
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

/** Page slot `n` relative to the PDF's scroll container (the reading area). */
async function pageGeometry(page: Page, n: number): Promise<Geometry> {
  return pdfPage(page, n).evaluate((slot) => {
    let root = slot.parentElement
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
    if (!root) throw new Error('PDF scroll container not found')
    const box = root.getBoundingClientRect()
    const rect = slot.getBoundingClientRect()
    return {
      vw: root.clientWidth,
      vh: root.clientHeight,
      top: rect.top - box.top,
      bottom: rect.bottom - box.top,
      left: rect.left - box.left,
      right: rect.right - box.left,
      width: rect.width,
      height: rect.height,
    }
  })
}

const zoomPercent = async (page: Page) => Number(await page.getByRole('textbox', { name: 'Zoom percentage' }).inputValue())

/** Expected Fit page zoom for a page of `w`×`h` pt in a `vw`×`vh` reading area (same rule as the app). */
function expectedZoom(w: number, h: number, vw: number, vh: number): number {
  const z = Math.min(vw / (w * PDF_TO_CSS + 2 * PAD_PX), vh / (h * PDF_TO_CSS + 2 * PAGE_GAP_PX))
  return Math.floor(z * 1000) / 1000
}

/** The page is entirely visible and fills the reading area in width or height (±3 px rounding). */
async function expectPageFitted(page: Page, n: number) {
  await expect
    .poll(async () => {
      const g = await pageGeometry(page, n)
      const inside = g.top >= -1 && g.bottom <= g.vh + 1 && g.left >= -1 && g.right <= g.vw + 1
      const z = (await zoomPercent(page)) / 100
      const fillsHeight = Math.abs(g.height + 2 * PAGE_GAP_PX * z - g.vh) <= 3
      const fillsWidth = Math.abs(g.width + 2 * PAD_PX * z - g.vw) <= 3
      return inside && (fillsHeight || fillsWidth) ? 'fitted' : JSON.stringify({ ...g, z })
    }, { timeout: 10_000 })
    .toBe('fitted')
}

test('Fit page fits the current page to the reading area, page by page sizes', async ({ reader }) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('mixed.pdf', buildMixedPdf()))
  await expectCurrentPage(page, 1)
  const fit = page.getByRole('button', { name: 'Fit page', exact: true })
  await expect(fit).toBeVisible()

  // Page 1 — portrait.
  await fit.click()
  await expectCurrentPage(page, 1)
  await expectPageFitted(page, 1)
  const g1 = await pageGeometry(page, 1)
  const z1 = await zoomPercent(page)
  expect(z1 / 100).toBeCloseTo(expectedZoom(MIXED_PDF_PAGES[0]!.w, MIXED_PDF_PAGES[0]!.h, g1.vw, g1.vh), 2)
  await expect(pdfPage(page, 1)).toContainText('Page 1 marker')

  // Page 2 — landscape: measured on its own, so a different zoom, and it fits too.
  await goToPage(page, 2)
  await fit.click()
  await expectCurrentPage(page, 2)
  await expectPageFitted(page, 2)
  const g2 = await pageGeometry(page, 2)
  const z2 = await zoomPercent(page)
  expect(z2 / 100).toBeCloseTo(expectedZoom(MIXED_PDF_PAGES[1]!.w, MIXED_PDF_PAGES[1]!.h, g2.vw, g2.vh), 2)
  expect(z2).not.toBe(z1)

  // Page 3 — small page: zooms in past 100%.
  await goToPage(page, 3)
  await fit.click()
  await expectCurrentPage(page, 3)
  await expectPageFitted(page, 3)
  expect(await zoomPercent(page)).toBeGreaterThan(100)

  // Fitting again is stable (same zoom, still fitted).
  const before = await zoomPercent(page)
  await fit.click()
  await expectPageFitted(page, 3)
  expect(await zoomPercent(page)).toBe(before)
})

test('Fit page keeps the current page in a long PDF; the zoom menu "Fit Page" does the same', async ({ reader }) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('toc.pdf', buildTocPdf()))
  await goToPage(page, 17)

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Fit page', exact: true }).click()
  await expectCurrentPage(page, 17)
  await expectPageFitted(page, 17)
  await expect(pdfPage(page, 17)).toContainText('Page 17 marker')
  const fitted = await zoomPercent(page)

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await goToPage(page, 9)
  await page.getByRole('button', { name: 'Zoom presets' }).click()
  await page.getByRole('menuitem', { name: 'Fit Page' }).click()
  await expectCurrentPage(page, 9)
  await expectPageFitted(page, 9)
  expect(await zoomPercent(page)).toBe(fitted)
})

test('EPUB has no Fit page button', async ({ reader }) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Chapter One' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fit page', exact: true })).toHaveCount(0)
})
