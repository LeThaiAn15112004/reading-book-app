import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { buildTextPdf, textPdfLine } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { expectCurrentPage, goToPage, openBook, pdfPage } from '../support/reader'

/**
 * PDF text annotations (docs/implementation_plan/pdf_text_annotations.md), driven in the built
 * Electron app: create through the selection menu and the toolbar tools, survive zoom / scroll /
 * page virtualization / a full app restart, sidebar navigation, and EPUB highlights still work.
 */

const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

/** The text-layer span of `line` on PDF page `n` (one span per line in build-text-pdf.mjs). */
const lineSpan = (page: Page, n: number, line: number) =>
  pdfPage(page, n).locator('.textLayer span', { hasText: textPdfLine(n, line) })

const marks = (page: Page, n: number, kind: string) => pdfPage(page, n).locator(`.rb-pdf-annot[data-kind="${kind}"]`)

/** Select whole lines `from`…`to` of page `n` (a real DOM selection on the PDF.js text layer). */
async function selectLines(page: Page, n: number, from: number, to: number) {
  await expect(lineSpan(page, n, from)).toBeVisible()
  await page.evaluate(
    ({ n, first, last }) => {
      const spans = Array.from(document.querySelectorAll<HTMLElement>(`[data-page-number="${n}"] .textLayer span`))
      const a = spans.find((s) => s.textContent === first)?.firstChild
      const b = spans.find((s) => s.textContent === last)?.firstChild
      if (!a || !b) throw new Error('line spans not found')
      const range = document.createRange()
      range.setStart(a, 0)
      range.setEnd(b, b.textContent?.length ?? 0)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    },
    { n, first: textPdfLine(n, from), last: textPdfLine(n, to) },
  )
}

/** Right-click inside the live selection (on line `line`) and pick `action` in the selection menu. */
async function selectionMenuAction(page: Page, n: number, line: number, action: string) {
  const box = (await lineSpan(page, n, line).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Selection options' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: action, exact: true }).click()
}

/**
 * Largest distance (px) between each listed line's glyph box and the nearest `kind` mark on its
 * page — the mark must sit exactly on the text whatever the zoom / scroll.
 */
async function markOffset(page: Page, n: number, lines: number[], kind: string): Promise<number> {
  return page.evaluate(
    ({ n, texts, kind }) => {
      const slot = document.querySelector(`[data-page-number="${n}"]`)!
      const markBoxes = Array.from(slot.querySelectorAll(`.rb-pdf-annot[data-kind="${kind}"]`)).map((m) => m.getBoundingClientRect())
      const spans = Array.from(slot.querySelectorAll<HTMLElement>('.textLayer span'))
      let worst = 0
      for (const text of texts) {
        const node = spans.find((s) => s.textContent === text)?.firstChild
        if (!node) return Infinity
        const range = document.createRange()
        range.selectNodeContents(node)
        const t = range.getBoundingClientRect()
        const best = Math.min(
          ...markBoxes.map((m) =>
            Math.max(
              Math.abs(m.left - t.left),
              Math.abs(m.top - t.top),
              Math.abs(m.right - t.right),
              Math.abs(m.bottom - t.bottom),
            ),
          ),
        )
        worst = Math.max(worst, best)
      }
      return worst
    },
    { n, texts: lines.map((l) => textPdfLine(n, l)), kind },
  )
}

/** The reader toolbar starts hidden; the menubar's "Tools" item shows it. */
async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

async function chooseTool(page: Page, tool: 'Hand' | 'Select') {
  await showToolbar(page)
  const button = page.getByRole('button', { name: tool, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Open the Notes sidebar and expand the (collapsed by default) reading-order group `group`. */
async function openNotesGroup(page: Page, group: string) {
  const notesTab = page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'Notes', exact: true })
  if ((await notesTab.getAttribute('aria-pressed')) !== 'true') await notesTab.click()
  const sidebar = page.getByRole('complementary')
  await expect(sidebar.getByRole('heading', { name: 'Notes' })).toBeVisible()
  await sidebar.getByRole('button', { name: new RegExp(`^${group} `) }).click()
}

test('PDF: highlight / underline / strikethrough / note — create, render, navigate, persist across restart', async ({
  reader,
}) => {
  test.setTimeout(180_000)
  let { page } = reader
  await openBook(reader, reader.writeFixture('annotations.pdf', buildTextPdf()))
  await chooseTool(page, 'Select')

  // 1. Highlight two lines through the selection menu → two marks, exactly on the glyphs.
  await selectLines(page, 1, 2, 3)
  await selectionMenuAction(page, 1, 2, 'Highlight')
  await expect(marks(page, 1, 'highlight')).toHaveCount(2)
  await expect.poll(() => markOffset(page, 1, [2, 3], 'highlight')).toBeLessThan(1.5)
  // The selection is consumed, the text is still selectable / copyable under the mark.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
  await selectLines(page, 1, 2, 2)
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(textPdfLine(1, 2))
  await page.evaluate(() => window.getSelection()?.removeAllRanges())

  // 2. Strikethrough through the menu, underline through the toolbar tool + a real mouse drag.
  await selectLines(page, 1, 5, 5)
  await selectionMenuAction(page, 1, 5, 'Strikethrough')
  await expect(marks(page, 1, 'strikethrough')).toHaveCount(1)

  await showToolbar(page)
  await page.getByRole('button', { name: 'Annotation', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: /Underline/ }).click()
  const line6 = (await lineSpan(page, 1, 6).boundingBox())!
  await page.mouse.move(line6.x + 2, line6.y + line6.height / 2)
  await page.mouse.down()
  await page.mouse.move(line6.x + line6.width / 2, line6.y + line6.height / 2, { steps: 5 })
  await page.mouse.move(line6.x + line6.width - 1, line6.y + line6.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(marks(page, 1, 'underline')).toHaveCount(1)
  await page.keyboard.press('Escape') // disarm the tool (back to Select)

  // 3. A note on a selection: its popup opens, the text is saved, a 📝 icon marks it.
  await selectLines(page, 1, 7, 7)
  await selectionMenuAction(page, 1, 7, 'Add note')
  const noteDialog = page.getByRole('dialog', { name: 'Note' })
  await expect(noteDialog).toBeVisible()
  await noteDialog.locator('textarea').fill('Remember the fox')
  await noteDialog.locator('textarea').press('Control+Enter')
  await expect(noteDialog).toBeHidden()
  await expect(pdfPage(page, 1).locator('[data-pdf-annot-note]')).toHaveCount(1)

  // 4. Click a mark → its menu (Select tool: the edit popup) — change its color there.
  const firstMark = (await marks(page, 1, 'highlight').first().boundingBox())!
  await page.mouse.click(firstMark.x + firstMark.width / 2, firstMark.y + firstMark.height / 2)
  const edit = page.getByRole('dialog', { name: 'Edit highlight' })
  await expect(edit).toBeVisible()
  await expect(marks(page, 1, 'highlight').first()).toHaveAttribute('data-focused', '')
  await page.keyboard.press('Escape')
  await expect(edit).toBeHidden()

  // 5. Zoom: marks stay on the glyphs.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(() => markOffset(page, 1, [2, 3], 'highlight')).toBeLessThan(1.5)
  await expect.poll(() => markOffset(page, 1, [5], 'strikethrough')).toBeLessThan(1.5)

  // 6. Scroll far away (page 1's canvas + text layer are released) and back.
  await goToPage(page, 14)
  await expect.poll(() => pdfPage(page, 1).locator('canvas').count()).toBe(0)
  await expect(marks(page, 1, 'highlight')).toHaveCount(2) // marks don't depend on the canvas
  await goToPage(page, 1)
  await expect(lineSpan(page, 1, 2)).toBeVisible()
  await expect.poll(() => markOffset(page, 1, [2, 3], 'highlight')).toBeLessThan(1.5)

  // 7. Sidebar Notes lists every annotation under "Page 1"; a click jumps back from far away.
  await goToPage(page, 10)
  await openNotesGroup(page, 'Page 1')
  const sidebarEntry = page.getByText(`“${textPdfLine(1, 5)}”`)
  await expect(sidebarEntry).toBeVisible()
  await expect(page.getByText(`“${textPdfLine(1, 7)}”`)).toBeVisible()
  await sidebarEntry.click()
  await expectCurrentPage(page, 1)
  await page.screenshot({ path: test.info().outputPath('pdf-annotations.png') })

  // 8. Restart the whole app on the same data: every annotation is restored.
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: 'Resume annotations' })
    const pageInput = page.getByRole('textbox', { name: 'Current page' })
    await expect(resume.or(pageInput).first()).toBeVisible({ timeout: 20_000 })
    if (await resume.isVisible()) await resume.click()
    await goToPage(page, 1)
    await expect(marks(page, 1, 'highlight')).toHaveCount(2)
    await expect(marks(page, 1, 'strikethrough')).toHaveCount(1)
    await expect(marks(page, 1, 'underline')).toHaveCount(1)
    await expect(pdfPage(page, 1).locator('[data-pdf-annot-note]')).toHaveCount(1)
    await expect(lineSpan(page, 1, 2)).toBeVisible()
    await expect.poll(() => markOffset(page, 1, [2, 3], 'highlight')).toBeLessThan(1.5)

    // The note text came back too: open it from its icon.
    await chooseTool(page, 'Select')
    const icon = (await pdfPage(page, 1).locator('[data-pdf-annot-note]').boundingBox())!
    await page.mouse.click(icon.x + icon.width / 2, icon.y + icon.height / 2)
    await expect(page.getByRole('dialog', { name: 'Note' }).locator('textarea')).toHaveValue('Remember the fox')
    await page.keyboard.press('Escape')

    // Undo / redo / delete on a fresh session: delete the strikethrough, undo brings it back.
    const strike = (await marks(page, 1, 'strikethrough').boundingBox())!
    await page.mouse.click(strike.x + strike.width / 2, strike.y + strike.height / 2)
    await expect(page.getByRole('dialog', { name: 'Edit highlight' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Edit highlight' }).getByRole('button', { name: /Delete/ }).click()
    await expect(marks(page, 1, 'strikethrough')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(marks(page, 1, 'strikethrough')).toHaveCount(1)
  } finally {
    await app.close().catch(() => {})
  }
})

test('EPUB highlights still work and never mix with PDF annotations', async ({ reader }) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('mix.pdf', buildTextPdf()))
  await chooseTool(page, 'Select')
  await selectLines(page, 1, 1, 1)
  await selectionMenuAction(page, 1, 1, 'Highlight')
  await expect(marks(page, 1, 'highlight')).toHaveCount(1)

  // Second book: the EPUB sample, through Library → Add file → Open.
  await page.getByRole('link', { name: 'Library', exact: true }).or(page.getByRole('button', { name: 'Library', exact: true })).first().click()
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  const content = page.frameLocator('iframe').first()
  const heading = content.getByRole('heading', { name: 'Chapter One' })
  await expect(heading).toBeVisible()
  await chooseTool(page, 'Select')

  // Select the heading text inside the epub.js iframe; epub.js reports the selection after it
  // settles, then the same right-click menu creates a CFI highlight.
  await heading.evaluate((el) => {
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(el)
    const selection = el.ownerDocument.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await expect(async () => {
    await heading.click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Selection options' })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  await page.getByRole('menu', { name: 'Selection options' }).getByRole('menuitem', { name: 'Highlight', exact: true }).click()

  await openNotesGroup(page, 'Chapter One')
  await expect(page.getByText('“Chapter One”')).toBeVisible()
  // Only the EPUB's own annotation is listed — no PDF page group, no PDF line.
  await expect(page.getByRole('complementary').getByRole('button', { name: /^Page 1 / })).toHaveCount(0)
  await expect(page.getByText(`“${textPdfLine(1, 1)}”`)).toHaveCount(0)
  // The EPUB mark itself is painted by epub.js's marks pane (an SVG `<g data-id>` over the page).
  await expect.poll(() => page.locator('svg g[data-id]').count()).toBeGreaterThan(0)
})

test('PDF (Hand): the selection stays painted while the pointer moves / drags inside the selection menu', async ({
  reader,
}) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('keep-selection.pdf', buildTextPdf()))
  // Hand is the default tool: rest on text to arm the I-beam, then drag-select two lines.
  const line2 = (await lineSpan(page, 1, 2).boundingBox())!
  const line3 = (await lineSpan(page, 1, 3).boundingBox())!
  await page.mouse.move(line2.x + 2, line2.y + line2.height / 2)
  await page.mouse.move(line2.x + 4, line2.y + line2.height / 2)
  await page.waitForTimeout(800)
  await page.mouse.down()
  await page.mouse.move(line3.x + line3.width - 2, line3.y + line3.height / 2, { steps: 10 })
  await page.mouse.up()
  const selected = async () => (await page.evaluate(() => window.getSelection()?.toString() ?? '')).replace(/\s+/g, '')
  const expected = `${textPdfLine(1, 2)}${textPdfLine(1, 3)}`.replace(/\s+/g, '')
  expect(await selected()).toBe(expected)

  await page.mouse.click(line2.x + line2.width / 2, line2.y + line2.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Selection options' })
  await expect(menu).toBeVisible()

  // Leave the text, press on an item, drag across the menu, release on its padding (no action).
  const item = (await menu.getByRole('menuitem', { name: 'Translate', exact: true }).boundingBox())!
  const box = (await menu.boundingBox())!
  await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 6 })
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await page.mouse.move(box.x + 2, box.y + box.height - 2, { steps: 6 })
  await page.mouse.up()

  // Still selected AND still selectable text (Chromium neither paints nor stringifies a selection
  // inside user-select:none — that was the bug: Hand turned it off once the pointer left the text).
  await expect(menu).toBeVisible()
  expect(await selected()).toBe(expected)
  expect(await lineSpan(page, 1, 2).evaluate((el) => getComputedStyle(el).userSelect)).toBe('text')
  await page.screenshot({ path: test.info().outputPath('selection-kept.png') })

  // The menu still acts on that selection; once it is consumed Hand is back to non-selectable text.
  await menu.getByRole('menuitem', { name: 'Highlight', exact: true }).click()
  await expect(marks(page, 1, 'highlight')).toHaveCount(2)
  await page.mouse.move(10, 400)
  await expect.poll(() => lineSpan(page, 1, 2).evaluate((el) => getComputedStyle(el).userSelect)).toBe('none')
})

test('PDF (Select): dragging through the gaps between lines never jumps the selection to the end of the page', async ({
  reader,
}) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('drag-select.pdf', buildTextPdf()))
  await chooseTool(page, 'Select')
  const line2 = (await lineSpan(page, 1, 2).boundingBox())!
  const line3 = (await lineSpan(page, 1, 3).boundingBox())!
  const line4 = (await lineSpan(page, 1, 4).boundingBox())!
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '')

  // Start at the beginning of line 2 and hover the gaps: past line 2's end, then between lines 3 and 4.
  await page.mouse.move(line2.x + 1, line2.y + line2.height / 2)
  await page.mouse.down()
  await page.mouse.move(line2.x + line2.width / 2, line2.y + line2.height / 2, { steps: 5 })
  await page.mouse.move(line2.x + line2.width + 40, line2.y + line2.height / 2, { steps: 5 })
  const pastLineEnd = await selected()
  await page.mouse.move(line3.x + line3.width / 2, (line3.y + line3.height + line4.y) / 2, { steps: 8 })
  const inGap = await selected()
  await page.mouse.up()
  const final = await selected()

  for (const text of [pastLineEnd, inGap, final]) {
    expect(text).toContain('line 2')
    // A jump to the end of the layer would drag in the rest of the page.
    expect(text).not.toContain('line 5')
    expect(text).not.toContain('line 8')
  }
  expect(pastLineEnd).not.toContain('line 3')
})
