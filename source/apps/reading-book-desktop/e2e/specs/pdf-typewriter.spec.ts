import type { Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { openBook, pdfPage } from '../support/reader'

/**
 * PDF Typewriter note, phase 3 (specs/005-typewriter-note, quickstart B1–B3): a click or drag with the Typewriter
 * tool opens an in-place editor, text typed with Vietnamese letters is kept, Escape / a press elsewhere commits it as
 * ONE note that is painted from the laid-out lines, listed in Notes and stored; an empty box leaves nothing behind.
 * Real mouse and keyboard input in the built Electron app (hidden window).
 */

async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

async function armTool(page: Page) {
  await showToolbar(page)
  const tool = page.getByRole('button', { name: /^Typewriter/ }).first()
  await tool.click()
  await expect(tool).toHaveAttribute('aria-pressed', 'true')
}

const notes = (page: Page) => pdfPage(page, 1).locator('[data-tw-note]')
const editor = (page: Page) => pdfPage(page, 1).locator('[data-tw-editor] [contenteditable]')
const drawnText = async (locator: ReturnType<typeof notes>) => (await locator.locator('[data-tw-seg]').allTextContents()).join('')

async function clickAt(page: Page, x: number, y: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  await page.mouse.click(slot.x + slot.width * x, slot.y + slot.height * y)
}

test('PDF Typewriter: click, type Vietnamese, commit; empty and drag cases', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)

  // 1. A click opens the editor with a caret; text typed (Vietnamese letters, a line break) is shown as typed.
  await clickAt(page, 0.2, 0.3)
  await expect(editor(page)).toBeVisible()
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('Xin chào')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('thế giới đẹp')
  await expect(editor(page).locator('[data-tw-seg]')).toHaveCount(2)
  expect(await drawnText(pdfPage(page, 1).locator('[data-tw-editor]'))).toBe('Xin chàothế giới đẹp')

  // 2. Escape commits ONE note and keeps the tool armed.
  await page.keyboard.press('Escape')
  await expect(pdfPage(page, 1).locator('[data-tw-editor]')).toHaveCount(0)
  await expect(notes(page)).toHaveCount(1)
  expect(await drawnText(notes(page).first())).toBe('Xin chàothế giới đẹp')
  await expect(page.getByRole('button', { name: /^Typewriter/ }).first()).toHaveAttribute('aria-pressed', 'true')

  // 3. The note is stored (survives a list from Main) with its text untrimmed and one box.
  const rows = await page.evaluate(async () => {
    const books = await (window as unknown as { api: { library: { listBooks: () => Promise<{ id: string }[]> } } }).api.library.listBooks()
    const out: { styleKind: string; note?: string; ref?: string }[] = []
    for (const b of books) {
      const list = await (window as unknown as { api: { overlay: { listHighlights: (id: string) => Promise<{ styleKind: string; note?: string; pdfAnnotationRef?: string }[]> } } }).api.overlay.listHighlights(b.id)
      for (const h of list) out.push({ styleKind: h.styleKind, note: h.note, ref: h.pdfAnnotationRef })
    }
    return out
  })
  const row = rows.find((r) => r.styleKind === 'typewriter')
  expect(row?.note).toBe('Xin chào\nthế giới đẹp')
  expect(JSON.parse(row!.ref!).typewriter.v).toBe(1)

  // 4. A click, nothing typed, a press elsewhere: no empty note is created.
  await clickAt(page, 0.2, 0.42)
  await expect(editor(page)).toBeVisible()
  await clickAt(page, 0.6, 0.12)
  await expect(pdfPage(page, 1).locator('[data-tw-editor]')).toHaveCount(0)
  await expect(notes(page)).toHaveCount(1)

  // 5. A drag sizes the box; typing wraps inside it; a press elsewhere commits.
  const slot = (await pdfPage(page, 1).boundingBox())!
  console.log('DBG', JSON.stringify(slot), await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return [e?.outerHTML.slice(0, 160), document.querySelector('[data-tw-selected]')?.getBoundingClientRect().toJSON(), document.querySelector('[data-tw-toolbar]')?.getBoundingClientRect().toJSON()] }, [slot.x + slot.width * 0.1, slot.y + slot.height * 0.4]))
  await page.mouse.move(slot.x + slot.width * 0.1, slot.y + slot.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(slot.x + slot.width * 0.3, slot.y + slot.height * 0.45, { steps: 6 })
  await page.mouse.up()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.insertText('một hai ba bốn năm sáu bảy tám chín mười')
  expect(await editor(page).locator('[data-tw-line]').count()).toBeGreaterThan(1)
  await clickAt(page, 0.6, 0.12)
  await expect(notes(page)).toHaveCount(2)

  // 5b. Spaces: typed one key at a time (trailing space, then more text) they stay where they were typed.
  await clickAt(page, 0.5, 0.2)
  await expect(editor(page)).toBeFocused()
  for (const ch of 'xin chao ban ') await page.keyboard.press(ch === ' ' ? 'Space' : ch)
  await page.keyboard.type('ok')
  expect(await drawnText(pdfPage(page, 1).locator('[data-tw-editor]'))).toBe('xin chao ban ok')
  await clickAt(page, 0.6, 0.12)
  await expect(notes(page)).toHaveCount(3)

  // 6. Both are listed in Notes as Typewriter notes with their plain text (never as a text mark on the page).
  await page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'Notes', exact: true }).click()
  const sidebar = page.getByRole('complementary')
  await expect(sidebar.getByRole('heading', { name: 'Notes' })).toBeVisible()
  await sidebar.getByRole('button', { name: /^Page 1 / }).click()
  await expect(sidebar.locator('[data-note-id]')).toHaveCount(3)
  await expect(sidebar.locator('[data-note-id]').getByText('Typewriter', { exact: true })).toHaveCount(3)
  await expect(sidebar.locator('[data-note-id]').filter({ hasText: 'thế giới đẹp' })).toHaveCount(1)
  await expect(pdfPage(page, 1).locator('.rb-pdf-annot')).toHaveCount(0)
})

const selected = (page: Page) => pdfPage(page, 1).locator('[data-tw-selected]')
const boxOf = async (page: Page) =>
  notes(page).first().evaluate((el) => {
    const s = (el as HTMLElement).style
    return { left: parseFloat(s.left), top: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height) }
  })

async function chooseMode(page: Page, name: 'Hand' | 'Select') {
  await showToolbar(page)
  await page.getByRole('button', { name, exact: true }).first().click()
}

test('PDF Typewriter: select, move, resize, edit, delete — each one undo step (Select and Hand)', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter-edit.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)
  await clickAt(page, 0.2, 0.2)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('Alpha beta gamma')
  await page.keyboard.press('Escape')
  await expect(notes(page)).toHaveCount(1)

  // 1. Select mode: one click selects (outline, 8 handles, toolbar); a click on blank page deselects.
  await chooseMode(page, 'Select')
  const start = await boxOf(page)
  const slot = (await pdfPage(page, 1).boundingBox())!
  const at = (fx: number, fy: number) => ({ x: slot.x + slot.width * fx, y: slot.y + slot.height * fy })
  const inside = at((start.left + start.width / 2) / 100, (start.top + 1) / 100)
  await page.mouse.click(inside.x, inside.y)
  await expect(selected(page)).toBeVisible()
  await expect(selected(page).locator('[data-tw-handle]')).toHaveCount(8)
  await expect(selected(page).getByRole('button', { name: 'Delete note' })).toBeVisible()

  // 2. Drag the body: the note moves (clamped inside the page), as ONE undo step; Ctrl+Z puts it back.
  await page.mouse.move(inside.x, inside.y)
  await page.mouse.down()
  await page.mouse.move(inside.x + 60, inside.y + 40, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(page)).left).toBeGreaterThan(start.left + 3)
  await expect.poll(async () => (await boxOf(page)).top).toBeGreaterThan(start.top + 3)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => Math.round((await boxOf(page)).left * 10)).toBe(Math.round(start.left * 10))

  // 3. Resize with the east handle: wider; the width never goes below the minimum (4 %).
  const handle = selected(page).locator('[data-tw-handle="e"]')
  const hb = (await handle.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + 80, hb.y + hb.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(page)).width).toBeGreaterThan(start.width + 5)
  const hb2 = (await selected(page).locator('[data-tw-handle="e"]').boundingBox())!
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb2.x - 2000, hb2.y + hb2.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await boxOf(page)).width).toBeLessThan(5.01)
  expect((await boxOf(page)).width).toBeGreaterThanOrEqual(3.99)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await boxOf(page)).width).toBeGreaterThan(start.width + 5)

  // 4. Double-click edits in place; the typed text replaces the note on Escape; the note stays selected.
  await page.mouse.dblclick(...(await (async () => {
    const b = (await selected(page).locator('[data-tw-body]').boundingBox())!
    return [b.x + b.width / 2, b.y + b.height / 2] as const
  })()))
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' delta')
  await page.keyboard.press('Escape')
  await expect(pdfPage(page, 1).locator('[data-tw-editor]')).toHaveCount(0)
  expect(await drawnText(notes(page).first())).toBe('Alpha beta gamma delta')
  await expect(selected(page)).toBeVisible()

  // 5. Enter edits too; Delete removes the selected note; Ctrl+Z restores it with its text.
  await page.keyboard.press('Enter')
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Delete')
  await expect(notes(page)).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(notes(page)).toHaveCount(1)
  expect(await drawnText(notes(page).first())).toBe('Alpha beta gamma delta')

  // 6. Hand mode: ONE click selects the note (it never pans or selects page text); a click on blank page deselects.
  await page.mouse.click(slot.x + slot.width * 0.9, slot.y + slot.height * 0.45)
  await expect(selected(page)).toHaveCount(0)
  await chooseMode(page, 'Hand')
  const b2 = await boxOf(page)
  const p2 = at((b2.left + b2.width / 2) / 100, (b2.top + 1) / 100)
  await page.mouse.click(p2.x, p2.y)
  await expect(selected(page)).toBeVisible()
  await page.mouse.click(slot.x + slot.width * 0.9, slot.y + slot.height * 0.45)
  await expect(selected(page)).toHaveCount(0)
})
