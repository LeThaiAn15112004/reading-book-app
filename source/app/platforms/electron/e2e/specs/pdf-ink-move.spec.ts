import type { Page } from '@playwright/test'
import { buildTextPdf } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * PDF freehand Ink — moving a drawn stroke with the Hand tool
 * (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md). Driven in the built Electron app with real
 * mouse input: draw with the Freehand tool, select the stroke with Hand, drag it somewhere else; it stays
 * on its page, can be undone, and survives an app restart.
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

const strokes = (page: Page, n: number) => pdfPage(page, n).locator('[data-pdf-ink-id]')

/** The stroke's box relative to its page (0–1) — independent of scroll, zoom and window position. */
async function strokeRect(page: Page, n: number) {
  const stroke = (await strokes(page, n).first().boundingBox())!
  const slot = (await pdfPage(page, n).boundingBox())!
  return {
    x: (stroke.x - slot.x) / slot.width,
    y: (stroke.y - slot.y) / slot.height,
    right: (stroke.x + stroke.width - slot.x) / slot.width,
    bottom: (stroke.y + stroke.height - slot.y) / slot.height,
  }
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

test('PDF freehand: select a stroke with Hand and drag it to a new place (clamped to the page, undoable, persisted)', async ({ reader }) => {
  test.setTimeout(180_000)
  let { page } = reader
  await openBook(reader, reader.writeFixture('ink-move.pdf', buildTextPdf()))
  await expect(pdfPage(page, 1).locator('canvas')).toHaveCount(1)

  // 1. Draw a diagonal stroke with the Freehand tool (real mouse drag).
  await chooseTool(page, 'Freehand')
  const slot = (await pdfPage(page, 1).boundingBox())!
  const from = { x: slot.x + slot.width * 0.2, y: slot.y + slot.height * 0.15 }
  const to = { x: slot.x + slot.width * 0.5, y: slot.y + slot.height * 0.25 }
  await drag(page, from, to)
  await expect(strokes(page, 1)).toHaveCount(1)
  const drawn = await strokeRect(page, 1)
  expect(drawn.x).toBeCloseTo(0.2, 1)
  expect(drawn.right).toBeCloseTo(0.5, 1)

  // 2. Hand tool: the stroke is not selected yet, so a drag on it pans the document instead of moving it.
  await chooseTool(page, 'Hand')
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  await drag(page, mid, { x: mid.x + 60, y: mid.y + 40 })
  const afterPan = await strokeRect(page, 1)
  expect(afterPan.x).toBeCloseTo(drawn.x, 2)
  expect(afterPan.y).toBeCloseTo(drawn.y, 2)

  // 3. A click selects it (halo). The page may have scrolled by the pan above: re-measure.
  const slot2 = (await pdfPage(page, 1).boundingBox())!
  const mid2 = { x: slot2.x + slot2.width * 0.35, y: slot2.y + slot2.height * 0.2 }
  await page.mouse.click(mid2.x, mid2.y)
  await expect(pdfPage(page, 1).locator('[data-pdf-ink-halo]')).toHaveCount(1)

  // 4. Drag the selected stroke: it follows the pointer and lands where the mouse was released.
  const before = await strokeRect(page, 1)
  const dx = slot2.width * 0.2
  const dy = slot2.height * 0.1
  await page.mouse.move(mid2.x, mid2.y)
  await page.mouse.down()
  await page.mouse.move(mid2.x + dx / 2, mid2.y + dy / 2, { steps: 6 })
  // Live preview while still pressed.
  await expect.poll(async () => (await strokeRect(page, 1)).x).toBeGreaterThan(before.x + 0.05)
  await page.mouse.move(mid2.x + dx, mid2.y + dy, { steps: 6 })
  await page.mouse.up()
  await expect(strokes(page, 1)).toHaveCount(1)
  await expect.poll(async () => (await strokeRect(page, 1)).x).toBeCloseTo(before.x + 0.2, 1)
  const moved = await strokeRect(page, 1)
  expect(moved.y).toBeCloseTo(before.y + 0.1, 1)
  expect(moved.right - moved.x).toBeCloseTo(before.right - before.x, 2) // same shape, only moved
  await expect(pdfPage(page, 1).locator('[data-pdf-ink-halo]')).toHaveCount(1) // still selected

  // 5. Undo puts it back, redo moves it again.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await strokeRect(page, 1)).x).toBeCloseTo(before.x, 2)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await strokeRect(page, 1)).x).toBeCloseTo(moved.x, 2)

  // 6. A drag far past the page edge stops at the edge: the stroke never leaves its page.
  const slot3 = (await pdfPage(page, 1).boundingBox())!
  const grab = { x: slot3.x + (moved.x + (moved.right - moved.x) / 2) * slot3.width, y: slot3.y + (moved.y + (moved.bottom - moved.y) / 2) * slot3.height }
  await expect(pdfPage(page, 1).locator('[data-pdf-ink-halo]')).toHaveCount(1)
  await drag(page, grab, { x: grab.x + slot3.width, y: grab.y })
  await expect.poll(async () => (await strokeRect(page, 1)).right).toBeLessThanOrEqual(1.01)
  const clamped = await strokeRect(page, 1)
  expect(clamped.right).toBeGreaterThan(0.97)
  await page.screenshot({ path: test.info().outputPath('pdf-ink-move.png') })

  // 7. Restart the app on the same data: the stroke is where it was left.
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: /^Resume/ }).first()
    const pageInput = page.getByRole('textbox', { name: 'Current page' })
    await expect(resume.or(pageInput).first()).toBeVisible({ timeout: 20_000 })
    if (await resume.isVisible()) await resume.click()
    await goToPage(page, 1)
    await expect(strokes(page, 1)).toHaveCount(1)
    const restored = await strokeRect(page, 1)
    expect(restored.right).toBeCloseTo(clamped.right, 2)
    expect(restored.y).toBeCloseTo(clamped.y, 2)
  } finally {
    await app.close().catch(() => {})
  }
})
