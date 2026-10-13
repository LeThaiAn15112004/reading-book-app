import { expect, type Locator, type Page } from '@playwright/test'
import type { ReaderApp } from '../fixtures/app'

/** Import a book, open it from the "Book added" toast and wait for the reader footer. */
export async function openBook(reader: ReaderApp, absPath: string): Promise<void> {
  await reader.importBook(absPath)
  await reader.page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(currentPageInput(reader.page)).toBeVisible()
}

export function currentPageInput(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Current page' })
}

export async function openContents(page: Page): Promise<void> {
  if (await page.getByRole('heading', { name: 'Contents' }).isVisible()) return
  await page.getByRole('button', { name: 'Contents', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Contents' })).toBeVisible()
}

/** The TOC entry the sidebar marks as the current location (`aria-current="location"`). */
export function activeTocEntry(page: Page): Locator {
  return page.locator('button[aria-current="location"]')
}

export function tocEntry(page: Page, label: string): Locator {
  return page.getByRole('button', { name: label, exact: true })
}

export async function expectActiveTocEntry(page: Page, label: string): Promise<void> {
  await expect(activeTocEntry(page)).toHaveCount(1)
  await expect(activeTocEntry(page)).toHaveAccessibleName(label)
}

export async function expectCurrentPage(page: Page, n: number): Promise<void> {
  await expect(currentPageInput(page)).toHaveValue(String(n))
}

export async function goToPage(page: Page, n: number): Promise<void> {
  const input = currentPageInput(page)
  await input.click()
  await input.fill(String(n))
  await input.press('Enter')
  await expectCurrentPage(page, n)
}

/** A PDF page slot; its text layer holds "Page N marker" (see build-toc-pdf.mjs). */
export function pdfPage(page: Page, n: number): Locator {
  return page.locator(`[data-page-number="${n}"]`)
}

/** Scroll the PDF's own scroll container (the Reader zoom viewport) by `dy` CSS pixels. */
export async function scrollPdfBy(page: Page, dy: number): Promise<void> {
  await page.evaluate((delta) => {
    let el = document.querySelector<HTMLElement>('[data-page-number="1"]')?.parentElement ?? null
    while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) {
      el = el.parentElement
    }
    if (!el) throw new Error('PDF scroll container not found')
    el.scrollBy({ top: delta })
  }, dy)
}

/** Wait until `locator`'s box stops changing (e.g. the reader re-laid out after the sidebar opened). */
export async function waitForStableBox(locator: Locator): Promise<void> {
  let last = ''
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox()
        const now = box ? `${Math.round(box.x)},${Math.round(box.width)},${Math.round(box.height)}` : 'none'
        const stable = now === last && now !== 'none'
        last = now
        return stable
      },
      { timeout: 10_000, intervals: [250] },
    )
    .toBe(true)
}
