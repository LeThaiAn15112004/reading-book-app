import type { Page } from '@playwright/test'
import { buildTextPdf, textPdfLine } from '../support/build-text-pdf.mjs'
import { expect, launchApp, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * PDF Inserted Text (docs/implementation_plan/pdf_inserted_text.md), driven in the built Electron app:
 * a click with the Insert Text tool places a small caret under the line, an editor takes the text,
 * hovering the caret shows it, and it survives zoom, scrolling and a full restart. Cancelling leaves
 * nothing behind and the PDF's own text is never touched.
 */

const lineSpan = (page: Page, n: number, line: number) =>
  pdfPage(page, n).locator('.textLayer span', { hasText: textPdfLine(n, line) })

const carets = (page: Page, n: number) => pdfPage(page, n).locator('.rb-pdf-annot[data-kind="insert"][data-caret]')

async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

/** Arm the Insert Text tool (an inline icon, or inside the Annotation dropdown on a narrow window). */
async function armInsertTool(page: Page) {
  await showToolbar(page)
  const inline = page.getByRole('button', { name: /^Insert Text/ })
  if (await inline.first().isVisible().catch(() => false)) {
    await inline.first().click()
    return
  }
  await page.getByRole('button', { name: 'Annotation', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: /Insert/ }).click()
}

/** Click into the middle of line `line`'s glyph run (an insertion point between two letters). */
async function clickInsideLine(page: Page, n: number, line: number, at = 0.5) {
  await expect(lineSpan(page, n, line)).toBeVisible()
  const box = (await lineSpan(page, n, line).boundingBox())!
  const x = box.x + box.width * at
  await page.mouse.click(x, box.y + box.height / 2)
  return { x, box }
}

const insertDialog = (page: Page) => page.getByRole('dialog', { name: 'Insert text' })

/** How far the caret box is from "centered on x, hanging under the line bottom" (px, worst of the two). */
async function caretMisplacement(page: Page, n: number, line: number, x: number): Promise<number> {
  const caret = (await carets(page, n).first().boundingBox())!
  const span = (await lineSpan(page, n, line).boundingBox())!
  const dx = Math.abs(caret.x + caret.width / 2 - x)
  // The caret starts inside the line (above its bottom edge) and ends below it.
  const startsInside = caret.y < span.y + span.height && caret.y > span.y
  const endsBelow = caret.y + caret.height > span.y + span.height
  return startsInside && endsBelow ? dx : Infinity
}

test('PDF Inserted Text: place, cancel, save, hover, zoom, restart, edit, delete', async ({ reader }) => {
  test.setTimeout(180_000)
  let { page } = reader
  await openBook(reader, reader.writeFixture('inserted-text.pdf', buildTextPdf()))
  const originalText = await lineSpan(page, 1, 3).textContent()
  await armInsertTool(page)

  // 1. A click places a draft caret and opens the editor; nothing is saved yet.
  const placed = await clickInsideLine(page, 1, 3)
  await expect(insertDialog(page)).toBeVisible()
  await expect(carets(page, 1)).toHaveCount(1)
  expect(await caretMisplacement(page, 1, 3, placed.x)).toBeLessThan(8)

  // 2. Escape cancels: no caret, no annotation.
  await page.keyboard.press('Escape')
  await expect(insertDialog(page)).toBeHidden()
  await expect(carets(page, 1)).toHaveCount(0)

  // 3. Saving an empty editor creates nothing either.
  await clickInsideLine(page, 1, 3)
  await expect(insertDialog(page)).toBeVisible()
  await insertDialog(page).getByRole('button', { name: 'Save' }).click()
  await expect(insertDialog(page)).toBeHidden()
  await expect(carets(page, 1)).toHaveCount(0)

  // 4. Cancel button on a typed draft also leaves nothing.
  await clickInsideLine(page, 1, 3)
  await insertDialog(page).locator('textarea').fill('never saved')
  await insertDialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(carets(page, 1)).toHaveCount(0)

  // 5. A real one: text typed, saved, caret stays on the line.
  const saved = await clickInsideLine(page, 1, 3, 0.4)
  await insertDialog(page).locator('textarea').fill('the missing words')
  await insertDialog(page).getByRole('button', { name: 'Save' }).click()
  await expect(insertDialog(page)).toBeHidden()
  await expect(carets(page, 1)).toHaveCount(1)
  expect(await caretMisplacement(page, 1, 3, saved.x)).toBeLessThan(8)
  // The PDF's own text is untouched.
  await expect(lineSpan(page, 1, 3)).toHaveText(originalText!)

  // 6. Hovering the caret shows the inserted text; moving away hides it.
  const hoverOnCaret = async () => {
    const caret = (await carets(page, 1).first().boundingBox())!
    await page.mouse.move(caret.x + caret.width / 2, caret.y + caret.height / 2, { steps: 4 })
  }
  await hoverOnCaret()
  await expect(page.getByRole('tooltip')).toHaveText('the missing words')
  await page.mouse.move(5, 5, { steps: 4 })
  await expect(page.getByRole('tooltip')).toBeHidden()

  // 7. Zoom: the caret stays on its insertion point, hover still works.
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const zoomedSpan = (await lineSpan(page, 1, 3).boundingBox())!
  const zoomedX = zoomedSpan.x + zoomedSpan.width * ((saved.x - saved.box.x) / saved.box.width)
  await expect.poll(() => caretMisplacement(page, 1, 3, zoomedX)).toBeLessThan(10)
  await hoverOnCaret()
  await expect(page.getByRole('tooltip')).toHaveText('the missing words')
  await page.mouse.move(5, 5, { steps: 4 })

  // 8. Scroll far away and back (page 1's canvas is released): the caret is still there.
  await goToPage(page, 14)
  await expect(carets(page, 1)).toHaveCount(1)
  await goToPage(page, 1)
  await expect(lineSpan(page, 1, 3)).toBeVisible()

  // 9. Restart the whole app on the same data: caret and text come back.
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: /^Resume/ }).first()
    const pageInput = page.getByRole('textbox', { name: 'Current page' })
    await expect(resume.or(pageInput).first()).toBeVisible({ timeout: 20_000 })
    if (await resume.isVisible()) await resume.click()
    await goToPage(page, 1)
    await expect(carets(page, 1)).toHaveCount(1)
    await expect(lineSpan(page, 1, 3)).toHaveText(originalText!)

    const caret = (await carets(page, 1).first().boundingBox())!
    await page.mouse.move(caret.x + caret.width / 2, caret.y + caret.height / 2, { steps: 4 })
    await expect(page.getByRole('tooltip')).toHaveText('the missing words')
    await page.mouse.move(5, 5, { steps: 4 })

    // 10. Click the saved caret: the usual editor opens with the text; edit it, then delete the mark.
    await showToolbar(page)
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    // The page re-fits after a restart: measure the caret again right before pressing it.
    await page.waitForTimeout(500)
    const fresh = (await carets(page, 1).first().boundingBox())!
    await page.mouse.click(fresh.x + fresh.width / 2, fresh.y + fresh.height / 2)
    const edit = page.getByRole('dialog', { name: 'Edit highlight' })
    await expect(edit).toBeVisible()
    await expect(edit.locator('textarea').first()).toHaveValue('the missing words')
    await edit.locator('textarea').first().fill('changed words')
    await edit.locator('textarea').first().blur() // the editor saves the text when the field loses focus
    await page.keyboard.press('Escape')
    await expect(edit).toBeHidden()
    // The page can re-fit again while the editor closes: measure once more before pressing the caret.
    await page.waitForTimeout(500)
    const again = (await carets(page, 1).first().boundingBox())!
    await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2)
    await expect(edit.locator('textarea').first()).toHaveValue('changed words')
    await edit.getByRole('button', { name: /Delete/ }).click()
    await expect(carets(page, 1)).toHaveCount(0)

    // 11. Repeated create / delete leaves nothing behind.
    await armInsertTool(page)
    for (let i = 0; i < 2; i++) {
      await clickInsideLine(page, 1, 4, 0.3 + i * 0.2)
      await insertDialog(page).locator('textarea').fill(`round ${i}`)
      await insertDialog(page).getByRole('button', { name: 'Save' }).click()
      await expect(carets(page, 1)).toHaveCount(1)
      await page.keyboard.press('Control+z')
      await expect(carets(page, 1)).toHaveCount(0)
    }
  } finally {
    await app.close().catch(() => {})
  }
})
