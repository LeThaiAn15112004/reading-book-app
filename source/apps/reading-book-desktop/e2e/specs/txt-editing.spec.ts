import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, launchApp, test } from '../fixtures/app'
import { TXT_CANON, TXT_NEEDLE_LINE, buildLongText, buildLfTxtBytes, buildTxtBytes } from '../support/build-txt-fixtures.mjs'
import {
  bookIdOf,
  editedCopyFiles,
  editedCopyText,
  editor,
  openTxt,
  saveStatus,
  scrollToOffset,
  select,
  selectionOf,
  storedDocument,
  textOf,
  waitForTxt,
  waitSaved,
} from '../support/txt'

/**
 * Flow B — type / delete / paste / undo directly in the reading surface, an honest "Saved", the
 * edited copy in Readmate's own storage (never the original file), and a full app restart.
 */

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('B: type, Enter, Backspace, delete a selection, paste, undo / redo — saved honestly, restored after a restart', async ({
  reader,
}) => {
  test.setTimeout(180_000)
  let { page } = reader
  const bytes = buildTxtBytes()
  const file = await openTxt(reader, 'edit.txt', bytes)
  const id = await bookIdOf(page)
  let expected = TXT_CANON

  // 1. Type in the middle of line 4. The caret must stay put while typing.
  const at = expected.indexOf('NEEDLE')
  await select(page, at)
  await page.keyboard.type('XYZ ')
  expected = expected.slice(0, at) + 'XYZ ' + expected.slice(at)
  expect(await textOf(page)).toBe(expected)
  expect(await selectionOf(page)).toEqual({ start: at + 4, end: at + 4 })

  // 2. "Saved" must not appear before the save really happened: right now it is pending.
  await expect(saveStatus(page)).not.toHaveAttribute('data-txt-save-status', 'saved')
  await expect(saveStatus(page)).toHaveAttribute('data-txt-save-status', /dirty|saving/)
  await waitSaved(page)

  // The save re-rendered the page; the caret did not move and typing continues exactly there.
  expect(await selectionOf(page)).toEqual({ start: at + 4, end: at + 4 })
  await page.keyboard.type('Q')
  expected = expected.slice(0, at + 4) + 'Q' + expected.slice(at + 4)
  expect(await textOf(page)).toBe(expected)

  // 3. Enter (a new line), then Backspace twice: the new line and the "Q" are gone again.
  await page.keyboard.press('Enter')
  expect(await textOf(page)).toBe(expected.slice(0, at + 5) + '\n' + expected.slice(at + 5))
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  expected = expected.slice(0, at + 4) + expected.slice(at + 5)
  expect(await textOf(page)).toBe(expected)

  // 4. Accents typed as text input.
  await page.keyboard.insertText('việt ')
  expected = expected.slice(0, at + 4) + 'việt ' + expected.slice(at + 4)
  expect(await textOf(page)).toBe(expected)

  // 5. Delete a selection (the word NEEDLE) with the Delete key.
  const needle = expected.indexOf('NEEDLE')
  await select(page, needle, needle + 6)
  await page.keyboard.press('Delete')
  expected = expected.slice(0, needle) + expected.slice(needle + 6)
  expect(await textOf(page)).toBe(expected)
  await waitSaved(page)

  // 6. Paste multi-line text with accents, an emoji and a CRLF (the clipboard comes from Main).
  const before = expected
  const pasteAt = expected.indexOf('Dòng số 001')
  await scrollToOffset(page, pasteAt)
  await reader.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), 'dán 1\ndán 2 😀\r\ndán 3\n')
  await select(page, pasteAt)
  await page.keyboard.press('Control+v')
  expected = expected.slice(0, pasteAt) + 'dán 1\ndán 2 😀\ndán 3\n' + expected.slice(pasteAt)
  expect(await textOf(page)).toBe(expected)
  await waitSaved(page)

  // 7. What is stored is the edited copy: Readmate's own folder, UTF-8 + LF, revision > 0 …
  const stored = await storedDocument(page, id)
  expect(stored.ok).toBe(true)
  expect(stored.text).toBe(expected)
  expect(stored.edited).toBe(true)
  expect(stored.revision).toBeGreaterThan(0)
  expect(editedCopyFiles(reader.userData, id)).toEqual([`r${stored.revision}.txt`])
  expect(editedCopyText(reader.userData, id, stored.revision)).toBe(expected)
  // … and the user's own file is exactly what it was.
  expect(sha(readFileSync(file))).toBe(sha(bytes))

  // 8. Undo the paste, redo it; the stored copy follows each step.
  await select(page, pasteAt) // keep focus in the box
  await page.keyboard.press('Control+z')
  expect(await textOf(page)).toBe(before)
  await waitSaved(page)
  expect((await storedDocument(page, id)).text).toBe(before)
  await page.keyboard.press('Control+y')
  expect(await textOf(page)).toBe(expected)
  await waitSaved(page)
  expect((await storedDocument(page, id)).text).toBe(expected)

  // 9. Scroll somewhere, then restart the whole app on the same data.
  const farOffset = expected.indexOf('Dòng số 120')
  await scrollToOffset(page, farOffset)
  const scrollBefore = await page.evaluate(() => document.querySelector<HTMLElement>('[data-txt-surface]')!.scrollTop)
  expect(scrollBefore).toBeGreaterThan(500)
  await page.waitForTimeout(1500) // the reading position autosave debounces
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    await waitForTxt(page)
    // The edits are back …
    expect(await textOf(page)).toBe(expected)
    // … the reading position is back (the top line is the same, give or take a line) …
    await expect
      .poll(() => page.evaluate(() => document.querySelector<HTMLElement>('[data-txt-surface]')!.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(scrollBefore - 60)
    const scrollAfter = await page.evaluate(() => document.querySelector<HTMLElement>('[data-txt-surface]')!.scrollTop)
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(60)
    // … and the reading position did not overwrite the text.
    const again = await storedDocument(page, id)
    expect(again.text).toBe(expected)
    expect(sha(readFileSync(file))).toBe(sha(bytes))
  } finally {
    await app.close().catch(() => {})
  }
})

test('B: composing a Vietnamese word (IME events) becomes one edit and one undo step', async ({ reader }) => {
  const { page } = reader
  await openTxt(reader, 'ime.txt', buildLfTxtBytes('Xin chào\nthế giới\n'))
  const base = 'Xin chào\n'.length
  // The event sequence of a Telex composition: start, a growing composing string, end.
  await editor(page).evaluate((el, at) => {
    const ta = el as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(at, at)
    ta.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    let composing = ''
    for (const step of ['v', 'vi', 'viê', 'việ', 'việt']) {
      ta.setRangeText(step, at, at + composing.length, 'end')
      composing = step
      ta.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: step, isComposing: true }))
    }
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: 'việt' }))
  }, base)
  expect(await textOf(page)).toBe('Xin chào\nviệtthế giới\n')
  await expect(saveStatus(page)).toHaveAttribute('data-txt-save-status', /dirty|saving|saved/)
  await waitSaved(page)
  expect((await storedDocument(page, await bookIdOf(page))).text).toBe('Xin chào\nviệtthế giới\n')
  // One undo removes the whole composed word, not a letter at a time.
  await page.keyboard.press('Control+z')
  expect(await textOf(page)).toBe('Xin chào\nthế giới\n')
})

test('B: a file longer than the edit limit opens read-only (it can still be read)', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  await openTxt(reader, 'huge.txt', buildLfTxtBytes(buildLongText(1_000_000)))
  await expect(editor(page)).not.toBeEditable()
  const value = await textOf(page)
  expect(value.length).toBeGreaterThan(900_000)
  await select(page, 10)
  await page.keyboard.type('nope')
  expect(await textOf(page)).toBe(value)
  // Nothing to save, so no save indicator is shown at all.
  await expect(saveStatus(page)).toHaveCount(0)
})

test('B: speed on the longest editable file — open time and typing stay usable', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page } = reader
  // Just under TXT_EDIT_MAX_CHARS (400 000).
  const text = buildLongText(380_000)
  const started = Date.now()
  await openTxt(reader, 'long.txt', buildLfTxtBytes(text))
  const openMs = Date.now() - started

  await select(page, 5000)
  const typed = 'abcdefghijklmnopqrst'
  const t0 = Date.now()
  await page.keyboard.type(typed)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const perKey = (Date.now() - t0) / typed.length
  expect(await textOf(page)).toBe(text.slice(0, 5000) + typed + text.slice(5000))
  await waitSaved(page)

  const info = `${text.length} chars: open ${openMs} ms, typing ${perKey.toFixed(1)} ms/key`
  test.info().annotations.push({ type: 'perf', description: info })
  console.log(`[txt perf] ${info}`)
  // Generous ceilings: the point is "no multi-second stalls", the numbers go in the docs.
  expect(openMs).toBeLessThan(15_000)
  expect(perKey).toBeLessThan(250)
})

test('B: the line containing the caret stays editable after a save re-renders the page (no caret jump)', async ({
  reader,
}) => {
  const { page } = reader
  await openTxt(reader, 'caret.txt', buildLfTxtBytes(`${TXT_NEEDLE_LINE}\nsecond line\n`))
  await select(page, 4)
  for (const ch of 'abc') {
    await page.keyboard.type(ch)
    await waitSaved(page) // a save (and its re-render) between every key
  }
  expect(await textOf(page)).toBe(`Dòng${'abc'} thứ ba có từ khóa NEEDLE ở giữa câu.\nsecond line\n`)
  expect(await selectionOf(page)).toEqual({ start: 7, end: 7 })
})

test('F: the text box and the mark layer wrap identically whatever the reading style (font, size, weight, spacing, alignment, margins)', async ({
  reader,
}) => {
  test.setTimeout(120_000)
  const { page } = reader
  await openTxt(reader, 'layout.txt', buildTxtBytes())
  const variants: Array<Record<string, string>> = [
    {},
    { '--reader-reading-size': '26px' },
    { '--reader-reading-size': '13px', '--reader-reading-line-height': '2' },
    { '--reader-font-reading': 'ui-monospace, Consolas, monospace', '--reader-reading-size': '17px' },
    { '--reader-font-reading': 'Arial, sans-serif', '--reader-reading-weight': '600' },
    { '--reader-reading-align': 'left', '--reader-reading-size': '22px' },
    { '--reader-reading-align': 'justify', '--reader-reading-size': '19px', '--reader-reading-line-height': '1.3' },
  ]
  for (const vars of variants) {
    const result = await page.evaluate(async (css) => {
      const root = document.querySelector<HTMLElement>('[data-txt-editor]')!.closest<HTMLElement>('[style*="--reader-reading-size"]')!
      for (const [name, value] of Object.entries(css)) root.style.setProperty(name, value)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-txt-input]')!
      const bd = document.querySelector<HTMLElement>('[data-txt-backdrop]')!
      return { input: ta.scrollHeight, inputBox: ta.clientHeight, backdrop: bd.scrollHeight, widthInput: ta.clientWidth, widthBackdrop: bd.clientWidth }
    }, vars)
    const label = JSON.stringify(vars)
    expect(result.widthBackdrop, label).toBe(result.widthInput)
    expect(Math.abs(result.backdrop - result.input), `${label}: ${JSON.stringify(result)}`).toBeLessThanOrEqual(1)
    // The text box really grows with its text (no inner scrolling).
    expect(result.input, label).toBeLessThanOrEqual(result.inputBox + 1)
  }
})
