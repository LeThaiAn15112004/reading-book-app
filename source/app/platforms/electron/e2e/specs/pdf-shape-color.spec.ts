import type { Locator, Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { openBook, pdfPage } from '../support/reader'

/**
 * PDF Shape tools (docs/implementation_plan/pdf_shape_tools.md) — the colour setting must be stable: pick a colour,
 * draw, pick another, draw right after; every shape keeps the colour it was drawn with and the dialog follows the
 * pick. The system picker reports a pick with `input` (live) and `change` (committed); both are dispatched here
 * like Chromium does. Real mouse input in the built Electron app (hidden window).
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

const settings = (page: Page) => page.getByRole('dialog', { name: 'Shape settings' })
const shapesOf = (page: Page, kind: string) => pdfPage(page, 1).locator(`[data-pdf-shape="${kind}"]`)

async function openSettings(page: Page): Promise<Locator> {
  await showToolbar(page)
  await page.getByRole('button', { name: 'Shape settings', exact: true }).click()
  const dialog = settings(page)
  await expect(dialog).toBeVisible()
  return dialog
}

/** Close the dialog and make sure the Shapes tool is armed (Escape may also disarm an armed tool). */
async function closeAndArm(page: Page) {
  await page.keyboard.press('Escape')
  // With the tool armed the first Escape backs the tool out (the reader's own handler); a second one closes the dialog.
  if (await settings(page).isVisible()) await page.keyboard.press('Escape')
  await expect(settings(page)).toBeHidden()
  const tool = page.getByRole('button', { name: 'Shapes', exact: true })
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click()
  await expect(tool).toHaveAttribute('aria-pressed', 'true')
}

/** Drag a diagonal on page 1 from (x0, y0) to (x1, y1), as fractions of the page box. */
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  const from = { x: slot.x + slot.width * x0, y: slot.y + slot.height * y0 }
  const to = { x: slot.x + slot.width * x1, y: slot.y + slot.height * y1 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

test('PDF shapes: changing the colour twice, drawing right after each change, is stable', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page } = reader
  await openBook(reader, reader.writeFixture('shape-color.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)

  // 1. Pick Ellipse and a first colour with the swatch: the HEX field and the swatch follow.
  let dialog = await openSettings(page)
  await dialog.locator('[data-shape-kind-option="ellipse"]').click()
  await expect(dialog.locator('[data-shape-kind-option="ellipse"]')).toHaveAttribute('aria-pressed', 'true')
  await pickColor(dialog.locator('input[type="color"]'), '#ff5722')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FF5722')
  await expect(dialog.locator('input[type="color"]')).toHaveValue('#ff5722')
  await closeAndArm(page)

  // 2. Draw: the shape has the picked colour (not the default red).
  await drag(page, 0.15, 0.04, 0.45, 0.14)
  await expect(shapesOf(page, 'ellipse')).toHaveCount(1)
  await expect(shapesOf(page, 'ellipse').nth(0)).toHaveAttribute('stroke', /^#ff5722$/i)

  // 3. Change the colour again and draw immediately: the new shape has the NEW colour, the old one keeps its own.
  dialog = await openSettings(page)
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FF5722') // the first pick persisted
  await pickColor(dialog.locator('input[type="color"]'), '#00796b')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#00796B')
  await closeAndArm(page)
  await drag(page, 0.15, 0.17, 0.45, 0.27)
  await expect(shapesOf(page, 'ellipse')).toHaveCount(2)
  await expect(shapesOf(page, 'ellipse').nth(1)).toHaveAttribute('stroke', /^#00796b$/i)
  await expect(shapesOf(page, 'ellipse').nth(0)).toHaveAttribute('stroke', /^#ff5722$/i)

  // 4. A third change by typing a HEX, another kind (Line), draw straight after.
  dialog = await openSettings(page)
  await dialog.locator('[data-shape-kind-option="line"]').click()
  await dialog.getByRole('textbox', { name: 'Hex color' }).fill('#1E88E5')
  await expect(dialog.locator('input[type="color"]')).toHaveValue('#1e88e5')
  await closeAndArm(page)
  await drag(page, 0.15, 0.31, 0.5, 0.35)
  await expect(shapesOf(page, 'line')).toHaveCount(1)
  await expect(shapesOf(page, 'line').nth(0)).toHaveAttribute('stroke', /^#1e88e5$/i)

  // 5. Rapid sequence without closing the dialog between changes: the LAST pick wins.
  dialog = await openSettings(page)
  await pickColor(dialog.locator('input[type="color"]'), '#ab47bc')
  await pickColor(dialog.locator('input[type="color"]'), '#fbc02d')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FBC02D')
  await closeAndArm(page)
  await drag(page, 0.15, 0.39, 0.5, 0.43)
  await expect(shapesOf(page, 'line')).toHaveCount(2)
  await expect(shapesOf(page, 'line').nth(1)).toHaveAttribute('stroke', /^#fbc02d$/i)

  // 6. Nothing was recoloured behind the user's back; the colours survive in the shapes list state (all four kept their own).
  await expect(shapesOf(page, 'ellipse').nth(0)).toHaveAttribute('stroke', /^#ff5722$/i)
  await expect(shapesOf(page, 'ellipse').nth(1)).toHaveAttribute('stroke', /^#00796b$/i)
  await expect(shapesOf(page, 'line').nth(0)).toHaveAttribute('stroke', /^#1e88e5$/i)
})
