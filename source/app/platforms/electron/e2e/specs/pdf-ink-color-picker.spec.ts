import type { Locator, Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { openBook, pdfPage } from '../support/reader'

/**
 * PDF freehand Ink — the colour picker swatch in the Freehand dropdown and in the selected-stroke panel must
 * really change the colour. The system picker reports a pick with an `input` event (while dragging) and a
 * `change` event (when it closes); both are dispatched here exactly like Chromium does, with the value set
 * through the element's native setter (what the picker does).
 */

async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

/** What the OS colour picker does: the value changes, `input` fires (live), then `change` (committed). */
async function pickColor(input: Locator, hex: string) {
  await input.evaluate((el, value) => {
    const color = el as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setValue.call(color, value)
    color.dispatchEvent(new Event('input', { bubbles: true }))
    color.dispatchEvent(new Event('change', { bubbles: true }))
  }, hex)
}

const strokes = (page: Page) => pdfPage(page, 1).locator('[data-pdf-ink-id]')

async function drawLine(page: Page, yFrac: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  const y = slot.y + slot.height * yFrac
  const x0 = slot.x + slot.width * 0.2
  const x1 = slot.x + slot.width * 0.6
  await page.mouse.move(x0, y)
  await page.mouse.down()
  await page.mouse.move((x0 + x1) / 2, y, { steps: 8 })
  await page.mouse.move(x1, y, { steps: 8 })
  await page.mouse.up()
}

test('PDF freehand: the colour picker changes the colour of the next stroke and of a selected stroke', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('ink-color.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await showToolbar(page)

  // 1. Pick a colour with the swatch in the dropdown: the HEX field follows and the next stroke has it.
  await page.getByRole('button', { name: 'Freehand settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Freehand settings' })
  await expect(dialog).toBeVisible()
  await pickColor(dialog.locator('input[type="color"]'), '#ff5722')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FF5722')
  await expect(dialog.locator('input[type="color"]')).toHaveValue('#ff5722')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Freehand', exact: true }).click()
  await drawLine(page, 0.15)
  await expect(strokes(page)).toHaveCount(1)
  await expect(strokes(page).first()).toHaveAttribute('stroke', /^#ff5722$/i)

  // 2. A second pick (a different colour) changes it again — not stuck on the first one.
  await page.getByRole('button', { name: 'Freehand settings', exact: true }).click()
  await pickColor(dialog.locator('input[type="color"]'), '#00796b')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#00796B')
  await page.keyboard.press('Escape')
  // (Escape with focus outside the dialog also disarms the tool, as for any armed tool: arm it again.)
  const freehand = page.getByRole('button', { name: 'Freehand', exact: true })
  if ((await freehand.getAttribute('aria-pressed')) !== 'true') await freehand.click()
  await drawLine(page, 0.25)
  await expect(strokes(page).nth(1)).toHaveAttribute('stroke', /^#00796b$/i)
  await expect(strokes(page).first()).toHaveAttribute('stroke', /^#ff5722$/i) // saved strokes keep their colour

  // 3. The selected-stroke panel: the same swatch recolours that one stroke only.
  await page.getByRole('button', { name: 'Hand', exact: true }).click()
  const slot = (await pdfPage(page, 1).boundingBox())!
  await page.mouse.click(slot.x + slot.width * 0.4, slot.y + slot.height * 0.15)
  const panel = page.getByRole('dialog', { name: 'Selected stroke' })
  await expect(panel).toBeVisible()
  await pickColor(panel.locator('input[type="color"]'), '#3f51b5')
  await expect(strokes(page).first()).toHaveAttribute('stroke', /^#3f51b5$/i)
  await expect(strokes(page).nth(1)).toHaveAttribute('stroke', /^#00796b$/i)
  await expect(panel.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#3F51B5')
})
