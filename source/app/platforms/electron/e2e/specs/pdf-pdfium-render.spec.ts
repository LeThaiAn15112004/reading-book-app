import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { buildAnnotatedPdf } from '../support/build-annotated-pdf.mjs'
import { textPdfLine } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * Cross-reader check (phase 4, docs/implementation_plan/pdf_annotation_reader_compatibility.md):
 * annotations Readmate writes are rendered by a SECOND, independent PDF engine — PDFium, the engine of
 * Chromium / Edge's PDF viewer, which Electron ships — not only by pdf.js. The exported file is opened
 * in Electron's built-in PDF viewer (`plugins: true`), captured, and its pixels are compared with the
 * same file before export. The captures are attached for inspection.
 */

async function markLine(page: Page, n: number, line: number, action: string) {
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
  await menu.getByRole('menuitem', { name: action, exact: true }).click()
}

type Census = { yellow: number; red: number; blue: number; total: number }

/** Open `file` in Electron's PDFium viewer, capture it (PNG to `pngOut`), count marker-colored pixels. */
async function renderWithPdfium(app: ElectronApplication, file: string, pngOut: string): Promise<Census> {
  const result = await app.evaluate(async ({ BrowserWindow }, pdf) => {
    const win = new BrowserWindow({ width: 900, height: 1100, show: true, webPreferences: { plugins: true } })
    await win.loadFile(pdf)
    await new Promise((r) => setTimeout(r, 4000)) // let the viewer lay out and rasterize page 1
    const image = await win.webContents.capturePage()
    win.destroy()
    const { width, height } = image.getSize()
    const bgra = image.toBitmap()
    let yellow = 0
    let red = 0
    let blue = 0
    for (let i = 0; i < bgra.length; i += 4) {
      const b = bgra[i]!
      const g = bgra[i + 1]!
      const r = bgra[i + 2]!
      if (r > 230 && g > 200 && g < 245 && b < 120) yellow++ // #FFEB3B multiplied over white paper
      if (r > 200 && g < 80 && b < 80) red++
      if (r < 80 && g < 80 && b > 200) blue++
    }
    return { png: image.toPNG().toString('base64'), census: { yellow, red, blue, total: width * height } }
  }, file)
  writeFileSync(pngOut, Buffer.from(result.png, 'base64'))
  return result.census
}

test('annotations written by Readmate are rendered by PDFium (Chromium / Edge engine), not only pdf.js', async ({ reader }) => {
  test.setTimeout(150_000)
  const source = buildAnnotatedPdf()
  const file = reader.writeFixture('pdfium.pdf', source)
  // Write-back is always on, so the book file itself gets the annotations. A pristine copy of the
  // original bytes is the "before" picture.
  const pristine = reader.writeFixture('pdfium-pristine.pdf', source)
  const target = path.join(reader.workDir, 'pdfium-exported.pdf')
  await reader.app.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof dialog.showSaveDialog
  }, target)

  const page = reader.page
  await openBook(reader, file)
  await goToPage(page, 1)
  await markLine(page, 1, 2, 'Highlight') // yellow by default
  await markLine(page, 1, 4, 'Underline')
  await markLine(page, 1, 6, 'Strikethrough')
  await expect(pdfPage(page, 1).locator('.rb-pdf-annot')).toHaveCount(3)

  // Recolor the underline blue and the strikethrough… keep defaults simple: export as is.
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await page.getByRole('button', { name: 'Export PDF with annotations', exact: true }).click()
  await expect(page.getByText(/Exported “pdfium-exported\.pdf”/)).toBeVisible({ timeout: 20_000 })
  expect(readFileSync(target).length).toBeGreaterThan(source.length)
  // …and the book file was written by write-back (3 annotations appended after the original bytes).
  await expect.poll(() => readFileSync(file).length, { timeout: 15_000, intervals: [100] }).toBeGreaterThan(source.length)

  const before = await renderWithPdfium(reader.app, pristine, test.info().outputPath('pdfium-source.png'))
  const after = await renderWithPdfium(reader.app, target, test.info().outputPath('pdfium-exported.png'))
  const book = await renderWithPdfium(reader.app, file, test.info().outputPath('pdfium-book.png'))
  await test.info().attach('pdfium-source', { path: test.info().outputPath('pdfium-source.png'), contentType: 'image/png' })
  await test.info().attach('pdfium-exported', { path: test.info().outputPath('pdfium-exported.png'), contentType: 'image/png' })
  console.log('[pdfium census] source', JSON.stringify(before), 'exported', JSON.stringify(after), 'book file', JSON.stringify(book))

  // The viewer actually rendered a page (not a blank / error view).
  expect(before.total).toBeGreaterThan(100_000)
  // The highlight shows up in PDFium's rendering of the exported file, and not in the source.
  expect(before.yellow).toBeLessThan(50)
  expect(after.yellow).toBeGreaterThan(before.yellow + 500)
  // The write-back in the book file itself renders the same way in PDFium.
  expect(book.yellow).toBeGreaterThan(before.yellow + 500)
})

/**
 * Optional: render every page of the manual compatibility kit (`npm run spike:pdf:compat-kit -- <dir>`)
 * with PDFium, for visual inspection of rotated / cropped pages and notes. Set READMATE_COMPAT_KIT=<dir>.
 */
test('compatibility kit pages render in PDFium (optional, READMATE_COMPAT_KIT)', async ({ reader }) => {
  const kit = process.env.READMATE_COMPAT_KIT
  test.skip(!kit, 'READMATE_COMPAT_KIT not set')
  const file = path.join(kit!, 'readmate-written.pdf')
  for (const pageNumber of [1, 2, 3]) {
    const png = test.info().outputPath(`kit-page-${pageNumber}.png`)
    const shot = await reader.app.evaluate(async ({ BrowserWindow }, { pdf, pageNumber }) => {
      const win = new BrowserWindow({ width: 900, height: 1100, show: true, webPreferences: { plugins: true } })
      await win.loadURL(`file:///${pdf.split(String.fromCharCode(92)).join('/')}#page=${pageNumber}`)
      await new Promise((r) => setTimeout(r, 4000))
      const image = await win.webContents.capturePage()
      win.destroy()
      return image.toPNG().toString('base64')
    }, { pdf: file, pageNumber })
    writeFileSync(png, Buffer.from(shot, 'base64'))
    await test.info().attach(`kit-page-${pageNumber}`, { path: png, contentType: 'image/png' })
  }
})
