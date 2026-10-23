import type { Locator, Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * PDF freehand Ink — the Brush style (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md, "Brush (MVP)"):
 * its own settings, a soft layered stroke, zoom, undo / redo, the Stroke Eraser, and an app restart.
 * Real mouse / keyboard input in the built Electron app (hidden window).
 */

async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

async function chooseTool(page: Page, tool: 'Hand' | 'Freehand' | 'Eraser') {
  await showToolbar(page)
  const button = page.getByRole('button', { name: tool, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Freehand settings' })
const strokes = (page: Page) => pdfPage(page, 1).locator('[data-pdf-ink-id]')
const brushStrokes = (page: Page) => pdfPage(page, 1).locator('[data-pdf-ink-id][data-pdf-ink-style="brush"]')
const penStrokes = (page: Page) => pdfPage(page, 1).locator('[data-pdf-ink-id][data-pdf-ink-style="pen"]')

async function openSettings(page: Page): Promise<Locator> {
  await showToolbar(page)
  await page.getByRole('button', { name: 'Freehand settings', exact: true }).click()
  const dialog = settingsDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(settingsDialog(page)).toBeHidden()
}

async function pickStyle(dialog: Locator, style: 'pen' | 'brush') {
  const option = dialog.locator(`[data-ink-style-option="${style}"]`)
  await option.click()
  await expect(option).toHaveAttribute('aria-pressed', 'true')
}

/** What a saved Brush stroke is made of: its group opacity and each concentric layer. */
async function brushLook(stroke: Locator) {
  return stroke.evaluate((g) => {
    const layers = Array.from(g.querySelectorAll('path')).map((p) => ({
      color: p.getAttribute('stroke')!.toUpperCase(),
      alpha: Number(p.getAttribute('stroke-opacity')),
      width: Number(p.getAttribute('stroke-width')),
      cap: p.getAttribute('stroke-linecap'),
    }))
    return { tag: g.tagName.toLowerCase(), opacity: Number(g.getAttribute('opacity')), layers }
  })
}

async function penLook(stroke: Locator) {
  return stroke.evaluate((p) => ({
    tag: p.tagName.toLowerCase(),
    color: p.getAttribute('stroke')!.toUpperCase(),
    opacity: Number(p.getAttribute('stroke-opacity')),
    width: Number(p.getAttribute('stroke-width')),
  }))
}

/** A stroke's box relative to its page (0–1): independent of zoom and scroll. */
async function relativeBox(page: Page, stroke: Locator) {
  const box = (await stroke.boundingBox())!
  const slot = (await pdfPage(page, 1).boundingBox())!
  return { x: (box.x - slot.x) / slot.width, y: (box.y - slot.y) / slot.height, w: box.width / slot.width, h: box.height / slot.height }
}

/** Draw a horizontal stroke (many pointer samples) at `yFrac` of the page. */
async function drawStroke(page: Page, yFrac: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  const y = slot.y + slot.height * yFrac
  const x0 = slot.x + slot.width * 0.2
  const x1 = slot.x + slot.width * 0.6
  await page.mouse.move(x0, y)
  await page.mouse.down()
  for (let i = 1; i <= 16; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 16, y, { steps: 2 })
  await page.mouse.up()
}

test('PDF freehand Brush: settings, soft stroke, zoom, undo / redo, Stroke Eraser, restart', async ({ reader }) => {
  test.setTimeout(240_000)
  let { page } = reader
  await openBook(reader, reader.writeFixture('ink-brush.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await showToolbar(page)

  // 1. Brush is a fourth style with its own defaults; its settings are edited like the others.
  let dialog = await openSettings(page)
  await expect(dialog.locator('[data-ink-style-option]')).toHaveCount(4)
  await pickStyle(dialog, 'brush')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#8E24AA')
  await expect(dialog.getByText('85%')).toBeVisible()
  await expect(dialog.getByRole('slider', { name: 'Opacity' })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Hex color' }).fill('#E91E63')
  const opacity = dialog.getByRole('slider', { name: 'Opacity' })
  await opacity.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft') // 85 % -> 70 %
  await expect(dialog.getByText('70%')).toBeVisible()
  const thickness = dialog.getByRole('slider', { name: 'Thickness' })
  const thicknessBefore = Number(await thickness.inputValue())
  await thickness.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await thickness.inputValue())).toBeGreaterThan(thicknessBefore)
  await closeSettings(page)

  // 2. Draw a Brush stroke: a group of three concentric round-capped layers (faint edge → dense core).
  await chooseTool(page, 'Freehand')
  await drawStroke(page, 0.14)
  await expect(brushStrokes(page)).toHaveCount(1)
  const brush = await brushLook(brushStrokes(page).first())
  expect(brush.tag).toBe('g')
  expect(brush.opacity).toBeCloseTo(0.7, 2)
  expect(brush.layers).toHaveLength(3)
  expect(brush.layers.every((l) => l.color === '#E91E63' && l.cap === 'round')).toBe(true)
  expect(brush.layers[1]!.width).toBeLessThan(brush.layers[0]!.width)
  expect(brush.layers[2]!.width).toBeLessThan(brush.layers[1]!.width)
  expect(brush.layers[2]!.alpha).toBeGreaterThan(brush.layers[0]!.alpha)
  const brushWidth = brush.layers[0]!.width

  // 3. Pen is untouched by the Brush settings and draws as before (one solid path); the Brush keeps its own.
  dialog = await openSettings(page)
  await pickStyle(dialog, 'pen')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#1E88E5')
  await expect(dialog.getByRole('slider', { name: 'Opacity' })).toHaveCount(0)
  await closeSettings(page)
  await drawStroke(page, 0.26)
  await expect(penStrokes(page)).toHaveCount(1)
  const pen = await penLook(penStrokes(page).first())
  expect(pen).toMatchObject({ tag: 'path', color: '#1E88E5', opacity: 1 })
  expect(pen.width).toBeLessThan(brushWidth)
  dialog = await openSettings(page)
  await pickStyle(dialog, 'brush')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#E91E63')
  await expect(dialog.getByText('70%')).toBeVisible()
  await closeSettings(page)
  // Saved strokes did not change when the settings were switched around.
  expect(await brushLook(brushStrokes(page).first())).toEqual(brush)
  expect(await penLook(penStrokes(page).first())).toEqual(pen)

  // 4. Zoom: the stroke stays on the same spot of the page and keeps its proportions.
  const beforeZoom = await relativeBox(page, brushStrokes(page).first())
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => (await pdfPage(page, 1).boundingBox())!.width).toBeGreaterThan(900)
  await expect.poll(async () => (await relativeBox(page, brushStrokes(page).first())).x).toBeCloseTo(beforeZoom.x, 2)
  const afterZoom = await relativeBox(page, brushStrokes(page).first())
  expect(afterZoom.y).toBeCloseTo(beforeZoom.y, 2)
  expect(afterZoom.w).toBeCloseTo(beforeZoom.w, 2)
  expect(afterZoom.h).toBeCloseTo(beforeZoom.h, 2)
  expect((await brushLook(brushStrokes(page).first())).layers[0]!.width).toBe(brushWidth) // stored width is zoom independent

  // 5. Undo / redo: the newest stroke (the Pen) goes away and comes back; the Brush stays.
  await page.keyboard.press('Control+z')
  await expect(strokes(page)).toHaveCount(1)
  await expect(brushStrokes(page)).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect(strokes(page)).toHaveCount(2)

  // 6. Stroke Eraser: one click on the Brush removes it as a whole; the Pen stays; undo brings it back.
  const slot = (await pdfPage(page, 1).boundingBox())!
  const brushMid = { x: slot.x + slot.width * 0.4, y: slot.y + slot.height * 0.14 }
  await chooseTool(page, 'Eraser')
  await page.mouse.click(brushMid.x, brushMid.y)
  await expect(brushStrokes(page)).toHaveCount(0)
  await expect(penStrokes(page)).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(brushStrokes(page)).toHaveCount(1)
  expect(await brushLook(brushStrokes(page).first())).toEqual(brush)
  await page.screenshot({ path: test.info().outputPath('pdf-ink-brush.png') })

  // 7. Restart: both strokes come back with their looks, and the dropdown still has the Brush settings.
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: /^Resume/ }).first()
    const pageInput = page.getByRole('textbox', { name: 'Current page' })
    await expect(resume.or(pageInput).first()).toBeVisible({ timeout: 20_000 })
    if (await resume.isVisible()) await resume.click()
    await goToPage(page, 1)
    await expect(strokes(page)).toHaveCount(2)
    expect(await brushLook(brushStrokes(page).first())).toEqual(brush)
    expect(await penLook(penStrokes(page).first())).toEqual(pen)
    dialog = await openSettings(page)
    await pickStyle(dialog, 'brush')
    await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#E91E63')
    await expect(dialog.getByText('70%')).toBeVisible()
    await closeSettings(page)
  } finally {
    await app.close().catch(() => {})
  }
})
