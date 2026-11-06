import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { expect, test } from '../fixtures/app'
import {
  HOSTILE_TEXT,
  TXT_CANON,
  TXT_LAST_LINE,
  TXT_TITLE_LINE,
  buildHostileTxtBytes,
  buildTxtBytes,
} from '../support/build-txt-fixtures.mjs'
import { backdrop, bookIdOf, editor, marks, openTxt, storedDocument, textOf } from '../support/txt'

/**
 * TXT reader (docs/implementation_plan/txt_reader.md), driven in the BUILT Electron app on a
 * throw-away userData folder and generated fixtures. The window is hidden (rendered off-screen) —
 * see `launchApp` in e2e/fixtures/app.ts.
 *
 * Flow A — open and read.
 */

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('A: a UTF-8 BOM + CRLF Vietnamese file renders as text, scrolls, and the original file is never touched', async ({
  reader,
}) => {
  const { page } = reader
  const bytes = buildTxtBytes()
  const file = await openTxt(reader, 'doc-vi.txt', bytes)
  const mtime = statSync(file).mtimeMs

  // The text box holds the canonical text: no BOM, LF only, accents / emoji / blank lines intact.
  const value = await textOf(page)
  expect(value).toBe(TXT_CANON)
  expect(value.charCodeAt(0)).not.toBe(0xfeff)
  expect(value).not.toContain('\r')
  expect(value).toContain('Trời hôm nay rất đẹp, tôi đi dạo trong công viên 🌳')
  expect(value.split('\n').length).toBeGreaterThan(160)

  // It is real, selectable, editable text — a <textarea>, one line per source line, no HTML.
  await expect(editor(page)).toBeEditable()
  await expect(editor(page)).toHaveAttribute('aria-label', 'Book text')
  await expect(editor(page)).toContainText(TXT_TITLE_LINE) // textarea text content = its initial value

  // The backdrop layer (marks / measuring) carries the very same characters, and nothing else.
  expect(await backdrop(page).evaluate((el) => el.textContent)).toBe(TXT_CANON)

  // Continuous vertical scroll: the page is taller than the viewport and moves; progress follows.
  const metrics = () =>
    page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('[data-txt-surface]')!
      return { top: s.scrollTop, height: s.scrollHeight, view: s.clientHeight }
    })
  const before = await metrics()
  expect(before.height).toBeGreaterThan(before.view * 3)
  expect(before.top).toBe(0)
  await expect(page.getByRole('slider', { name: 'Reading progress' })).toHaveAttribute('aria-valuenow', '0')
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-txt-surface]')!
    s.scrollTop = s.scrollHeight
  })
  await expect.poll(async () => (await metrics()).top).toBeGreaterThan(before.height / 2)
  const progress = page.getByRole('slider', { name: 'Reading progress' })
  await expect(progress).toHaveAttribute('aria-valuenow', '100')
  // The last line is on screen after scrolling to the bottom.
  const lastLine = await backdrop(page).evaluate((root, text) => {
    const node = root.firstChild!.firstChild as Text
    const at = node.data.lastIndexOf(text)
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + text.length)
    const rect = range.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, view: window.innerHeight }
  }, TXT_LAST_LINE)
  expect(lastLine.top).toBeGreaterThan(0)
  expect(lastLine.bottom).toBeLessThan(lastLine.view)

  // No save was ever needed: still the original, byte for byte, same mtime.
  expect(sha(readFileSync(file))).toBe(sha(bytes))
  expect(statSync(file).mtimeMs).toBe(mtime)
  await expect(page.locator('[data-txt-save-status]')).toHaveAttribute('data-txt-save-status', 'saved')
  await page.screenshot({ path: test.info().outputPath('txt-open.png') })
})

test('A: text that looks like HTML / script is shown as text and never runs', async ({ reader }) => {
  const { page } = reader
  await openTxt(reader, 'hostile.txt', buildHostileTxtBytes())
  expect(await textOf(page)).toBe(HOSTILE_TEXT)
  expect(await page.evaluate(() => (window as unknown as { __txtPwned?: number }).__txtPwned)).toBeUndefined()
  // No element was created from the file's markup anywhere in the reading surface.
  const created = await page.locator('[data-txt-surface]').evaluate((el) => ({
    scripts: el.querySelectorAll('script').length,
    images: el.querySelectorAll('img').length,
    bold: el.querySelectorAll('b').length,
  }))
  expect(created).toEqual({ scripts: 0, images: 0, bold: 0 })
  expect(await backdrop(page).evaluate((el) => el.textContent)).toBe(HOSTILE_TEXT)
})

test('A: an empty file opens as empty text with nothing to save', async ({ reader }) => {
  const { page } = reader
  await openTxt(reader, 'empty.txt', Buffer.alloc(0))
  expect(await textOf(page)).toBe('')
  const id = await bookIdOf(page)
  const stored = await storedDocument(page, id)
  expect(stored).toMatchObject({ ok: true, text: '', revision: 0, edited: false })
  await expect(marks(page)).toHaveCount(0)
})
