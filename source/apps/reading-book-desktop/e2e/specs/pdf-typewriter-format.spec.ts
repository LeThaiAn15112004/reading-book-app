import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { openBook, pdfPage } from '../support/reader'

/**
 * PDF Typewriter formatting (specs/005-typewriter-note, US3 / US4): text inside the in-place editor can be selected
 * with the mouse and the keyboard, and the Properties sidebar formats the selection / the whole note.
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

const editor = (page: Page) => pdfPage(page, 1).locator('[data-tw-editor] [contenteditable]')
const selectionText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '')

async function clickAt(page: Page, x: number, y: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  await page.mouse.click(slot.x + slot.width * x, slot.y + slot.height * y)
}

test('PDF Typewriter: text in the editor can be selected (mouse drag, double-click, Shift+arrows)', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter-select.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)
  await clickAt(page, 0.2, 0.3)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('alpha beta gamma')

  // Keyboard: Home, Shift+Right x5 selects "alpha".
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  expect(await selectionText(page)).toBe('alpha')

  await page.keyboard.press('End')
  // Mouse: a drag across the first word selects text.
  const seg = (await editor(page).locator('[data-tw-seg]').first().boundingBox())!
  await page.mouse.move(seg.x + 2, seg.y + seg.height / 2)
  await page.mouse.down()
  await page.mouse.move(seg.x + seg.width * 0.45, seg.y + seg.height / 2, { steps: 8 })
  await page.mouse.up()
  expect((await selectionText(page)).length).toBeGreaterThan(0)

  // Double click selects a word.
  await page.mouse.dblclick(seg.x + seg.width * 0.5, seg.y + seg.height / 2)
  expect(await selectionText(page)).toMatch(/^beta ?$/)
})

const panel = (page: Page) => page.locator('[data-reader-right-panel]')
const openTypewriterPanel = async (page: Page) => {
  await page.getByRole('button', { name: /^Typewriter/ }).first().click({ button: 'right' })
  await expect(panel(page).locator('[data-tw-panel]')).toBeVisible()
}
const notes = (page: Page) => pdfPage(page, 1).locator('[data-tw-note]')
const familyOf = (loc: ReturnType<typeof notes>) => loc.locator('[data-tw-seg]').first().evaluate((e) => getComputedStyle(e).fontFamily)
const colorsOf = (loc: ReturnType<typeof notes>) => loc.locator('[data-tw-seg]').evaluateAll((els) => els.map((e) => getComputedStyle(e).color))

test('PDF Typewriter: Properties sidebar — defaults, a selected note, a text selection, close commits', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter-panel.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)

  // 1. Right-click on the tool: the panel shows the DEFAULTS and the tool stays armed.
  const tool = page.getByRole('button', { name: /^Typewriter/ }).first()
  await tool.click({ button: 'right' })
  await expect(panel(page)).toHaveAttribute('aria-hidden', 'false')
  await expect(panel(page).locator('[data-tw-panel="defaults"]')).toBeVisible()
  await expect(tool).toHaveAttribute('aria-pressed', 'true')
  await panel(page).getByLabel('Font family').selectOption('noto-serif')

  // 2. The next note takes the defaults.
  await clickAt(page, 0.2, 0.3)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('alpha beta gamma')
  // While typing, the panel formats the text being typed: nothing selected → "applies to what you type next".
  await expect(panel(page).locator('[data-tw-panel="session"]')).toBeVisible()
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  // 3. A selected range: colour via the HEX field (without #), bold via the button; the editor keeps its selection.
  const hex = panel(page).getByLabel('Colour HEX')
  await hex.fill('ff0000')
  await hex.press('Enter')
  await panel(page).getByRole('button', { name: 'Bold' }).click()
  await expect.poll(async () => (await colorsOf(pdfPage(page, 1).locator('[data-tw-editor]'))).length).toBe(2)
  expect((await colorsOf(pdfPage(page, 1).locator('[data-tw-editor]')))[0]).toBe('rgb(255, 0, 0)')
  expect(await familyOf(pdfPage(page, 1).locator('[data-tw-editor]'))).toContain('noto-serif-b')
  // An invalid HEX is marked and the colour is kept.
  await hex.fill('zzz')
  await hex.press('Enter')
  await expect(hex).toHaveAttribute('aria-invalid', 'true')
  expect((await colorsOf(pdfPage(page, 1).locator('[data-tw-editor]')))[0]).toBe('rgb(255, 0, 0)')

  // 4. Closing the panel commits the open edit first: one note with two runs.
  await panel(page).getByRole('button', { name: /^Close/ }).click()
  await expect(pdfPage(page, 1).locator('[data-tw-editor]')).toHaveCount(0)
  await expect(notes(page)).toHaveCount(1)
  expect((await colorsOf(notes(page).first()))).toHaveLength(2)

  // 5. Right-click on the note: the panel shows THAT note (whole box); Bold applies to all of it, one undo step.
  const box = (await notes(page).first().boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await expect(panel(page).locator('[data-tw-panel="note"]')).toBeVisible()
  await expect(panel(page).locator('[data-tw-panel="note"]')).toContainText('alpha beta gamma')
  await panel(page).getByLabel('Font family').selectOption('noto-sans')
  await expect.poll(() => familyOf(notes(page).first())).toContain('noto-sans')
  // "Edit text" starts on-page editing of the same note.
  await panel(page).getByRole('button', { name: 'Edit text' }).click()
  await expect(editor(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(pdfPage(page, 1).locator('[data-tw-editor]')).toHaveCount(0)

  // 6. Nothing selected (Select mode, click on empty page) → back to the defaults; the old note's values are not shown.
  await showToolbar(page)
  await page.getByRole('button', { name: 'Select', exact: true }).first().click()
  await clickAt(page, 0.93, 0.15)
  await expect(panel(page).locator('[data-tw-panel="defaults"]')).toBeVisible()
  await expect(panel(page).getByLabel('Font family')).toHaveValue('noto-serif')
  // The note kept its own family (the defaults never touch existing notes).
  expect(await familyOf(notes(page).first())).toContain('noto-sans')
})

test('PDF Typewriter: a note is written into the PDF file as a FreeText; one with characters no font draws stays out, with its reason', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  const file = reader.writeFixture('typewriter-file.pdf', buildTextPdf())
  const original = readFileSync(file)
  await openBook(reader, file)
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)

  // 1. A note with Vietnamese text and a bold word is written into the user's own file (an incremental update).
  await clickAt(page, 0.2, 0.3)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('Xin chào thế giới')
  await page.keyboard.press('Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await openTypewriterPanel(page)
  await panel(page).getByRole('button', { name: 'Bold' }).click()
  await page.keyboard.press('Escape')
  await expect(notes(page)).toHaveCount(1)
  await expect.poll(() => readFileSync(file).toString('latin1').includes('/FreeTextTypewriter'), { timeout: 30_000 }).toBe(true)
  const written = readFileSync(file)
  expect(written.subarray(0, original.length).equals(original), 'the original bytes are untouched (appended update)').toBe(true)
  expect(written.toString('latin1')).toContain('/NM (readmate:')

  // 2. Characters no shipped font can draw: the note is kept, left out of the file, and says why.
  await armTool(page)
  await clickAt(page, 0.45, 0.42)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('Xin 你好')
  await page.keyboard.press('Escape')
  await expect(notes(page)).toHaveCount(2)
  await page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'Notes', exact: true }).click()
  const sidebar = page.getByRole('complementary').first()
  await sidebar.getByRole('button', { name: /^Page 1 / }).click()
  const reason = sidebar.locator('[data-tw-not-in-file="unsupported_characters"]')
  await expect(reason).toBeVisible({ timeout: 30_000 })
  await expect(reason).toContainText('Not in the file')
  await expect(reason).toContainText('你')
  // Its text is untouched and only the first note is in the file.
  await expect(sidebar.locator('[data-note-id]').filter({ hasText: 'Xin 你好' })).toHaveCount(1)
  expect(readFileSync(file).toString('latin1').split('/FreeTextTypewriter').length - 1).toBe(1)
})
