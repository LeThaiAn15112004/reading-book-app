import type { Locator, Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * PDF freehand Ink, Phase 2 (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md): the Freehand
 * dropdown (style, HEX colour, thickness, opacity), per-style settings, strokes that keep the look they
 * were drawn with, editing ONE selected stroke (undo / redo), and persistence across an app restart.
 * Real mouse / keyboard input in the built Electron app (hidden window).
 */

async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

async function chooseTool(page: Page, tool: 'Hand' | 'Freehand') {
  await showToolbar(page)
  const button = page.getByRole('button', { name: tool, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Freehand settings' })
const strokeDialog = (page: Page) => page.getByRole('dialog', { name: 'Selected stroke' })
const strokes = (page: Page) => pdfPage(page, 1).locator('[data-pdf-ink-id]')

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

async function pickStyle(dialog: Locator, style: 'pen' | 'pencil' | 'marker') {
  const option = dialog.locator(`[data-ink-style-option="${style}"]`)
  await option.click()
  await expect(option).toHaveAttribute('aria-pressed', 'true')
}

/** What a saved stroke looks like on the page. */
async function look(stroke: Locator) {
  return stroke.evaluate((el) => ({
    style: el.getAttribute('data-pdf-ink-style'),
    color: el.getAttribute('stroke')!.toUpperCase(),
    opacity: Number(el.getAttribute('stroke-opacity')),
    width: Number(el.getAttribute('stroke-width')),
    blend: getComputedStyle(el).mixBlendMode,
  }))
}

/** Draw a horizontal stroke at `yFrac` of the page height with the armed Freehand tool; returns a point on it. */
async function drawLine(page: Page, yFrac: number) {
  const slot = (await pdfPage(page, 1).boundingBox())!
  const from = { x: slot.x + slot.width * 0.2, y: slot.y + slot.height * yFrac }
  const to = { x: slot.x + slot.width * 0.6, y: from.y }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, from.y, { steps: 8 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  return { x: (from.x + to.x) / 2, y: from.y }
}

test('PDF freehand Phase 2: styles, HEX colour, per-style settings, edit one selected stroke, persistence', async ({ reader }) => {
  test.setTimeout(240_000)
  let { page } = reader
  await openBook(reader, reader.writeFixture('ink-styles.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)
  await showToolbar(page)

  // 1. The dropdown arrow opens the settings without arming the tool or drawing anything.
  const freehand = page.getByRole('button', { name: 'Freehand', exact: true })
  let dialog = await openSettings(page)
  await expect(freehand).toHaveAttribute('aria-pressed', 'false')
  await expect(strokes(page)).toHaveCount(0)
  await expect(dialog.locator('[data-ink-style-option]')).toHaveCount(4) // Pen, Pencil, Marker, Brush
  await expect(dialog.locator('[data-ink-style-option="pen"]')).toHaveAttribute('aria-pressed', 'true') // default tool

  // 2. Pen: opaque (no opacity control). Pencil / Marker: opacity slider. Each style has its own defaults.
  await expect(dialog.getByRole('slider', { name: 'Opacity' })).toHaveCount(0)
  await expect(dialog.getByText('always fully opaque')).toBeVisible()
  await pickStyle(dialog, 'marker')
  await expect(dialog.getByRole('slider', { name: 'Opacity' })).toBeVisible()
  await expect(dialog.getByText('35%')).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#FFEB3B')
  await pickStyle(dialog, 'pencil')
  await expect(dialog.getByText('80%')).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#424242')

  // 3. HEX colour: invalid text is flagged and not applied; a valid #RRGGBB is applied.
  const hex = dialog.getByRole('textbox', { name: 'Hex color' })
  await pickStyle(dialog, 'pen')
  await hex.fill('#12G')
  await expect(hex).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByRole('alert')).toHaveText('Use #RRGGBB')
  await hex.fill('#E53935')
  await expect(hex).toHaveAttribute('aria-invalid', 'false')
  await closeSettings(page)

  // 4. Draw a Pen stroke: red, opaque, plain blend.
  await chooseTool(page, 'Freehand')
  await drawLine(page, 0.12)
  await expect(strokes(page)).toHaveCount(1)
  const penLook = await look(strokes(page).nth(0))
  expect(penLook).toMatchObject({ style: 'pen', color: '#E53935', opacity: 1, blend: 'normal' })

  // 5. Marker with its own colour / thickness / opacity: wider, translucent, multiply.
  dialog = await openSettings(page)
  await pickStyle(dialog, 'marker')
  await dialog.getByRole('textbox', { name: 'Hex color' }).fill('#00BCD4')
  const thickness = dialog.getByRole('slider', { name: 'Thickness' })
  const widthBefore = (await thickness.inputValue()).length ? Number(await thickness.inputValue()) : 0
  await thickness.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => Number(await thickness.inputValue())).toBeGreaterThan(widthBefore)
  const opacity = dialog.getByRole('slider', { name: 'Opacity' })
  await opacity.focus()
  await page.keyboard.press('ArrowRight') // 35 % -> 40 %
  await expect(dialog.getByText('40%')).toBeVisible()
  await closeSettings(page)
  await expect(freehand).toHaveAttribute('aria-pressed', 'true') // still armed; the dropdown did not change the mode
  await drawLine(page, 0.22)
  await expect(strokes(page)).toHaveCount(2)
  const markerLook = await look(strokes(page).nth(1))
  expect(markerLook).toMatchObject({ style: 'marker', color: '#00BCD4', opacity: 0.4, blend: 'multiply' })
  expect(markerLook.width).toBeGreaterThan(penLook.width * 2)

  // 6. Pencil: thin and slightly translucent, again with its own memory.
  dialog = await openSettings(page)
  await pickStyle(dialog, 'pencil')
  await closeSettings(page)
  await drawLine(page, 0.32)
  await expect(strokes(page)).toHaveCount(3)
  const pencilLook = await look(strokes(page).nth(2))
  expect(pencilLook).toMatchObject({ style: 'pencil', color: '#424242', opacity: 0.8, blend: 'normal' })
  expect(pencilLook.width).toBeLessThan(penLook.width)

  // 7. Changing the tool settings never touches saved strokes.
  dialog = await openSettings(page)
  await pickStyle(dialog, 'pen')
  await dialog.getByRole('textbox', { name: 'Hex color' }).fill('#43A047')
  await closeSettings(page)
  expect(await look(strokes(page).nth(0))).toEqual(penLook)
  expect(await look(strokes(page).nth(1))).toEqual(markerLook)
  expect(await look(strokes(page).nth(2))).toEqual(pencilLook)

  // 8. Select ONE stroke with Hand and edit it: colour + style. Only that stroke changes.
  await chooseTool(page, 'Hand')
  const slot = (await pdfPage(page, 1).boundingBox())!
  const onSecond = { x: slot.x + slot.width * 0.4, y: slot.y + slot.height * 0.22 }
  await page.mouse.click(onSecond.x, onSecond.y)
  const panel = strokeDialog(page)
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-ink-style-option="marker"]')).toHaveAttribute('aria-pressed', 'true')
  await panel.getByRole('textbox', { name: 'Hex color' }).fill('#8E24AA')
  await expect.poll(async () => (await look(strokes(page).nth(1))).color).toBe('#8E24AA')
  await pickStyle(panel, 'pencil')
  await expect.poll(async () => (await look(strokes(page).nth(1))).style).toBe('pencil')
  const edited = await look(strokes(page).nth(1))
  expect(edited.color).toBe('#8E24AA')
  expect(edited.opacity).toBeGreaterThanOrEqual(0.3)
  expect(edited.opacity).toBeLessThanOrEqual(1)
  expect(edited.blend).toBe('normal')
  expect(await look(strokes(page).nth(0))).toEqual(penLook)
  expect(await look(strokes(page).nth(2))).toEqual(pencilLook)
  // The Freehand tool settings did not follow the edit (Pen is still the tool, green).
  dialog = await openSettings(page)
  await expect(dialog.locator('[data-ink-style-option="pen"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#43A047')
  await closeSettings(page)

  // 9. Undo / redo walk the edit back and forth (two steps: colour, then style).
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await look(strokes(page).nth(1))).style).toBe('marker')
  expect((await look(strokes(page).nth(1))).color).toBe('#8E24AA')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await look(strokes(page).nth(1))).color).toBe('#00BCD4')
  expect(await look(strokes(page).nth(1))).toEqual(markerLook)
  await page.keyboard.press('Control+Shift+z')
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await look(strokes(page).nth(1))).style).toBe('pencil')
  expect((await look(strokes(page).nth(1))).color).toBe('#8E24AA')
  await page.screenshot({ path: test.info().outputPath('pdf-ink-styles.png') })

  // 10. Restart: strokes keep their looks, and the dropdown remembers every style's settings.
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: /^Resume/ }).first()
    const pageInput = page.getByRole('textbox', { name: 'Current page' })
    await expect(resume.or(pageInput).first()).toBeVisible({ timeout: 20_000 })
    if (await resume.isVisible()) await resume.click()
    await goToPage(page, 1)
    await expect(strokes(page)).toHaveCount(3)
    expect(await look(strokes(page).nth(0))).toEqual(penLook)
    expect(await look(strokes(page).nth(1))).toEqual(edited)
    expect(await look(strokes(page).nth(2))).toEqual(pencilLook)

    dialog = await openSettings(page)
    await expect(dialog.locator('[data-ink-style-option="pen"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#43A047')
    await pickStyle(dialog, 'marker')
    await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#00BCD4')
    await expect(dialog.getByText('40%')).toBeVisible()
    await pickStyle(dialog, 'pencil')
    await expect(dialog.getByRole('textbox', { name: 'Hex color' })).toHaveValue('#424242')
    await closeSettings(page)
  } finally {
    await app.close().catch(() => {})
  }
})
