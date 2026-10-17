import { readFileSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { buildAnnotatedPdf } from '../support/build-annotated-pdf.mjs'
import { textPdfLine } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * Two-way sync (docs/implementation_plan/pdf_annotation_two_way_sync.md) in the built Electron app,
 * the PDF staying open: write-back is enabled from the More menu (with its confirmation); an
 * annotation made, recolored and deleted in Readmate lands in the PDF file (checked with pdf.js in
 * the test process); a change "another app" saves into the file comes back into the reader.
 * Latency (UI action → file written; file written → UI updated) is attached to the result.
 */

type FileAnnotation = { subtype: string; nm: string; color: string; contents: string }

async function fileAnnotations(file: string): Promise<FileAnnotation[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 }).promise
  const out: FileAnnotation[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    for (const a of await (await doc.getPage(p)).getAnnotations({ intent: 'display' })) {
      const rgb = a.color ? Array.from(a.color as Uint8ClampedArray) : []
      out.push({
        subtype: a.subtype,
        nm: '',
        color: rgb.length ? `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}` : '',
        contents: a.contentsObj?.str ?? '',
      })
    }
  }
  await doc.destroy()
  // /NM isn't exposed by pdf.js: read the names straight from the bytes (Readmate writes literal strings).
  const names = [...readFileSync(file).toString('latin1').matchAll(/\/NM \((readmate:[^)]+)\)/g)].map((m) => m[1]!)
  return out.map((a, i) => ({ ...a, nm: names[i] ?? '' }))
}

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

async function openMore(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await page.getByRole('button', { name: 'More options' }).click()
}

async function chooseSelectTool(page: Page) {
  const button = page.getByRole('button', { name: 'Select', exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

test('annotations flow both ways between Readmate and the PDF file while it is open', async ({ reader }) => {
  test.setTimeout(150_000)
  const file = reader.writeFixture('two-way.pdf', buildAnnotatedPdf())
  const page = reader.page
  const latency: string[] = []
  await openBook(reader, file)
  await goToPage(page, 1)

  // Enable write-back (off by default) — the confirmation names what will happen.
  await openMore(page)
  const toggle = page.getByRole('menuitemcheckbox', { name: /Sync annotations into this PDF file/ })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  const dialog = page.getByRole('alertdialog', { name: 'Sync annotations into this PDF file?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Write into the PDF' }).click()
  await expect(page.getByText('Annotations will be written into this PDF file.')).toBeVisible()

  // 1. A highlight made in Readmate is written into the file.
  let t = Date.now()
  await highlightLine(page, 1, 3)
  await expect.poll(async () => (await fileAnnotations(file)).filter((a) => a.subtype === 'Highlight').length, { timeout: 15_000, intervals: [100] }).toBe(1)
  latency.push(`Readmate add → file: ${Date.now() - t} ms`)
  const [written] = await fileAnnotations(file)
  expect(written!.nm).toMatch(/^readmate:/)
  expect(written!.color).toBe('#FFEB3B')

  // 2. Recolored in Readmate → the same annotation is rewritten in the file.
  await openMore(page)
  await page.keyboard.press('Escape')
  await chooseSelectTool(page)
  const mark = pdfPage(page, 1).locator('.rb-pdf-annot[data-kind="highlight"]')
  const box = (await mark.boundingBox())!
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
  const popup = page.getByRole('dialog', { name: 'Edit highlight' })
  await expect(popup).toBeVisible()
  t = Date.now()
  await popup.getByRole('button', { name: 'Blue', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await fileAnnotations(file)).map((a) => a.color), { timeout: 15_000, intervals: [100] }).toEqual(['#4FC3F7'])
  latency.push(`Readmate recolor → file: ${Date.now() - t} ms`)

  // 3. "Another app" recolors it and adds a comment (rewrites the file, same /NM) → the reader updates.
  const nm = (await fileAnnotations(file))[0]!.nm
  t = Date.now()
  writeFileSync(
    file,
    buildAnnotatedPdf({ annotations: [{ page: 1, subtype: 'Highlight', lines: [3], color: [1, 0, 0], nm, contents: 'from the other app' }], padObjects: 4 }),
  )
  await expect
    .poll(() => mark.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--rb-annot-color')), { timeout: 15_000, intervals: [50] })
    .toBe('#FF0000')
  latency.push(`external recolor → Readmate: ${Date.now() - t} ms`)
  // Not written back (no loop): the file is exactly what the other app saved.
  await page.waitForTimeout(1500)
  expect(await fileAnnotations(file)).toEqual([{ subtype: 'Highlight', nm, color: '#FF0000', contents: 'from the other app' }])

  // 4. Deleted in Readmate → removed from the file.
  const box2 = (await mark.boundingBox())!
  await page.mouse.click(box2.x + box2.width - 4, box2.y + box2.height / 2)
  await expect(popup).toBeVisible()
  t = Date.now()
  await popup.getByRole('button', { name: /Delete/ }).click()
  await expect.poll(async () => (await fileAnnotations(file)).length, { timeout: 15_000, intervals: [100] }).toBe(0)
  latency.push(`Readmate delete → file: ${Date.now() - t} ms`)
  await expect(mark).toHaveCount(0)

  test.info().annotations.push({ type: 'latency', description: latency.join('; ') })
  console.log('[two-way latency]', latency.join(' | '))
})
