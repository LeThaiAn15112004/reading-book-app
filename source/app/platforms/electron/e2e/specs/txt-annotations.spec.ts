import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { TXT_CANON, TXT_QUOTE_A, TXT_QUOTE_B, TXT_QUOTE_C, buildTxtBytes } from '../support/build-txt-fixtures.mjs'
import {
  bookIdOf,
  boxOf,
  editedCopyFiles,
  editor,
  markTexts,
  marks,
  menuAction,
  openTxt,
  scrollToOffset,
  select,
  storedDocument,
  textOf,
  toggleTool,
  waitForTxt,
  waitSaved,
} from '../support/txt'
import { pdfPage } from '../support/reader'

/**
 * Flow C — Highlight / Underline / Strikethrough / Note on TXT text: created from the selection menu
 * and from the toolbar tools, painted on the text, listed in the sidebar, restored after a restart.
 * Flow D — what an edit does to annotations: moved, kept or removed, never orphaned.
 * Flow E — EPUB / PDF still open next to TXT, and removing a TXT book cleans up after it.
 */

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

const offsetOf = (needle: string, text = TXT_CANON) => {
  const at = text.indexOf(needle)
  if (at < 0) throw new Error(`not in text: ${needle}`)
  return { start: at, end: at + needle.length }
}

/** Every stored row sits exactly on the quote it was made on, and the quote is in the current text. */
function expectConsistent(stored: Awaited<ReturnType<typeof storedDocument>>) {
  for (const h of stored.highlights) {
    expect(stored.text!.slice(h.startOffset, h.endOffset), `row ${h.id}`).toBe(h.quote)
  }
}

const style = (page: Page, index: number) =>
  marks(page)
    .nth(index)
    .evaluate((el) => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, line: s.textDecorationLine, lineStyle: s.textDecorationStyle }
    })

/** Press at the start of `[start, end)`, drag to its end, release — a real mouse selection. */
async function dragSelect(page: Page, start: number, end: number) {
  await scrollToOffset(page, start)
  const from = await boxOf(page, start, start + 1)
  const to = await boxOf(page, end - 1, end)
  await page.mouse.move(from.x + 1, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width - 1, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('C: highlight, underline, strikethrough and note — created, painted, listed, and restored after a restart', async ({
  reader,
}) => {
  test.setTimeout(240_000)
  let { page } = reader
  await openTxt(reader, 'annotate.txt', buildTxtBytes())
  const id = await bookIdOf(page)
  const A = offsetOf(TXT_QUOTE_A)
  const B = offsetOf(TXT_QUOTE_B)
  const C = offsetOf(TXT_QUOTE_C)
  const D = offsetOf('Trời hôm nay')

  // Highlight and Underline through the right-click selection menu.
  await menuAction(page, A.start, A.end, 'Highlight')
  await expect(marks(page)).toHaveCount(1)
  await menuAction(page, B.start, B.end, 'Underline')
  await expect(marks(page)).toHaveCount(2)

  // Strikethrough with the toolbar tool and a real mouse drag (the text box turns read-only while a tool is armed).
  await toggleTool(page, 'Strikethrough', true)
  await expect(editor(page)).not.toBeEditable()
  await dragSelect(page, C.start, C.end)
  await expect(marks(page)).toHaveCount(3)
  await toggleTool(page, 'Strikethrough', false)
  await expect(editor(page)).toBeEditable()

  // A note: menu → Add note → type → Save.
  await menuAction(page, D.start, D.end, 'Add note')
  const noteDialog = page.getByRole('dialog', { name: 'Note' })
  await expect(noteDialog).toBeVisible()
  await noteDialog.locator('textarea').fill('ghi chú của tôi: 🌟 điều này quan trọng')
  await noteDialog.getByRole('button', { name: 'Save' }).click()
  await expect(noteDialog).toHaveCount(0)
  await expect(marks(page)).toHaveCount(4)

  // Each mark sits on exactly its text and is drawn the way its kind says.
  const order = [A, D, B, C].sort((a, b) => a.start - b.start) // marks come out in text order
  expect(await markTexts(page)).toEqual(order.map((r) => TXT_CANON.slice(r.start, r.end)))
  const byStart = new Map(order.map((r, i) => [r.start, i]))
  const hi = await style(page, byStart.get(A.start)!)
  expect(hi.bg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  const note = await style(page, byStart.get(D.start)!)
  expect(note.line).toContain('underline')
  expect(note.lineStyle).toBe('dotted')
  const under = await style(page, byStart.get(B.start)!)
  expect(under.line).toContain('underline')
  expect(under.lineStyle).toBe('solid')
  const strike = await style(page, byStart.get(C.start)!)
  expect(strike.line).toContain('line-through')

  // The stored rows: kind, exact offsets, quote (and the note text).
  await waitSaved(page)
  let stored = await storedDocument(page, id)
  expect(stored.revision).toBe(0) // annotating alone never creates an edited copy
  expect(editedCopyFiles(reader.userData, id)).toEqual([])
  expect(stored.highlights.map((h) => [h.styleKind, h.startOffset, h.endOffset, h.quote]).sort((x, y) => (x[1] as number) - (y[1] as number))).toEqual(
    [
      ['highlight', A.start, A.end, TXT_QUOTE_A],
      ['textbox', D.start, D.end, 'Trời hôm nay'],
      ['underline', B.start, B.end, TXT_QUOTE_B],
      ['strikethrough', C.start, C.end, TXT_QUOTE_C],
    ].sort((x, y) => (x[1] as number) - (y[1] as number)),
  )
  expect(stored.highlights.find((h) => h.styleKind === 'textbox')!.note).toBe('ghi chú của tôi: 🌟 điều này quan trọng')
  expectConsistent(stored)

  // The Notes sidebar lists them (grouped under the single "Text" section).
  const sidebarTabs = page.getByRole('navigation', { name: 'Sidebar navigation' })
  await sidebarTabs.getByRole('button', { name: 'Notes', exact: true }).click()
  const sidebar = page.getByRole('complementary')
  await expect(sidebar.getByRole('heading', { name: 'Notes' })).toBeVisible()
  await sidebar.getByRole('button', { name: /^Text / }).click()
  await expect(sidebar.getByText(`“${TXT_QUOTE_A}”`)).toBeVisible()
  await expect(sidebar.getByText('ghi chú của tôi: 🌟 điều này quan trọng')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('txt-annotations.png') })

  // A click on an annotation in the sidebar scrolls to it from far away.
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('[data-txt-surface]')!
    s.scrollTop = s.scrollHeight
  })
  await sidebar.getByText(`“${TXT_QUOTE_A}”`).click()
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('[data-txt-surface]')!.scrollTop)).toBeLessThan(300)

  // Restart: everything comes back, including the note.
  await page.waitForTimeout(800)
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    await waitForTxt(page)
    await expect(marks(page)).toHaveCount(4)
    expect(await markTexts(page)).toEqual(order.map((r) => TXT_CANON.slice(r.start, r.end)))
    stored = await storedDocument(page, id)
    expectConsistent(stored)
    expect(stored.highlights).toHaveLength(4)
    // Click the note: its text is in the popup.
    await scrollToOffset(page, D.start)
    const box = await boxOf(page, D.start, D.start + 4)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('dialog', { name: 'Note' }).locator('textarea')).toHaveValue('ghi chú của tôi: 🌟 điều này quan trọng')
  } finally {
    await app.close().catch(() => {})
  }
})

test('D: an edit before, after or inside an annotation — moved, kept or removed; nothing else is touched; no orphans', async ({
  reader,
}) => {
  test.setTimeout(300_000)
  let { page } = reader
  const bytes = buildTxtBytes()
  const file = await openTxt(reader, 'rules.txt', bytes)
  const id = await bookIdOf(page)
  let text = TXT_CANON
  const quotes = ['Chương 1: Khởi đầu', 'Trời hôm nay', 'NEEDLE', 'Câu cuối cùng', 'Dòng số 010']
  const [qa, qd, qb, qc, qe] = quotes
  // Annotate every quote; B is a note (so removal must also drop its note text).
  for (const q of quotes) {
    const r = offsetOf(q)
    await menuAction(page, r.start, r.end, q === qb ? 'Add note' : 'Highlight')
    if (q === qb) {
      const dialog = page.getByRole('dialog', { name: 'Note' })
      await dialog.locator('textarea').fill('note on NEEDLE')
      await dialog.getByRole('button', { name: 'Save' }).click()
    }
  }
  await expect(marks(page)).toHaveCount(5)
  await waitSaved(page)

  const expectState = async (label: string, wanted: string[]) => {
    await waitSaved(page)
    const stored = await storedDocument(page, id)
    expect(stored.text, label).toBe(text)
    expectConsistent(stored)
    // Rows in the database = marks on screen = the quotes that should still exist (no orphans).
    expect(stored.highlights.map((h) => h.quote).sort(), `${label}: stored`).toEqual([...wanted].sort())
    expect((await markTexts(page)).sort(), `${label}: painted`).toEqual([...wanted].sort())
    // Every surviving row points at its own quote in the CURRENT text.
    for (const h of stored.highlights) expect(text.indexOf(h.quote!)).toBeGreaterThanOrEqual(0)
  }
  const edit = async (offset: number, insert: string) => {
    await select(page, offset)
    await page.keyboard.type(insert)
    text = text.slice(0, offset) + insert + text.slice(offset)
  }

  // 1. Before every annotation: all five survive, all five moved by one character.
  const beforeOffsets = (await storedDocument(page, id)).highlights.map((h) => [h.quote, h.startOffset] as const)
  await edit(0, 'Z')
  await expectState('insert at the very start', quotes)
  const moved = (await storedDocument(page, id)).highlights.map((h) => [h.quote, h.startOffset] as const)
  for (const [quote, start] of beforeOffsets) {
    expect(moved.find(([q]) => q === quote)![1], quote!).toBe(start + 1)
  }

  // 2. After every annotation: nothing changes.
  const afterOffsets = (await storedDocument(page, id)).highlights.map((h) => [h.quote, h.startOffset, h.endOffset] as const)
  await edit(text.length, '\nthe end')
  await expectState('insert at the end', quotes)
  expect((await storedDocument(page, id)).highlights.map((h) => [h.quote, h.startOffset, h.endOffset] as const)).toEqual(afterOffsets)

  // 3. Exactly at an annotation's edges: typing right AFTER it leaves it alone (it does not grow),
  //    typing right BEFORE it moves it (it is not removed).
  const dEnd = offsetOf(qd!, text).end
  await edit(dEnd, '!')
  await expectState('type right after an annotation', quotes)
  const eStart = offsetOf(qe!, text).start
  await edit(eStart, '>')
  await expectState('type right before an annotation', quotes)
  expect((await storedDocument(page, id)).highlights.find((h) => h.quote === qd)!.endOffset).toBe(dEnd)

  // 4. Inside ONE annotation (the note): only that one goes, with its note.
  const inside = offsetOf(qb!, text).start + 3
  await edit(inside, 'ZZ')
  await expectState('type inside an annotation', [qa!, qd!, qc!, qe!])
  await expect(page.getByText('note on NEEDLE')).toHaveCount(0)

  // 5. One edit that touches several annotations at once (select from inside D to inside C and delete).
  const from = offsetOf(qd!, text).start + 4
  const to = offsetOf(qc!, text).start + 4
  await select(page, from, to)
  const removedText = text.slice(from, to)
  await page.keyboard.press('Delete')
  text = text.slice(0, from) + text.slice(to)
  expect(removedText.length).toBeGreaterThan(20)
  await expectState('delete across two annotations', [qa!, qe!])

  // 6. Undo brings the text AND the annotations it removed back; redo removes them again.
  await page.keyboard.press('Control+z')
  text = text.slice(0, from) + removedText + text.slice(from)
  await expectState('undo of the multi-annotation delete', [qa!, qd!, qc!, qe!])
  await page.keyboard.press('Control+y')
  text = text.slice(0, from) + text.slice(from + removedText.length)
  await expectState('redo of the multi-annotation delete', [qa!, qe!])

  // 7. The edited text and the annotations survive a restart together.
  await page.waitForTimeout(800)
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    await waitForTxt(page)
    expect(await textOf(page)).toBe(text)
    await expect(marks(page)).toHaveCount(2)
    const stored = await storedDocument(page, id)
    expect(stored.text).toBe(text)
    expectConsistent(stored)
    expect(stored.highlights.map((h) => h.quote).sort()).toEqual([qa, qe].sort())
    expect(sha(readFileSync(file))).toBe(sha(bytes))
  } finally {
    await app.close().catch(() => {})
  }
})

test('E: EPUB, PDF and TXT live side by side; removing the TXT book deletes only its own data', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  const library = () =>
    page.getByRole('link', { name: 'Library', exact: true }).or(page.getByRole('button', { name: 'Library', exact: true })).first()

  // TXT with an edit and an annotation.
  await openTxt(reader, 'mixed.txt', buildTxtBytes())
  const txtId = await bookIdOf(page)
  const a = offsetOf(TXT_QUOTE_A)
  await menuAction(page, a.start, a.end, 'Highlight')
  await select(page, 0)
  await page.keyboard.type('E2E ')
  await waitSaved(page)
  expect(editedCopyFiles(reader.userData, txtId)).toHaveLength(1)

  // EPUB opens and reads.
  await library().click()
  await reader.importBook(reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Chapter One' })).toBeVisible({ timeout: 30_000 })

  // PDF opens and reads.
  await library().click()
  await reader.importBook(reader.writeFixture('sample.pdf', buildTextPdf()))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(pdfPage(page, 1).locator('.textLayer span').first()).toBeVisible({ timeout: 30_000 })

  // The library has the three books; the TXT one has its stored rows.
  const books = await page.evaluate(async () => {
    const api = (window as unknown as { api: { library: { listBooks(): Promise<Array<{ id: string; format: string }>> } } }).api
    return (await api.library.listBooks()).map((b) => ({ id: b.id, format: b.format }))
  })
  expect(books.map((b) => b.format).sort()).toEqual(['epub', 'pdf', 'txt'])
  expect((await storedDocument(page, txtId)).highlights).toHaveLength(1)

  // Remove the TXT book (the same IPC the Library menu uses): rows cascade, the edited copy folder goes.
  await page.evaluate(async (bookId) => {
    const api = (window as unknown as { api: { library: { removeBook(id: string): Promise<{ ok: boolean }> } } }).api
    const result = await api.library.removeBook(bookId)
    if (!result.ok) throw new Error('removeBook failed')
  }, txtId)
  expect(editedCopyFiles(reader.userData, txtId)).toEqual([])
  const after = await page.evaluate(async (bookId) => {
    const api = (
      window as unknown as {
        api: {
          library: { listBooks(): Promise<Array<{ id: string; format: string }>> }
          overlay: { listHighlights(id: string): Promise<unknown[]> }
          txt: { open(id: string): Promise<{ ok: boolean; errorCode?: string }> }
        }
      }
    ).api
    return {
      formats: (await api.library.listBooks()).map((b) => b.format).sort(),
      orphans: (await api.overlay.listHighlights(bookId)).length,
      open: await api.txt.open(bookId),
    }
  }, txtId)
  expect(after.formats).toEqual(['epub', 'pdf'])
  expect(after.orphans).toBe(0)
  expect(after.open).toMatchObject({ ok: false, errorCode: 'not_found' })
  // The user's original TXT file is still where it was (removal never deletes a referenced file).
  expect(readFileSync(path.join(reader.workDir, 'mixed.txt')).length).toBeGreaterThan(1000)
})
