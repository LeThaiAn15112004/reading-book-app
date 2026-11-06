import type { Locator, Page } from '@playwright/test'
import { expect, launchApp, test } from '../fixtures/app'

/**
 * Markdown annotations (docs/implementation_plan/markdown_reader.md §5): highlight, underline, squiggly,
 * strikethrough, replace, insert and note, driven in the BUILT Electron app (hidden window). Marks are
 * painted with the CSS Custom Highlight API, so the checks read the registry and the generated rules.
 */

const LONG = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega. '
const PARAGRAPH = (n: number) => `Paragraph ${n}: ${LONG.repeat(4)}with **bold words** inside and more text after them.`
const MARKDOWN = ['# Annotations', '', PARAGRAPH(1), '', PARAGRAPH(2), '', PARAGRAPH(3), '', PARAGRAPH(4), ''].join('\n')

const surface = (page: Page) => page.locator('[data-md-surface]')
const paragraph = (page: Page, n: number) => page.locator('[data-md-content] p', { hasText: `Paragraph ${n}:` })
const painted = (page: Page) =>
  page.evaluate(() => {
    const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights
    return [...registry.keys()].filter((k) => k.startsWith('md-a-')).length
  })
/** Center of the first painted box of the N-th mark (marks are named in creation order). */
const markCenter = (page: Page, index: number) =>
  page.evaluate((i) => {
    const registry = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights
    const range = [...registry.get(`md-a-${i}`)!][0]!
    const r = range.getClientRects()[0]!
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, index)
const rules = (page: Page) => page.evaluate(() => document.getElementById('md-annotation-styles')?.textContent ?? '')
const carets = (page: Page) => page.locator('.md-caret[data-md-caret-id]')
const editDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit highlight' })
const insertDialog = (page: Page) => page.getByRole('dialog', { name: 'Insert text' })

async function showToolbar(page: Page) {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
  // The toolbar slides in and moves the page: let it settle before any pointer coordinates are used.
  await page.waitForTimeout(600)
}

async function armTool(page: Page, name: RegExp) {
  await showToolbar(page)
  const button = page.getByRole('button', { name }).first()
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Rect of the FIRST LINE of paragraph `n`'s text, after scrolling it into the (small) reading area. */
async function boxOf(page: Page, n: number) {
  return paragraph(page, n).evaluate((el) => {
    const scroller = el.closest('[data-md-surface]')!
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 40
    const range = document.createRange()
    range.selectNodeContents(el)
    const line = range.getClientRects()[0]!
    return { x: line.left, y: line.top, width: line.width, height: line.height }
  })
}

/** A real mouse drag along the first line of paragraph `n` (fractions of that line's width). */
async function dragOver(page: Page, n: number, from: number, to: number) {
  const box = await boxOf(page, n)
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * from, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to, y, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.up()
}

/** A locator's box once it has stopped moving (the page re-lays out and restores the scroll after a restart). */
async function settledBox(locator: Locator) {
  let previous = JSON.stringify(await locator.boundingBox())
  for (let i = 0; i < 20; i++) {
    await locator.page().waitForTimeout(250)
    const current = JSON.stringify(await locator.boundingBox())
    if (current === previous) return JSON.parse(current) as { x: number; y: number; width: number; height: number }
    previous = current
  }
  throw new Error('the element never stopped moving')
}

async function openMd(reader: Parameters<Parameters<typeof test>[2]>[0]['reader']) {
  const { page } = reader
  await reader.importBook(reader.writeFixture('marks.md', Buffer.from(MARKDOWN, 'utf8')))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(surface(page)).toBeVisible({ timeout: 20_000 })
  await expect(paragraph(page, 4)).toBeVisible()
}

test('MD annotations: every tool marks, paints, persists across a restart and can be removed', async ({ reader }) => {
  test.setTimeout(240_000)
  let { page } = reader
  await openMd(reader)
  const original = await page.locator('[data-md-content]').textContent()

  // 1. Highlight / Underline / Squiggly / Strikethrough: a drag with the tool armed marks the selection.
  const kinds: { tool: RegExp; paragraph: number; rule: RegExp }[] = [
    { tool: /^Highlight/, paragraph: 1, rule: /background-color/ },
    { tool: /^Underline/, paragraph: 2, rule: /underline solid/ },
    { tool: /^Squiggly/, paragraph: 3, rule: /underline wavy/ },
    { tool: /^Strikethrough/, paragraph: 4, rule: /line-through solid/ },
  ]
  let count = 0
  for (const kind of kinds) {
    await armTool(page, kind.tool)
    await dragOver(page, kind.paragraph, 0.1, 0.5)
    count += 1
    await expect.poll(() => painted(page)).toBe(count)
    expect(await rules(page)).toMatch(kind.rule)
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
  }
  // The book's own text is never touched.
  expect(await page.locator('[data-md-content]').textContent()).toBe(original)

  // 2. Replace Text: a drag strikes the text and opens the editor; the typed text is saved with the mark.
  await armTool(page, /^Replace Text/)
  await dragOver(page, 1, 0.55, 0.8)
  await expect(editDialog(page)).toBeVisible()
  await expect(editDialog(page).locator('textarea').first()).toHaveAttribute('placeholder', 'Replace with…')
  await editDialog(page).locator('textarea').first().fill('the new words')
  await editDialog(page).locator('textarea').first().blur()
  await page.keyboard.press('Escape') // first Escape disarms the Replace tool…
  await page.keyboard.press('Escape') // …the second closes the editor
  await expect(editDialog(page)).toBeHidden()
  await expect.poll(() => painted(page)).toBe(5)
  expect(await rules(page)).toMatch(/line-through dashed/)

  // Hovering the replaced text shows the replacement, moving away hides it.
  await boxOf(page, 1) // bring it into view
  const replaced = await markCenter(page, 4)
  await page.mouse.move(replaced.x, replaced.y, { steps: 4 })
  await expect(page.getByRole('tooltip')).toContainText('the new words')
  await page.mouse.move(5, 5, { steps: 4 })
  await expect(page.getByRole('tooltip')).toBeHidden()

  // 3. Insert Text: Escape / empty Save / Cancel leave nothing; a saved one draws a caret and a hover preview.
  await armTool(page, /^Insert Text/)
  const p2 = await boxOf(page, 2)
  await page.mouse.click(p2.x + p2.width * 0.3, p2.y + p2.height / 2)
  await expect(insertDialog(page)).toBeVisible()
  await expect(carets(page)).toHaveCount(1) // the draft caret
  await page.keyboard.press('Escape')
  await expect(insertDialog(page)).toBeHidden()
  await expect(carets(page)).toHaveCount(0)

  const p3 = await boxOf(page, 3)
  await page.mouse.click(p3.x + p3.width * 0.3, p3.y + p3.height / 2)
  await insertDialog(page).getByRole('button', { name: 'Save' }).click() // empty → nothing
  await expect(carets(page)).toHaveCount(0)

  await page.mouse.click(p3.x + p3.width * 0.3, p3.y + p3.height / 2)
  await insertDialog(page).locator('textarea').fill('never saved')
  await insertDialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(carets(page)).toHaveCount(0)

  await page.mouse.click(p3.x + p3.width * 0.3, p3.y + p3.height / 2)
  await insertDialog(page).locator('textarea').fill('the missing words')
  await insertDialog(page).getByRole('button', { name: 'Save' }).click()
  await expect(insertDialog(page)).toBeHidden()
  await expect(carets(page)).toHaveCount(1)
  const caret = (await carets(page).first().boundingBox())!
  // The caret hangs under its line: it starts inside paragraph 3's first line and ends below it.
  expect(caret.y).toBeGreaterThan(p3.y)
  expect(caret.y).toBeLessThan(p3.y + 24)
  await page.mouse.move(caret.x + caret.width / 2, caret.y + caret.height / 2, { steps: 4 })
  await expect(page.getByRole('tooltip')).toHaveText('the missing words')
  await page.mouse.move(5, 5, { steps: 4 })
  expect(await page.locator('[data-md-content]').textContent()).toBe(original)

  // 4. Restart the whole app on the same data: every mark and the caret come back.
  await reader.app.close()
  const app = await launchApp(reader.userData)
  try {
    page = await app.firstWindow()
    const resume = page.getByRole('button', { name: /^Resume/ }).first()
    await expect(resume).toBeVisible({ timeout: 20_000 })
    await resume.click()
    await expect(surface(page)).toBeVisible({ timeout: 20_000 })
    await expect(paragraph(page, 4)).toBeVisible()
    await expect.poll(() => painted(page)).toBe(5)
    await expect(carets(page)).toHaveCount(1)
    expect(await page.locator('[data-md-content]').textContent()).toBe(original)

    // Hover on the caret still shows its text; clicking it opens the editor with the text; delete removes it.
    await expect(carets(page).first()).toBeVisible()
    const restored = await settledBox(carets(page).first())
    await page.mouse.click(restored.x + restored.width / 2, restored.y + restored.height / 2)
    await expect(editDialog(page)).toBeVisible()
    await expect(editDialog(page).locator('textarea').first()).toHaveValue('the missing words')
    await editDialog(page).getByRole('button', { name: /Delete/ }).click()
    await expect(carets(page)).toHaveCount(0)

    // A text mark: click it → editor → delete → unpainted; undo brings it back.
    const hl = await boxOf(page, 1)
    await page.mouse.click(hl.x + hl.width * 0.3, hl.y + hl.height / 2)
    await expect(editDialog(page)).toBeVisible()
    await editDialog(page).getByRole('button', { name: /Delete/ }).click()
    await expect.poll(() => painted(page)).toBe(4)
    await page.keyboard.press('Control+z')
    await expect.poll(() => painted(page)).toBe(5)
  } finally {
    await app.close().catch(() => {})
  }
})

test('MD annotations: the selection menu marks text and a note keeps its text', async ({ reader }) => {
  test.setTimeout(120_000)
  const { page } = reader
  await openMd(reader)
  await showToolbar(page)

  const menu = page.getByRole('menu', { name: 'Selection options' })
  // A real drag then a right-click inside it; the hidden window can lag, so the pair is retried as a whole.
  await expect(async () => {
    await dragOver(page, 2, 0.1, 0.5)
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBeGreaterThan(5)
    const box = await boxOf(page, 2)
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2, { button: 'right' })
    await expect(menu).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await menu.getByRole('menuitem', { name: 'Add note', exact: true }).click()
  const note = page.getByRole('dialog', { name: 'Note' })
  await expect(note).toBeVisible()
  await note.locator('textarea').fill('Remember this')
  await note.locator('textarea').press('Control+Enter')
  await expect(note).toBeHidden()
  await expect.poll(() => painted(page)).toBe(1)
  expect(await rules(page)).toMatch(/underline dotted/)

  // The Notes sidebar lists it.
  const notesTab = page.getByRole('navigation', { name: 'Sidebar navigation' }).getByRole('button', { name: 'Notes', exact: true })
  if ((await notesTab.getAttribute('aria-pressed')) !== 'true') await notesTab.click()
  await page.getByRole('complementary').getByRole('button', { name: /^Text/ }).click() // the (collapsed) group
  await expect(page.getByRole('complementary').getByText('Remember this')).toBeVisible()
})
