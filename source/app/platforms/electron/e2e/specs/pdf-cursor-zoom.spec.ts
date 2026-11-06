import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { buildSizedPdf } from '../support/build-mixed-pdf.mjs'
import { expect, test, type ReaderApp } from '../fixtures/app'
import { currentPageInput, expectCurrentPage, goToPage, openBook, pdfPage, scrollPdfBy } from '../support/reader'

/**
 * Ctrl + wheel on a PDF zooms around the cursor: the document point under the pointer stays under
 * it (docs/implementation_plan/pdf_cursor_zoom_anchor.md). Measured from the real DOM: the point is
 * recorded as (page, fraction of that page's box) before the zoom and looked up again after it.
 */

const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

/** 40 pages of four different sizes (pt), so page heights / widths and centring all vary. */
const SIZES = [
  { w: 612, h: 792 },
  { w: 500, h: 700 },
  { w: 792, h: 612 },
  { w: 420, h: 595 },
]
const PAGES = Array.from({ length: 40 }, (_, i) => SIZES[i % SIZES.length]!)

/** Max distance (CSS px) between the cursor and its document point after a zoom step. */
const TOLERANCE_PX = 2

type Anchor = { n: number; fx: number; fy: number }
type Check = {
  anchor: Anchor
  dx: number
  dy: number
  /** The scroll position that would hold the point lies outside the scrollable range (clamped). */
  clampedX: boolean
  clampedY: boolean
}

async function openSizedPdf(reader: ReaderApp) {
  await openBook(reader, reader.writeFixture('sized.pdf', buildSizedPdf(PAGES)))
  await expectCurrentPage(reader.page, 1)
}

const zoomPercent = async (page: Page) => Number(await page.getByRole('textbox', { name: 'Zoom percentage' }).inputValue())

/** Two animation frames — the reader has committed and laid out whatever the last event caused. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

/** Viewport-relative rectangle of the PDF reading area (the zoom viewport). */
async function readingArea(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-reader-zoom-viewport]')
    if (!el) throw new Error('zoom viewport not found')
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: el.clientWidth, height: el.clientHeight }
  })
}

/** Document point under client (x, y): the page box that holds it (nearest one in a gap). */
async function anchorAt(page: Page, x: number, y: number): Promise<Anchor> {
  return page.evaluate(
    ([cx, cy]) => {
      const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-page-number]'))
      let best: { el: HTMLElement; d: number } | null = null
      for (const el of slots) {
        const r = el.getBoundingClientRect()
        const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0
        if (!best || d < best.d) best = { el, d }
        if (d === 0) break
      }
      if (!best) throw new Error('no PDF pages')
      const r = best.el.getBoundingClientRect()
      return { n: Number(best.el.dataset.pageNumber), fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height }
    },
    [x, y] as const,
  )
}

/** Where `anchor` is now (client px), and whether the scroll could still have held it. */
async function measure(page: Page, anchor: Anchor, x: number, y: number): Promise<Check> {
  return page.evaluate(
    ([a, cx, cy]) => {
      const slot = document.querySelector<HTMLElement>(`[data-page-number="${a.n}"]`)
      const root = document.querySelector<HTMLElement>('[data-reader-zoom-viewport]')
      if (!slot || !root) throw new Error('page or viewport missing')
      const r = slot.getBoundingClientRect()
      const dx = r.left + a.fx * r.width - cx
      const dy = r.top + a.fy * r.height - cy
      const wantLeft = root.scrollLeft + dx
      const wantTop = root.scrollTop + dy
      const maxLeft = root.scrollWidth - root.clientWidth
      const maxTop = root.scrollHeight - root.clientHeight
      return {
        anchor: a,
        dx,
        dy,
        clampedX: wantLeft < -1 || wantLeft > maxLeft + 1,
        clampedY: wantTop < -1 || wantTop > maxTop + 1,
      }
    },
    [anchor, x, y] as const,
  )
}

/** Hold Ctrl and turn the wheel `ticks` times (negative deltaY zooms in) at (x, y). */
async function ctrlWheel(page: Page, x: number, y: number, deltaY: number, ticks = 1) {
  await page.mouse.move(x, y)
  await page.keyboard.down('Control')
  try {
    for (let i = 0; i < ticks; i++) await page.mouse.wheel(0, deltaY)
  } finally {
    await page.keyboard.up('Control')
  }
}

/** One zoom step at (x, y); the point that was under the cursor must still be (or be clamped). */
async function zoomStepHolds(page: Page, x: number, y: number, deltaY: number, ticks = 1): Promise<Check> {
  const anchor = await anchorAt(page, x, y)
  const before = await zoomPercent(page)
  await ctrlWheel(page, x, y, deltaY, ticks)
  await expect.poll(() => zoomPercent(page), { message: `zoom did not change at ${Math.round(x)},${Math.round(y)} ${deltaY}` }).not.toBe(before)
  await settle(page)
  await settle(page)
  const check = await measure(page, anchor, x, y)
  const label = JSON.stringify({ at: [Math.round(x), Math.round(y)], deltaY, ticks, zoom: await zoomPercent(page), ...check })
  if (!check.clampedX) expect(Math.abs(check.dx), `x drift ${label}`).toBeLessThanOrEqual(TOLERANCE_PX)
  if (!check.clampedY) expect(Math.abs(check.dy), `y drift ${label}`).toBeLessThanOrEqual(TOLERANCE_PX)
  return check
}

/** Client point at fractions (fx, fy) of page `n`'s box. */
async function pointOnPage(page: Page, n: number, fx: number, fy: number) {
  const box = await pdfPage(page, n).boundingBox()
  if (!box) throw new Error(`page ${n} has no box`)
  return { x: box.x + fx * box.width, y: box.y + fy * box.height }
}

test('Ctrl+wheel in the middle of a page keeps that point under the cursor, in and out', async ({ reader }) => {
  const { page } = reader
  await openSizedPdf(reader)
  await goToPage(page, 10)
  const area = await readingArea(page)
  const x = area.left + area.width * 0.5
  const y = area.top + area.height * 0.5
  for (let i = 0; i < 4; i++) await zoomStepHolds(page, x, y, -120)
  for (let i = 0; i < 6; i++) await zoomStepHolds(page, x, y, 120)
  for (let i = 0; i < 2; i++) await zoomStepHolds(page, x, y, -120)
  const anchor = await anchorAt(page, x, y)
  expect(anchor.n).toBeGreaterThanOrEqual(9)
  expect(anchor.n).toBeLessThanOrEqual(11)
})

test('Ctrl+wheel off-centre (corners, page edges) holds the point under the cursor', async ({ reader }) => {
  const { page } = reader
  await openSizedPdf(reader)
  await goToPage(page, 6)
  const area = await readingArea(page)
  const spots = [
    { x: area.left + area.width * 0.15, y: area.top + area.height * 0.12 }, // upper left
    { x: area.left + area.width * 0.85, y: area.top + area.height * 0.88 }, // lower right
    { x: area.left + area.width * 0.85, y: area.top + area.height * 0.15 }, // upper right
    { x: area.left + area.width * 0.2, y: area.top + area.height * 0.9 }, // lower left
  ]
  for (const { x, y } of spots) {
    await zoomStepHolds(page, x, y, -120, 1)
    await zoomStepHolds(page, x, y, -120, 1)
    await zoomStepHolds(page, x, y, 120, 1)
    await zoomStepHolds(page, x, y, 120, 1)
  }
  // Left / right edge of the current page itself (zoomed in so the page overflows sideways).
  for (let i = 0; i < 4; i++) await zoomStepHolds(page, area.left + area.width / 2, area.top + area.height / 2, -120)
  const current = Number(await currentPageInput(page).inputValue())
  const edgeL = await pointOnPage(page, current, 0.02, 0.5)
  const edgeR = await pointOnPage(page, current, 0.98, 0.5)
  for (const p of [edgeL, edgeR]) {
    const x = Math.min(Math.max(p.x, area.left + 4), area.left + area.width - 4)
    await zoomStepHolds(page, x, p.y, -120)
    await zoomStepHolds(page, x, p.y, 120)
  }
})

test('Ctrl+wheel at the boundary between two pages does not jump to another page', async ({ reader }) => {
  const { page } = reader
  await openSizedPdf(reader)
  await goToPage(page, 14)
  const area = await readingArea(page)
  const x = area.left + area.width / 2
  // Bring the boundary between page 14 and 15 to the middle of the reading area.
  const bottom14 = await pointOnPage(page, 14, 0.5, 1)
  await scrollPdfBy(page, bottom14.y - (area.top + area.height / 2))
  await settle(page)
  const b = (await pointOnPage(page, 14, 0.5, 1)).y
  const t = (await pointOnPage(page, 15, 0.5, 0)).y
  expect(t).toBeGreaterThan(b)
  // Just above the boundary (page 14), in the gap, just below it (page 15).
  for (const [y, pages] of [
    [b - 4, [14]],
    [(b + t) / 2, [14, 15]],
    [t + 4, [15]],
  ] as const) {
    for (let i = 0; i < 3; i++) await zoomStepHolds(page, x, y, -120)
    for (let i = 0; i < 3; i++) await zoomStepHolds(page, x, y, 120)
    // Still the same page under the cursor (a point in the gap is next to one of its two pages).
    expect(pages).toContain((await anchorAt(page, x, y)).n)
  }
})

test('Ctrl+wheel far into a long, mixed-size PDF; a fast burst of ticks still holds the point', async ({ reader }) => {
  const { page } = reader
  await openSizedPdf(reader)
  await goToPage(page, 35)
  const area = await readingArea(page)
  const x = area.left + area.width * 0.4
  const y = area.top + area.height * 0.6
  for (let i = 0; i < 3; i++) await zoomStepHolds(page, x, y, -120)
  // Several ticks without waiting in between (one gesture): React may batch them into one render.
  await zoomStepHolds(page, x, y, -120, 5)
  await zoomStepHolds(page, x, y, 120, 8)
  await zoomStepHolds(page, x, y, -60, 3)
  const n = Number(await currentPageInput(page).inputValue())
  expect(Math.abs(n - 35)).toBeLessThanOrEqual(1)
})

test('EPUB: Hand + Ctrl+wheel still zooms 10% per tick and back; the toolbar zoom still works', async ({ reader }) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Chapter One' })).toBeVisible()
  const area = await readingArea(page)
  const x = area.left + area.width / 2
  const y = area.top + area.height / 2
  expect(await zoomPercent(page)).toBe(100)
  // Hand is the default tool; the EPUB iframe forwards Ctrl+wheel to the shared focus zoom.
  for (const expected of [110, 121]) {
    await ctrlWheel(page, x, y, -120)
    await expect.poll(() => zoomPercent(page)).toBe(expected)
  }
  for (const expected of [110, 100]) {
    await ctrlWheel(page, x, y, 120)
    await expect.poll(() => zoomPercent(page)).toBe(expected)
  }
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(() => zoomPercent(page)).toBe(125)
})
