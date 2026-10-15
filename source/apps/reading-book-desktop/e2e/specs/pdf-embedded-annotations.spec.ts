import { readFileSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import {
  SAMPLE_ANNOTATIONS,
  buildAnnotatedPdf,
  lineBaseline,
} from '../support/build-annotated-pdf.mjs'
import { textPdfLine } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * Embedded PDF annotation import (docs/implementation_plan/pdf_embedded_annotation_import.md), in the
 * built Electron app: a PDF that already carries Foxit-style annotations shows them as app
 * annotations on first open (and stops drawing the file's own copy on the canvas); after the file
 * is rewritten by "another viewer" (annotations added / recolored / removed, objects renumbered),
 * reopening finds the changes without duplicating anything or touching an annotation made in the app.
 */

const marks = (page: Page, n: number, kind: string) => pdfPage(page, n).locator(`.rb-pdf-annot[data-kind="${kind}"]`)
const noteIcons = (page: Page, n: number) => pdfPage(page, n).locator('[data-pdf-annot-note]')

/** Colors (`--rb-annot-color`) of the `kind` marks on page `n`. */
async function markColors(page: Page, n: number, kind: string): Promise<string[]> {
  return marks(page, n, kind).evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue('--rb-annot-color')))
}

/**
 * RGB of page `n`'s canvas at user-space point (`x`, `y`) of a Letter page — inside a highlight's
 * box but past the end of the text, so it shows only what the canvas painted there.
 */
async function canvasPixel(page: Page, n: number, x: number, y: number): Promise<number[] | null> {
  return page.evaluate(
    ({ n, fx, fy }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`[data-page-number="${n}"] canvas`)
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return null
      const data = ctx.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data
      return [data[0]!, data[1]!, data[2]!]
    },
    { n, fx: x / 612, fy: (792 - y) / 792 },
  )
}

/** The reader toolbar starts hidden; the menubar's "Tools" item shows it (as in pdf-annotations.spec). */
async function chooseTool(page: Page, tool: 'Hand' | 'Select') {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
  const button = page.getByRole('button', { name: tool, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Select line `line` of page `n` and mark it through the selection menu. */
async function highlightLineInApp(page: Page, n: number, line: number) {
  const span = pdfPage(page, n).locator('.textLayer span', { hasText: textPdfLine(n, line) })
  await expect(span).toBeVisible()
  await page.evaluate(
    ({ n, text }) => {
      const node = Array.from(document.querySelectorAll<HTMLElement>(`[data-page-number="${n}"] .textLayer span`)).find(
        (s) => s.textContent === text,
      )?.firstChild
      if (!node) throw new Error('line span not found')
      const range = document.createRange()
      range.selectNodeContents(node)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
    },
    { n, text: textPdfLine(n, line) },
  )
  const box = (await span.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Selection options' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Highlight', exact: true }).click()
}

test('annotations embedded in a PDF are imported on every open, without duplicates', async ({ reader }) => {
  test.setTimeout(120_000)
  const file = reader.writeFixture('foxit-annotated.pdf', buildAnnotatedPdf({ annotations: SAMPLE_ANNOTATIONS }))
  let page = reader.page
  await openBook(reader, file)

  // 1. First open: the five supported annotations become app marks; FreeText / Ink / Link / the
  //    hidden highlight / the reply don't.
  await goToPage(page, 1)
  await expect(marks(page, 1, 'highlight')).toHaveCount(2) // one per line of the two-line highlight
  await expect(marks(page, 1, 'underline')).toHaveCount(1)
  expect(await markColors(page, 1, 'highlight')).toEqual(['#FFEB3B', '#FFEB3B'])

  // The file's own highlight appearance is no longer drawn on the canvas (no double paint): inside
  // the highlight's box past the text end, the canvas is plain white again.
  const sampleY = lineBaseline(2) + 5
  await expect.poll(() => canvasPixel(page, 1, 540, sampleY), { timeout: 10_000 }).toEqual([255, 255, 255])

  // The imported mark behaves like any app annotation: a click opens its menu.
  await chooseTool(page, 'Select')
  const hl = (await marks(page, 1, 'highlight').first().boundingBox())!
  await page.mouse.click(hl.x + hl.width - 4, hl.y + hl.height / 2)
  await expect(page.getByRole('dialog', { name: 'Edit highlight' })).toBeVisible()
  await page.keyboard.press('Escape')

  await goToPage(page, 2)
  await expect(marks(page, 2, 'strikethrough')).toHaveCount(1)
  await expect(marks(page, 2, 'underline')).toHaveCount(1) // the Squiggly
  await expect(marks(page, 2, 'highlight')).toHaveCount(0) // the hidden one
  await goToPage(page, 3)
  await expect(noteIcons(page, 3)).toHaveCount(1)

  // An annotation made in the app on page 1.
  await goToPage(page, 1)
  await highlightLineInApp(page, 1, 7)
  await expect(marks(page, 1, 'highlight')).toHaveCount(3)

  // 2. "Another viewer" rewrites the file: highlight recolored, StrikeOut removed, two annotations
  //    added, every object renumbered. The file is the user's own (referenced in place).
  await reader.app.close()
  const edited = [
    { ...SAMPLE_ANNOTATIONS[0], color: [0, 0.6, 1], contents: 'Recolored in Foxit' },
    SAMPLE_ANNOTATIONS[1],
    ...SAMPLE_ANNOTATIONS.slice(3),
    { page: 1, subtype: 'Highlight', lines: [8], color: [0.5, 0.8, 0.5], contents: 'Added in Foxit' },
    { page: 3, subtype: 'Underline', lines: [2], color: [0.6, 0.4, 0.9] },
  ]
  const before = readFileSync(file)
  writeFileSync(file, buildAnnotatedPdf({ annotations: edited, padObjects: 9 }))
  expect(readFileSync(file).equals(before)).toBe(false)

  // 3. Reopen (the app restores the open book): changes found, nothing duplicated.
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: 'Resume foxit-annotated' })
    const pageInput = page.getByRole('textbox', { name: 'Current page' })
    await expect(resume.or(pageInput).first()).toBeVisible({ timeout: 20_000 })
    if (await resume.isVisible()) await resume.click()

    await goToPage(page, 1)
    // 2 (imported, recolored) + 1 (app-made line 7) + 1 (added line 8) — no duplicate of the first.
    await expect(marks(page, 1, 'highlight')).toHaveCount(4)
    await expect
      .poll(() => markColors(page, 1, 'highlight'))
      .toEqual(expect.arrayContaining(['#0099FF', '#0099FF', '#80CC80']))
    await expect(marks(page, 1, 'underline')).toHaveCount(1)

    await goToPage(page, 2)
    await expect(marks(page, 2, 'strikethrough')).toHaveCount(1) // removed from the file, kept in the app
    await expect(marks(page, 2, 'underline')).toHaveCount(1)
    await goToPage(page, 3)
    await expect(noteIcons(page, 3)).toHaveCount(1)
    await expect(marks(page, 3, 'underline')).toHaveCount(1) // added in the file
  } finally {
    await app.close().catch(() => {})
  }
})
