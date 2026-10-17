import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { buildAnnotatedPdf } from '../support/build-annotated-pdf.mjs'
import { textPdfLine } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * "Export PDF with annotations…" (docs/implementation_plan/pdf_annotation_export.md) in the built
 * Electron app: an annotation made in Readmate plus one embedded by "Foxit" end up as standard PDF
 * annotations in a NEW file; the book's own file is untouched; exporting again doesn't duplicate.
 * The output is checked with pdf.js in the test process (independent of the app's own read-back).
 */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function highlightLine(page: Page, n: number, line: number) {
  const span = pdfPage(page, n).locator('.textLayer span', { hasText: textPdfLine(n, line) })
  await expect(span).toBeVisible()
  await page.evaluate(
    ({ n, text }) => {
      const node = Array.from(document.querySelectorAll<HTMLElement>(`[data-page-number="${n}"] .textLayer span`)).find((s) => s.textContent === text)?.firstChild
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

/** Every annotation of the PDF as pdf.js reads it: [page, subtype, title, contents, color]. */
async function annotationsOf(file: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise
  const out: { page: number; subtype: string; title: string; contents: string; color: number[] }[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    for (const a of await (await doc.getPage(p)).getAnnotations({ intent: 'display' })) {
      out.push({ page: p, subtype: a.subtype, title: a.titleObj?.str ?? '', contents: a.contentsObj?.str ?? '', color: a.color ? Array.from(a.color as Uint8ClampedArray) : [] })
    }
  }
  await doc.destroy()
  return out
}

test('export writes Readmate annotations into a new PDF; the book file is untouched', async ({ reader }) => {
  test.setTimeout(120_000)
  const source = buildAnnotatedPdf({ annotations: [{ page: 1, subtype: 'Underline', lines: [4], color: [0, 0, 1], nm: '{FOXIT-1}', author: 'Alice' }] })
  const file = reader.writeFixture('to-export.pdf', source)
  const sourceSha = sha(source)
  const target = path.join(reader.workDir, 'exported.pdf')
  await reader.app.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog
  }, target)

  const page = reader.page
  await openBook(reader, file)
  await goToPage(page, 1)
  await expect(pdfPage(page, 1).locator('.rb-pdf-annot[data-kind="underline"]')).toHaveCount(1) // imported
  await highlightLine(page, 1, 2)
  await expect(pdfPage(page, 1).locator('.rb-pdf-annot[data-kind="highlight"]')).toHaveCount(1)

  async function exportNow() {
    // The reader toolbar (with "More") starts hidden; the menubar's "Tools" item shows it.
    const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
    if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
    await page.getByRole('button', { name: 'More options' }).click()
    await page.getByRole('menuitem', { name: 'Export PDF with annotations…' }).click()
    await expect(page.getByText(/Exported “exported\.pdf”/)).toBeVisible({ timeout: 20_000 })
  }

  await exportNow()
  const first = readFileSync(target)
  expect(first.subarray(0, source.length).equals(source)).toBe(true) // source bytes kept, update appended
  expect(sha(readFileSync(file))).toBe(sourceSha) // the book file was not written
  const annots = await annotationsOf(target)
  expect(annots.filter((a) => a.subtype === 'Underline')).toEqual([{ page: 1, subtype: 'Underline', title: 'Alice', contents: '', color: [0, 0, 255] }])
  const highlights = annots.filter((a) => a.subtype === 'Highlight')
  expect(highlights).toHaveLength(1)
  expect(highlights[0]).toMatchObject({ page: 1, title: 'Readmate', color: [255, 235, 59] })

  // Exporting again: same result, nothing duplicated.
  await page.waitForTimeout(500)
  await exportNow()
  expect(sha(readFileSync(target))).toBe(sha(first))
  expect((await annotationsOf(target)).length).toBe(2)
})
