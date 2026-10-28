import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import type { DesktopApi } from '../../electron/ipc/api-types'
import { buildTextPdf, textPdfLine } from '../support/build-text-pdf.mjs'
import { TXT_CANON, TXT_QUOTE_A, TXT_QUOTE_B, buildTxtBytes } from '../support/build-txt-fixtures.mjs'
import { expect, test, type ReaderApp } from '../fixtures/app'
import { currentPageInput, goToPage, openBook, pdfPage } from '../support/reader'
import { bookIdOf, editor, marks, menuAction, openTxt, showToolbar, storedDocument, waitForTxt } from '../support/txt'

/**
 * Task T043 of specs/006-annotation-import-export — the manual pass of quickstart.md step 5, driven in the BUILT Electron app
 * (hidden window): annotate a book, use the four Reader toolbar buttons (export backup, readable copy, import), wipe the
 * annotations, reopen the book, import the file and see the annotations come back without reopening it, import twice, import
 * the readable copy (refused). Native dialogs are stubbed in Main like the other specs do. Annotations are made through the
 * reader's own UI for TXT, PDF and Markdown; for EPUB (the epub.js iframe) they are saved through the same IPC the reader uses.
 */

type WithApi = { api: DesktopApi }
const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Import annotations' })
const countIn = (page: Page, label: string): Locator => dialog(page).locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')
const toolbarButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function stubSave(reader: ReaderApp, file: string) {
  await reader.app.evaluate(({ dialog: d }, out) => {
    d.showSaveDialog = (async () => ({ canceled: false, filePath: out })) as typeof d.showSaveDialog
  }, file)
}
async function stubOpen(reader: ReaderApp, file: string) {
  await reader.app.evaluate(({ dialog: d }, picked) => {
    d.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof d.showOpenDialog
  }, file)
}

/** The annotations of the open book as the main process stores them (EPUB / PDF / Markdown rows). */
const storedRows = (page: Page, bookId: string) =>
  page.evaluate(async (id) => {
    const rows = await (window as unknown as WithApi).api.overlay.listHighlights(id)
    return rows.map((r) => ({ id: r.id, styleKind: r.styleKind, note: r.note ?? null }))
  }, bookId)

async function deleteStoredRows(page: Page, bookId: string) {
  await page.evaluate(async (id) => {
    const api = (window as unknown as WithApi).api
    for (const row of await api.overlay.listHighlights(id)) await api.overlay.deleteHighlight({ bookId: id, id: row.id })
  }, bookId)
}

/** After a reload the app lands in the Library (with "Resume") or straight in the book. */
async function reopen(page: Page, surface: Locator) {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  const resume = page.getByRole('button', { name: /^Resume/ }).first()
  await expect(resume.or(surface).first()).toBeVisible({ timeout: 25_000 })
  if (!(await surface.isVisible())) await resume.click()
  await expect(surface).toBeVisible({ timeout: 20_000 })
}

type Flow = {
  reader: ReaderApp
  /** `exported` = how many annotations the file must hold. */
  count: number
  format: 'epub' | 'pdf' | 'txt' | 'md'
  bookId: string
  /** How many of the annotations the open reader shows right now (null: not checked for this format). */
  painted: (() => Promise<number>) | null
  surface: Locator
  /** Remove every annotation of the book, the way the reader's own stores would see it. */
  wipe: () => Promise<void>
}

/** The same steps for every format: export, readable copy, wipe, reopen, import (reload), import again, readable copy refused. */
async function transferFlow(f: Flow) {
  const { reader, page } = { reader: f.reader, page: f.reader.page }
  const backup = path.join(reader.workDir, `${f.format}.readmate-notes.json`)
  const readable = path.join(reader.workDir, `${f.format}-readable.md`)

  // 1. The buttons are on the toolbar (one click), not in the More menu.
  await showToolbar(page)
  await expect(toolbarButton(page, 'Export annotations (backup)')).toBeVisible()
  await expect(toolbarButton(page, 'Export readable copy')).toBeVisible()
  await expect(toolbarButton(page, 'Import annotations')).toBeVisible()
  await page.getByRole('button', { name: 'More options' }).click()
  await expect(page.getByRole('menuitem', { name: 'Book info' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /Export annotations|Export readable|Import annotations/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // 2. Export the backup: toast with the count, a file in the throw-away folder, valid and complete.
  await stubSave(reader, backup)
  await toolbarButton(page, 'Export annotations (backup)').click()
  await expect(page.getByText(`Exported ${f.count} annotation${f.count === 1 ? '' : 's'}.`)).toBeVisible({ timeout: 20_000 })
  const file = JSON.parse(readFileSync(backup, 'utf8')) as { fileVersion: number; book: { format: string; sha256: string }; annotations: { type: string; origin: string }[] }
  expect(file.fileVersion).toBe(1)
  expect(file.book.format).toBe(f.format)
  expect(file.book.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(file.annotations).toHaveLength(f.count)
  expect(file.annotations.every((a) => a.origin === 'app')).toBe(true)

  // 3. Export the readable copy: Markdown with a heading and the quotes, never importable.
  await stubSave(reader, readable)
  await toolbarButton(page, 'Export readable copy').click()
  await expect(page.getByText(/Saved the readable copy/)).toBeVisible({ timeout: 20_000 })
  const md = readFileSync(readable, 'utf8')
  expect(md).toMatch(/^# .+\nExported \d{4}-\d{2}-\d{2} · \d+ annotations?\n/)
  expect(md).toContain('\n## ')

  // 4. Wipe the annotations and reopen the book: nothing is shown any more.
  await f.wipe()
  await page.waitForTimeout(1500) // a PDF's write-back takes the removed annotations out of the file
  await reopen(page, f.surface)
  if (f.painted) await expect.poll(f.painted).toBe(0)

  // 5. Import the backup from the toolbar: preview, then Import; the annotations come back WITHOUT reopening the book.
  await showToolbar(page)
  await stubOpen(reader, backup)
  await toolbarButton(page, 'Import annotations').click()
  await expect(dialog(page)).toBeVisible({ timeout: 20_000 })
  await expect(countIn(page, 'Will be added')).toBeVisible()
  const shown = (await dialog(page).innerText()).split('\n').map((l) => l.trim()).filter(Boolean).join(' | ')
  expect(await countIn(page, 'Will be added').innerText(), `the preview said: ${shown}; the backup file's book: ${JSON.stringify(file.book)}`).toBe(String(f.count))
  await expect(countIn(page, 'Will be added')).toHaveText(String(f.count))
  await expect(countIn(page, 'Already in the book')).toHaveText('0')
  await expect(countIn(page, 'Cannot be placed')).toHaveText('0')
  await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(new RegExp(`Imported annotations: ${f.count} added, 0 already there, 0 could not be placed`))).toBeVisible({ timeout: 20_000 })
  await expect(dialog(page)).toHaveCount(0)
  if (f.painted) await expect.poll(f.painted, { timeout: 15_000 }).toBe(f.count)

  // 6. The second import finds everything already there and adds nothing.
  await toolbarButton(page, 'Import annotations').click()
  await expect(dialog(page)).toBeVisible()
  await expect(countIn(page, 'Will be added')).toHaveText('0')
  await expect(countIn(page, 'Already in the book')).toHaveText(String(f.count))
  await dialog(page).getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Imported annotations: 0 added/)).toBeVisible({ timeout: 20_000 })
  if (f.painted) expect(await f.painted()).toBe(f.count)

  // 7. The readable copy is refused with a plain message and changes nothing.
  await stubOpen(reader, readable)
  await toolbarButton(page, 'Import annotations').click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('alert')).toContainText(/readable copy/i)
  await expect(dialog(page).getByRole('button', { name: 'Import', exact: true })).toHaveCount(0)
  await dialog(page).getByRole('button', { name: 'Close' }).click()
  await expect(dialog(page)).toHaveCount(0)
  if (f.painted) expect(await f.painted()).toBe(f.count)
}

test('TXT: export, readable copy, wipe, reopen, import (shown at once), import again, readable copy refused', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  const file = await openTxt(reader, 'transfer.txt', buildTxtBytes())
  const id = await bookIdOf(page)
  const at = (needle: string) => ({ start: TXT_CANON.indexOf(needle), end: TXT_CANON.indexOf(needle) + needle.length })
  const A = at(TXT_QUOTE_A)
  const B = at(TXT_QUOTE_B)
  await menuAction(page, A.start, A.end, 'Highlight')
  await expect(marks(page)).toHaveCount(1)
  await menuAction(page, B.start, B.end, 'Underline')
  await expect(marks(page)).toHaveCount(2)
  await expect.poll(async () => (await storedDocument(page, id)).highlights.length, { timeout: 15_000 }).toBe(2)
  const bytesBefore = readFileSync(file)

  await transferFlow({
    reader,
    count: 2,
    format: 'txt',
    bookId: id,
    surface: editor(page),
    painted: () => marks(page).count(),
    wipe: async () => {
      const doc = await storedDocument(page, id)
      const result = await page.evaluate(
        async ([bookId, revision, ids]) =>
          (window as unknown as WithApi).api.txt.commit({ bookId: bookId as string, baseRevision: revision as number, upserts: [], deletedIds: ids as string[] }),
        [id, doc.revision, doc.highlights.map((h) => h.id)] as const,
      )
      expect(result.ok).toBe(true)
    },
  })
  // the restored annotations sit on exactly the text they were made on, and the user's file was never touched
  const stored = await storedDocument(page, id)
  expect(stored.highlights.map((h) => stored.text!.slice(h.startOffset, h.endOffset)).sort()).toEqual([TXT_QUOTE_A, TXT_QUOTE_B].sort())
  expect(readFileSync(file).equals(bytesBefore)).toBe(true)
  await waitForTxt(page)
})

test('PDF: export, readable copy, wipe, reopen, import (shown at once), import again, readable copy refused', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  const file = reader.writeFixture('transfer.pdf', buildTextPdf())
  await openBook(reader, file)
  await goToPage(page, 1)
  const id = await page.evaluate(async () => (await (window as unknown as WithApi).api.library.listBooks())[0]!.id)
  const line = pdfPage(page, 1).locator('.textLayer span', { hasText: textPdfLine(1, 2) })
  await expect(line).toBeVisible()
  await page.evaluate(
    ({ n, text }) => {
      const node = Array.from(document.querySelectorAll<HTMLElement>(`[data-page-number="${n}"] .textLayer span`)).find((s) => s.textContent === text)?.firstChild
      if (!node) throw new Error('line span not found')
      const range = document.createRange()
      range.selectNodeContents(node)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
    },
    { n: 1, text: textPdfLine(1, 2) },
  )
  const box = (await line.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Selection options' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Highlight', exact: true }).click()
  const highlights = () => pdfPage(page, 1).locator('.rb-pdf-annot[data-kind="highlight"]').count()
  await expect.poll(highlights).toBe(1)
  await expect.poll(async () => (await storedRows(page, id)).length, { timeout: 15_000 }).toBe(1)

  await transferFlow({
    reader,
    count: 1,
    format: 'pdf',
    bookId: id,
    surface: currentPageInput(page),
    painted: async () => {
      await goToPage(page, 1)
      return highlights()
    },
    wipe: () => deleteStoredRows(page, id),
  })
  expect((await storedRows(page, id)).map((r) => r.styleKind)).toEqual(['highlight'])
  expect(existsSync(file)).toBe(true)
})

test('Markdown: export, readable copy, wipe, reopen, import (shown at once), import again, readable copy refused', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  const LONG = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega. '
  const markdown = ['# Transfer', '', `Paragraph 1: ${LONG.repeat(4)}`, '', `Paragraph 2: ${LONG.repeat(4)}`, ''].join('\n')
  await reader.importBook(reader.writeFixture('transfer.md', Buffer.from(markdown, 'utf8')))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  const surface = page.locator('[data-md-surface]')
  await expect(surface).toBeVisible({ timeout: 20_000 })
  const paragraph = page.locator('[data-md-content] p', { hasText: 'Paragraph 1:' })
  await expect(paragraph).toBeVisible()
  const id = await page.evaluate(async () => (await (window as unknown as WithApi).api.library.listBooks())[0]!.id)
  const painted = () =>
    page.evaluate(() => [...(CSS as unknown as { highlights: Map<string, unknown> }).highlights.keys()].filter((k) => k.startsWith('md-a-')).length)

  await showToolbar(page)
  await page.waitForTimeout(600)
  const highlight = page.getByRole('button', { name: /^Highlight/ }).first()
  await highlight.click()
  await expect(highlight).toHaveAttribute('aria-pressed', 'true')
  const line = await paragraph.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const r = range.getClientRects()[0]!
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  })
  const y = line.y + line.height / 2
  await page.mouse.move(line.x + line.width * 0.1, y)
  await page.mouse.down()
  await page.mouse.move(line.x + line.width * 0.5, y, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect.poll(painted).toBe(1)
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await storedRows(page, id)).length, { timeout: 15_000 }).toBe(1)

  await transferFlow({ reader, count: 1, format: 'md', bookId: id, surface, painted, wipe: () => deleteStoredRows(page, id) })
  const rows = await storedRows(page, id)
  expect(rows).toHaveLength(1)
})

test('EPUB: export, readable copy, wipe, import, import again (data level: the epub.js iframe is not painted-checked)', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('transfer.epub', readFileSync(sampleEpub)))
  const id = await page.evaluate(async () => (await (window as unknown as WithApi).api.library.listBooks())[0]!.id)
  await page.evaluate(async (bookId) => {
    await (window as unknown as WithApi).api.overlay.saveHighlight({
      bookId,
      locatorRef: JSON.stringify({ kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2/2,/1:0,/1:5)', chapterIndex: 0 }),
      styleKind: 'highlight',
      colorHex: '#FFEB3B',
      note: 'ghi chú EPUB',
      selectionTextRef: JSON.stringify({ highlight: 'Chapter' }),
    })
  }, id)
  await expect.poll(async () => (await storedRows(page, id)).length).toBe(1)

  await transferFlow({ reader, count: 1, format: 'epub', bookId: id, surface: currentPageInput(page), painted: null, wipe: () => deleteStoredRows(page, id) })
  const rows = await storedRows(page, id)
  expect(rows).toEqual([{ id: expect.any(String), styleKind: 'highlight', note: 'ghi chú EPUB' }])
})
