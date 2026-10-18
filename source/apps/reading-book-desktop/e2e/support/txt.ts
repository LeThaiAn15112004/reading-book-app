import { expect, type Locator, type Page } from '@playwright/test'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { DesktopApi } from '../../electron/ipc/api-types'
import type { ReaderApp } from '../fixtures/app'

/** The preload bridge, typed (the E2E project has no DOM globals for `window.api`). */
type WithApi = { api: DesktopApi }

/** The editable reading surface of an open TXT book. */
export const editor = (page: Page): Locator => page.locator('textarea[data-txt-input]')
/** The transparent layer that paints the annotation marks (and is measured for positions). */
export const backdrop = (page: Page): Locator => page.locator('[data-txt-backdrop]')
export const marks = (page: Page): Locator => backdrop(page).locator('.txt-mark')
export const saveStatus = (page: Page): Locator => page.locator('[data-txt-save-status]')

/** Import `bytes` as `name`, open it from the "Book added" toast and wait for the text. */
export async function openTxt(reader: ReaderApp, name: string, bytes: Buffer): Promise<string> {
  const file = reader.writeFixture(name, bytes)
  await reader.importBook(file)
  await reader.page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(editor(reader.page)).toBeVisible({ timeout: 20_000 })
  return file
}

/**
 * After an app restart the app lands in the Library (with "Continue reading") — or straight in the
 * book when it restores the open tab. Either way: end up in the book's text.
 */
export async function waitForTxt(page: Page): Promise<void> {
  const resume = page.getByRole('button', { name: /^Resume/ }).first()
  await expect(resume.or(editor(page)).first()).toBeVisible({ timeout: 25_000 })
  if (!(await editor(page).isVisible())) await resume.click()
  await expect(editor(page)).toBeVisible({ timeout: 20_000 })
}

export const textOf = (page: Page): Promise<string> => editor(page).inputValue()

/** Wait until the page says "Saved" (only ever shown after txt:commit succeeded). */
export async function waitSaved(page: Page): Promise<void> {
  await expect(saveStatus(page)).toHaveAttribute('data-txt-save-status', 'saved', { timeout: 15_000 })
}

/** Focus the text box and put the caret / selection at `[start, end]`. */
export async function select(page: Page, start: number, end = start): Promise<void> {
  await editor(page).evaluate(
    (el, [s, e]) => {
      const ta = el as HTMLTextAreaElement
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(s as number, e as number)
    },
    [start, end],
  )
}

export const selectionOf = (page: Page): Promise<{ start: number; end: number }> =>
  editor(page).evaluate((el) => {
    const ta = el as HTMLTextAreaElement
    return { start: ta.selectionStart, end: ta.selectionEnd }
  })

/** Client-space box of text offsets `[start, end)`, measured on the backdrop layer. */
export async function boxOf(page: Page, start: number, end: number): Promise<{ x: number; y: number; width: number; height: number }> {
  return backdrop(page).evaluate(
    (root, [s, e]) => {
      const spans = Array.from(root.children) as HTMLElement[]
      const find = (offset: number) => {
        for (let i = 0; i < spans.length; i++) {
          const span = spans[i]!
          const a = Number(span.dataset.start)
          const b = Number(span.dataset.end)
          if (offset < a || offset > b) continue
          if (offset === b && i < spans.length - 1) continue
          return { node: span.firstChild as Text, offset: offset - a }
        }
        throw new Error(`offset ${offset} not in backdrop`)
      }
      const from = find(s as number)
      const to = find(e as number)
      const range = document.createRange()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      const first = range.getClientRects()[0] ?? range.getBoundingClientRect()
      return { x: first.left, y: first.top, width: first.width, height: first.height }
    },
    [start, end],
  )
}

/** Scroll the reading surface so the text at `offset` is in view. */
export async function scrollToOffset(page: Page, offset: number): Promise<void> {
  const box = await boxOf(page, offset, offset + 1)
  await page.evaluate((y) => {
    const scroller = document.querySelector<HTMLElement>('[data-txt-surface]')!
    scroller.scrollTop += y - scroller.getBoundingClientRect().top - 80
  }, box.y)
}

/** The reader toolbar starts hidden; the menubar's "Tools" item shows it. */
export async function showToolbar(page: Page): Promise<void> {
  const tools = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Tools', exact: true })
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click()
  await expect(tools).toHaveAttribute('aria-expanded', 'true')
}

/** Arm / disarm a markup tool — each is an icon button in the toolbar's Annotation group. */
export async function toggleTool(
  page: Page,
  tool: 'Highlight' | 'Underline' | 'Squiggly' | 'Strikethrough' | 'Replace Text' | 'Insert Text',
  on: boolean,
): Promise<void> {
  await showToolbar(page)
  const button = page.getByRole('toolbar', { name: 'Reading tools' }).getByRole('button', { name: tool, exact: true })
  if (((await button.getAttribute('aria-pressed')) === 'true') !== on) await button.click()
  await expect(button).toHaveAttribute('aria-pressed', on ? 'true' : 'false')
}

/** Select `[start, end)`, right-click inside it and pick `action` in the selection menu. */
export async function menuAction(page: Page, start: number, end: number, action: string): Promise<void> {
  await scrollToOffset(page, start)
  await select(page, start, end)
  const box = await boxOf(page, start, Math.min(end, start + 3))
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Selection options' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: action, exact: true }).click()
}

/** The book's id (the only one in a fresh library). */
export const bookIdOf = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const books = await (window as unknown as WithApi).api.library.listBooks()
    return books[0]!.id
  })

/** The stored text + revision + annotations, read back through the real IPC (Main → disk + SQLite). */
export const storedDocument = (page: Page, id: string) =>
  page.evaluate(async (bookId) => {
    const doc = await (window as unknown as WithApi).api.txt.open(bookId)
    return {
      ok: doc.ok,
      text: doc.text ?? null,
      revision: doc.revision ?? -1,
      edited: doc.edited ?? false,
      highlights: (doc.highlights ?? []).map((h) => ({
        id: h.id,
        styleKind: h.styleKind,
        note: h.note ?? null,
        ...(JSON.parse(h.txtAnnotationRef!) as { startOffset: number; endOffset: number }),
        quote: h.selectionTextRef ? (JSON.parse(h.selectionTextRef) as { highlight?: string }).highlight ?? null : null,
      })),
    }
  }, id)

/** Files of the app's edited copy of a book, straight from the throw-away userData folder. */
export function editedCopyFiles(userData: string, id: string): string[] {
  const dir = path.join(userData, 'txt-edits', id)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

export function editedCopyText(userData: string, id: string, revision: number): string {
  return readFileSync(path.join(userData, 'txt-edits', id, `r${revision}.txt`), 'utf8')
}

/** Text of every mark segment, in document order (a mark split by an overlap shows up twice). */
export const markTexts = (page: Page): Promise<string[]> => marks(page).evaluateAll((els) => els.map((e) => e.textContent ?? ''))
