import type { Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { openBook, pdfPage } from '../support/reader'

/**
 * PDF Typewriter, geometry regressions (specs/005-typewriter-note): lines are packed and stay inside the box
 * (a glyph run used to be placed with the note-absolute baseline inside an element that was already offset by
 * the line's top, so every line drifted down by the sum of the lines above it), Hand mode selects with one click and
 * moves by dragging at any zoom, and neither text selection nor the sidebar starts a note move.
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
const notes = (page: Page) => pdfPage(page, 1).locator('[data-tw-note]')
const sel = (page: Page) => pdfPage(page, 1).locator('[data-tw-selected]')
const panel = (page: Page) => page.locator('[data-reader-right-panel]')
const box = async (page: Page) => (await notes(page).first().boundingBox())!
async function clickAt(page: Page, x: number, y: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  await page.mouse.click(slot.x + slot.width * x, slot.y + slot.height * y)
}

/** Every glyph run sits in its own line box, lines are packed (pitch = line height) and all of them are inside the note. */
async function expectCompactLines(root: ReturnType<typeof notes>) {
  const m = await root.evaluate((el) => {
    const r = (e: Element) => e.getBoundingClientRect()
    return {
      noteBottom: r(el).bottom,
      lines: Array.from(el.querySelectorAll('[data-tw-line]')).map((l) => ({ top: r(l).top, bottom: r(l).bottom, segs: Array.from(l.querySelectorAll('[data-tw-seg]')).map((s) => ({ top: r(s).top, bottom: r(s).bottom })) })),
    }
  })
  expect(m.lines.length).toBeGreaterThan(1)
  for (const l of m.lines) {
    const h = l.bottom - l.top
    // A glyph box (≈ 1.36 em) may exceed the 1.2 em line box by a fraction of a line, never by a whole line.
    for (const s of l.segs) {
      expect(s.top).toBeGreaterThanOrEqual(l.top - h * 0.3)
      expect(s.bottom).toBeLessThanOrEqual(l.bottom + h * 0.3)
    }
  }
  for (let i = 1; i < m.lines.length; i++) expect(Math.abs(m.lines[i]!.top - m.lines[i - 1]!.bottom)).toBeLessThan(1.5)
  expect(m.lines.at(-1)!.bottom).toBeLessThanOrEqual(m.noteBottom + 1.5)
}

test('PDF Typewriter: lines are packed (Enter, blank line, another size) and stay inside the box', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter-lines.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)
  await clickAt(page, 0.2, 0.2)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('one')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('two')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('four')
  await expectCompactLines(pdfPage(page, 1).locator('[data-tw-editor]'))
  await page.keyboard.press('Escape')
  await expect(notes(page)).toHaveCount(1)
  await expectCompactLines(notes(page).first())

  // A larger size through the sidebar: still packed, and the (grown) box still holds every line.
  await page.getByRole('button', { name: /^Typewriter/ }).first().click({ button: 'right' })
  await showToolbar(page)
  await page.getByRole('button', { name: 'Select', exact: true }).first().click()
  const b = await box(page)
  await page.mouse.click(b.x + 4, b.y + 4)
  await expect(sel(page)).toBeVisible()
  const size = panel(page).getByLabel('Font size (pt)')
  await size.fill('30')
  await size.press('Enter')
  await expect
    .poll(async () => notes(page).first().locator('[data-tw-seg]').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize)))
    .toBeGreaterThan(30)
  await expectCompactLines(notes(page).first())
  const note = await box(page)
  const outline = (await sel(page).boundingBox())!
  expect(Math.abs(outline.height - note.height)).toBeLessThan(2) // the outline is the note's real bounds
})

test('PDF Typewriter: Hand mode selects with one click and moves by dragging, at two zooms; undo / redo and storage agree', async ({ reader }) => {
  test.setTimeout(240_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter-hand.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)
  await clickAt(page, 0.2, 0.3)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('Move me around')
  await page.keyboard.press('Escape')
  await expect(notes(page)).toHaveCount(1)
  await showToolbar(page)
  await page.getByRole('button', { name: 'Hand', exact: true }).first().click()
  const norm = async () => {
    const slot = (await pdfPage(page, 1).boundingBox())!
    const b = await box(page)
    return { x: (b.x - slot.x) / slot.width, y: (b.y - slot.y) / slot.height, w: b.width / slot.width }
  }
  const start = await norm()

  for (const zoomClicks of [0, 2]) {
    for (let i = 0; i < zoomClicks; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(sel(page)).toHaveCount(0)
    await notes(page).first().evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }))
    // One click in Hand mode selects (no pan, no page text selection).
    let b = await box(page)
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height / 2)
    await expect(sel(page)).toBeVisible()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    // Drag it: the note follows the pointer by the expected amount in page fractions, whatever the zoom.
    const before = await norm()
    const slot = (await pdfPage(page, 1).boundingBox())!
    b = await box(page)
    const dx = slot.width * 0.1
    const dy = slot.height * 0.05
    await page.mouse.move(b.x + b.width * 0.25, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.25 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 4 })
    // continuous: the outline follows while the button is still down
    await expect.poll(async () => Math.abs((await sel(page).boundingBox())!.x - (b.x + dx / 2))).toBeLessThan(3)
    await page.mouse.move(b.x + b.width * 0.25 + dx, b.y + b.height / 2 + dy, { steps: 4 })
    await page.mouse.up()
    const after = await norm()
    expect(Math.abs(after.x - before.x - 0.1)).toBeLessThan(0.01)
    expect(Math.abs(after.y - before.y - 0.05)).toBeLessThan(0.01)
    expect(Math.abs(after.w - before.w)).toBeLessThan(0.002) // moving never resizes
    const outline = (await sel(page).boundingBox())!
    const nb = await box(page)
    expect(Math.abs(outline.x - nb.x)).toBeLessThan(2)
    expect(Math.abs(outline.y - nb.y)).toBeLessThan(2)
    // Back to nothing selected without changing tool; the next loop selects and moves it again.
    const here = await box(page)
    await page.mouse.click(slot.x + slot.width * 0.93, here.y)
    await expect(sel(page)).toHaveCount(0)
  }

  // Undo / redo: each move is one step.
  const moved = await norm()
  await page.keyboard.press('Control+z')
  await expect.poll(async () => Math.abs((await norm()).x - moved.x)).toBeGreaterThan(0.05)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => Math.abs((await norm()).x - start.x)).toBeLessThan(0.01)
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+y')
  await expect.poll(async () => Math.abs((await norm()).x - moved.x)).toBeLessThan(0.01)

  // What Main stores is where the note is.
  const stored = await page.evaluate(async () => {
    const api = (window as unknown as { api: { library: { listBooks: () => Promise<{ id: string }[]> }; overlay: { listHighlights: (id: string) => Promise<{ styleKind: string; pdfAnnotationRef?: string }[]> } } }).api
    for (const bk of await api.library.listBooks()) for (const h of await api.overlay.listHighlights(bk.id)) if (h.styleKind === 'typewriter') return JSON.parse(h.pdfAnnotationRef!).rects[0] as { x: number; y: number }
    return null
  })
  expect(stored).not.toBeNull()
  await expect.poll(async () => Math.abs((await norm()).x - stored!.x)).toBeLessThan(0.01)
})

test('PDF Typewriter: dragging across text in the editor selects text and never moves the note; a drag from a sidebar button moves nothing', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('typewriter-nodrag.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await armTool(page)
  await clickAt(page, 0.2, 0.3)
  await expect(editor(page)).toBeFocused()
  await page.keyboard.insertText('alpha beta gamma')
  const live = pdfPage(page, 1).locator('[data-tw-editor]')
  const before = (await live.boundingBox())!
  await page.keyboard.press('End')
  const seg = (await editor(page).locator('[data-tw-seg]').first().boundingBox())!
  await page.mouse.move(seg.x + 2, seg.y + seg.height / 2)
  await page.mouse.down()
  await page.mouse.move(seg.x + seg.width * 0.6, seg.y + seg.height / 2, { steps: 8 })
  await page.mouse.up()
  expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).length).toBeGreaterThan(0)
  const after = (await live.boundingBox())!
  expect(Math.abs(after.x - before.x)).toBeLessThan(1)
  expect(Math.abs(after.y - before.y)).toBeLessThan(1)
  await page.getByRole('button', { name: /^Typewriter/ }).first().click({ button: 'right' })
  await expect(panel(page).locator('[data-tw-panel]')).toBeVisible()
  const bold = (await panel(page).getByRole('button', { name: 'Bold' }).boundingBox())!
  await page.mouse.move(bold.x + 4, bold.y + 4)
  await page.mouse.down()
  await page.mouse.move(bold.x - 200, bold.y + 100, { steps: 6 })
  await page.mouse.up()
  const still = (await live.boundingBox())!
  expect(Math.abs(still.y - after.y)).toBeLessThan(1)
})
