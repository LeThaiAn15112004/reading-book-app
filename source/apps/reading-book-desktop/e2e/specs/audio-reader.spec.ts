import { statSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, launchApp, test } from '../fixtures/app'
import type { DesktopApi } from '../../electron/ipc/api-types'
import { openTxt } from '../support/txt'

/**
 * Audiobook (MP3) in the BUILT app: `ReaderRoute` → `AudioBookScreen`, streamed through `rb-audio`.
 * Hidden window (see `launchApp`), throw-away userData, and the app's audio output is muted on top of
 * that. The fixture is generated here: MPEG-1 Layer III frames of digital silence with an ID3v2.3 tag
 * (title / artist / album / PNG cover) — a structural fixture, so these tests prove the app's wiring,
 * not codec coverage (decoding a real, encoder-made MP3 was measured separately in the PoC report).
 */

type WithApi = { api: DesktopApi }

const FRAME = (() => {
  const f = Buffer.alloc(417)
  f[0] = 0xff
  f[1] = 0xfb
  f[2] = 0x90
  return f
})()
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64')
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}
const frame = (id: string, body: Buffer) => Buffer.concat([Buffer.from(id), u32(body.length), Buffer.from([0, 0]), body])
const text = (s: string) => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')])
const synchsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])

const TITLE = 'E2E Audio Title'
const ARTIST = 'E2E Narrator'
/** 1500 frames × 1152 samples / 44.1 kHz ≈ 39.2 s. */
const FRAMES = 1500

type Chapter = [id: string, title: string, startMs: number, endMs: number]

function buildMp3(chapters: Chapter[] = []): Buffer {
  const chapterFrames = chapters.map(([id, title, a, b]) =>
    frame('CHAP', Buffer.concat([Buffer.from(`${id}\0`), u32(a), u32(b), u32(0xffffffff), u32(0xffffffff), frame('TIT2', text(title))])),
  )
  const toc = chapters.length
    ? [frame('CTOC', Buffer.concat([Buffer.from('toc\0'), Buffer.from([3, chapters.length]), Buffer.from(chapters.map(([id]) => `${id}\0`).join('')), frame('TIT2', text('TOC'))]))]
    : []
  const tag = Buffer.concat([
    ...toc,
    ...chapterFrames,
    frame('TIT2', text(TITLE)),
    frame('TPE1', text(ARTIST)),
    frame('TALB', text('E2E Album')),
    frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3]), Buffer.from('\0'), PNG1])),
  ])
  const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), synchsafe(tag.length), tag])
  return Buffer.concat([header, Buffer.concat(Array(FRAMES).fill(FRAME))])
}

const seek = (page: Page) => page.getByRole('slider', { name: 'Seek' })
const playButton = (page: Page) => page.getByRole('button', { name: 'Play', exact: true })
const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true })
const speed = (page: Page) => page.getByRole('combobox', { name: 'Playback speed' })
const sleepTimer = (page: Page) => page.getByRole('combobox', { name: 'Sleep timer' })
/** The app's own dropdown: open the combobox, pick an option from the listbox. */
async function choose(trigger: Locator, option: string) {
  await trigger.click()
  await trigger.page().getByRole('option', { name: option, exact: true }).click()
}

/** The id in `#/reader/{id}`. */
async function bookIdOf(page: Page): Promise<string> {
  const id = new URL(page.url()).hash.match(/reader\/([^/?]+)/)?.[1]
  expect(id, 'on a /reader/:bookId route').toBeTruthy()
  return decodeURIComponent(id as string)
}
const progressOf = (page: Page, id: string) =>
  page.evaluate((bookId) => (window as unknown as WithApi).api.overlay.getAudioProgress(bookId), id)

/** Belt and braces on top of the hidden window: nothing the page plays can reach the speakers. */
async function mute(app: import('@playwright/test').ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setAudioMuted(true)
  })
}

/** Position label "m:ss" left of the slider → seconds. */
async function shownSeconds(page: Page): Promise<number> {
  const label = await page.locator('[data-audio-elapsed]').textContent()
  const parts = (label ?? '0:00').split(':').map(Number)
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

test('audiobook: import, open in the player (not the text reader), play / pause / seek / speed, progress saved and restored', async ({
  reader,
}) => {
  const { page, app } = reader
  await mute(app)
  const bytes = buildMp3()
  const file = reader.writeFixture('e2e-audio.mp3', bytes)
  const mtime = statSync(file).mtimeMs

  // ---- import through the real "Add file" flow, open from the toast ----
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()

  // ---- ReaderRoute chose the audio player: title / author / cover, no text-reader chrome ----
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(ARTIST, { exact: true })).toBeVisible()
  await expect(seek(page)).toBeEnabled({ timeout: 10_000 })
  await expect(page.locator('main img[src^="rb-cover://"]')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Current page' })).toHaveCount(0)
  await expect(page.locator('textarea[data-txt-input]')).toHaveCount(0)
  const id = await bookIdOf(page)

  // Duration comes from the stream: ≈ 39 s, finite, shown as m:ss.
  const max = Number(await seek(page).getAttribute('max'))
  expect(max).toBeGreaterThan(38)
  expect(max).toBeLessThan(41)
  await expect(page.locator('[data-audio-remaining]')).toHaveText(/^-0:(39|40)$/) // Book scope: time left in the whole book

  // ---- play: the position advances; the button flips to Pause ----
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

  // ---- pause: stays put; resume: moves again ----
  await pauseButton(page).click()
  await expect(playButton(page)).toBeVisible()
  const paused = await shownSeconds(page)
  await page.waitForTimeout(1200)
  expect(await shownSeconds(page)).toBe(paused)
  await playButton(page).click()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThan(paused)
  await pauseButton(page).click()

  // ---- seek mid-file (slider, committed on blur) → the shown position and the saved progress follow ----
  await seek(page).fill('20')
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(20)
  await expect.poll(async () => (await progressOf(page, id))?.positionSeconds ?? -1, { timeout: 10_000 }).toBeGreaterThanOrEqual(19.5)

  // ---- skip buttons ----
  await page.getByRole('button', { name: 'Forward 30 seconds' }).click()
  await expect.poll(() => shownSeconds(page)).toBe(max > 50 ? 50 : Math.floor(max))
  await page.getByRole('button', { name: 'Back 15 seconds' }).click()
  await expect.poll(() => shownSeconds(page)).toBe(Math.floor(max) - 15)
  await seek(page).fill('12')
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(12)

  // ---- speed ----
  await choose(speed(page), '1.5×')
  await expect.poll(async () => (await progressOf(page, id))?.playbackRate ?? 0, { timeout: 10_000 }).toBe(1.5)

  // The saved progress: seconds + rate + duration, the percent mirrors it; nothing else about the book changed.
  const saved = await progressOf(page, id)
  expect(saved?.positionSeconds).toBeGreaterThanOrEqual(11.5)
  expect(saved?.positionSeconds).toBeLessThanOrEqual(12.5)
  expect(saved?.durationSeconds).toBeGreaterThan(38)

  // ---- leave while PLAYING: the exact position is flushed on the way out ----
  await seek(page).fill('5')
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(5)
  await playButton(page).click()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(6)
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => (await progressOf(page, id))?.positionSeconds ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(6)
  const afterLeave = (await progressOf(page, id))?.positionSeconds ?? 0

  // ---- come back through the route: position and speed restored ----
  await page.evaluate((bookId) => {
    window.location.hash = `#/reader/${bookId}`
  }, id)
  await expect(seek(page)).toBeEnabled({ timeout: 15_000 })
  await expect(speed(page)).toContainText('1.5×')
  const restored = await shownSeconds(page)
  expect(Math.abs(restored - Math.floor(afterLeave))).toBeLessThanOrEqual(1)
  await expect(playButton(page)).toBeVisible() // restoring never auto-plays

  // ---- the user's file is never touched ----
  expect(statSync(file).mtimeMs).toBe(mtime)
  expect(statSync(file).size).toBe(bytes.length)

  // ---- a text book still opens in the unchanged text reader, and back to the audiobook ----
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await openTxt(reader, 'regression.txt', Buffer.from('Plain text book.\n\nSecond paragraph.\n', 'utf8'))
  await expect(page.locator('textarea[data-txt-input]')).toBeVisible()
  await expect(seek(page)).toHaveCount(0)
  await page.evaluate((bookId) => {
    window.location.hash = `#/reader/${bookId}`
  }, id)
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('textarea[data-txt-input]')).toHaveCount(0)
})

test('audiobook: progress survives a full app restart; a moved file gets a specific error with "Locate file"', async ({
  reader,
}) => {
  const { page, app, userData } = reader
  await mute(app)
  const file = reader.writeFixture('e2e-restart.mp3', buildMp3())
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(seek(page)).toBeEnabled({ timeout: 20_000 })
  const id = await bookIdOf(page)

  await seek(page).fill('17')
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(17)
  await choose(speed(page), '1.25×')
  await expect.poll(async () => (await progressOf(page, id))?.playbackRate ?? 0, { timeout: 10_000 }).toBe(1.25)
  await expect.poll(async () => (await progressOf(page, id))?.positionSeconds ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(16.5)

  // ---- restart the app on the same data ----
  await app.close()
  const app2 = await launchApp(userData)
  try {
    await mute(app2)
    const page2 = await app2.firstWindow()
    await page2.waitForLoadState('domcontentloaded')
    await page2.evaluate((bookId) => {
      window.location.hash = `#/reader/${bookId}`
    }, id)
    await expect(seek(page2)).toBeEnabled({ timeout: 25_000 })
    await expect(page2.getByRole('heading', { name: TITLE })).toBeVisible()
    await expect(speed(page2)).toContainText('1.25×')
    expect(Math.abs((await shownSeconds(page2)) - 17)).toBeLessThanOrEqual(1)
    await expect(playButton(page2)).toBeVisible()

    // ---- the file disappears: reopening gives the specific error and the relink offer, not a media error ----
    await page2.getByRole('link', { name: 'Library', exact: true }).click()
    rmSync(file)
    await page2.evaluate((bookId) => {
      window.location.hash = `#/reader/${bookId}`
    }, id)
    await expect(page2.getByText('Could not open this book')).toBeVisible({ timeout: 15_000 })
    await expect(page2.getByText(/could not be found/i)).toBeVisible()
    await expect(page2.getByRole('button', { name: 'Locate file…' })).toBeVisible()
    await expect(page2.getByRole('button', { name: 'Try again' })).toBeVisible()
    await page2.getByRole('button', { name: 'Back to Library' }).click()
    await expect(page2.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 10_000 })
  } finally {
    await app2.close().catch(() => {})
  }
  expect(path.basename(file)).toBe('e2e-restart.mp3')
})

const CHAPTERS: Chapter[] = [
  ['c1', 'Intro', 0, 13_000],
  ['c2', 'Middle', 13_000, 26_000],
  ['c3', 'Finale', 26_000, 39_200],
]
/** The icon rail (same as the text reader's); clicking an icon opens the panel on that tab. */
const rail = (page: Page, name: 'Contents' | 'Bookmark' | 'Notes' | 'Attachment') => page.getByRole('button', { name, exact: true })
const scopeRadio = (page: Page, name: 'Book' | 'Chapter') => page.getByRole('radio', { name, exact: true })
const remainingText = (page: Page) => page.locator('[data-audio-remaining]').textContent()
const bookmarksOf = (page: Page, id: string) => page.evaluate((b) => (window as unknown as WithApi).api.audio.getBookmarks(b), id)

async function seekTo(page: Page, seconds: number) {
  await seek(page).fill(String(seconds))
  await seek(page).blur()
}

test('audiobook chapters: sidebar on the LEFT, Contents / Notes, Book vs Chapter timeline, chapter navigation, notes + timeline markers', async ({
  reader,
}) => {
  const { page, app } = reader
  await mute(app)
  const file = reader.writeFixture('e2e-chapters.mp3', buildMp3(CHAPTERS))
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(seek(page)).toBeEnabled({ timeout: 20_000 })

  // ---- layout: the text reader's icon rail + panel, on the LEFT of the player ----
  const aside = page.locator('[data-audio-sidebar]')
  await expect(aside).toHaveCount(0) // closed by default, like the text reader
  const railBox = (await page.getByRole('navigation', { name: 'Sidebar navigation' }).boundingBox())!
  await expect(rail(page, 'Contents')).toBeVisible()
  await expect(rail(page, 'Notes')).toBeVisible()
  await expect(rail(page, 'Attachment')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Page layout', exact: true })).toHaveCount(0) // audio has no pages
  await rail(page, 'Contents').click()
  await expect(aside).toBeVisible()
  const a = (await aside.boundingBox())!
  const sliderBox = (await seek(page).boundingBox())!
  expect(railBox.x).toBeLessThan(a.x)
  expect(a.x + a.width).toBeLessThanOrEqual(sliderBox.x + 1) // the player gives way to the panel

  // ---- chapters come from the file's ID3 CHAP frames ----
  await expect(rail(page, 'Contents')).toHaveAttribute('aria-pressed', 'true')
  await expect(aside.getByRole('heading', { name: 'Contents' })).toBeVisible()
  const rows = page.getByRole('list', { name: 'Chapters' }).getByRole('button')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Intro')
  await expect(rows.nth(1)).toContainText('Middle')
  await expect(rows.nth(2)).toContainText('Finale')
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByText('Chapter 1 of 3')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Intro' })).toBeVisible() // the chapter is the headline; the book title is the sub-line
  await expect(page.getByText(`${TITLE} · ${ARTIST}`)).toBeVisible()

  // ---- jump to a chapter from the list ----
  await rows.nth(1).click()
  await expect.poll(() => shownSeconds(page)).toBe(13)
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(rows.nth(0)).not.toHaveAttribute('aria-current', 'true')
  await expect(page.getByText('Chapter 2 of 3')).toBeVisible()

  // ---- Book vs Chapter: same audio position, different timeline ----
  await expect(scopeRadio(page, 'Book')).toHaveAttribute('aria-checked', 'true')
  expect(await remainingText(page)).toMatch(/^-0:(26|27)$/) // time left in the whole book
  await scopeRadio(page, 'Chapter').click()
  await expect(scopeRadio(page, 'Chapter')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => shownSeconds(page)).toBe(0) // 0:00 into chapter two …
  expect(await remainingText(page)).toBe('-0:13') // … with 0:13 of it left
  await expect(page.getByRole('slider', { name: /Seek \(chapter\)/ })).toHaveAttribute('max', '13')

  // seeking on the chapter timeline lands inside the chapter, on the book timeline
  await seekTo(page, 5)
  await expect.poll(() => shownSeconds(page)).toBe(5)
  await scopeRadio(page, 'Book').click()
  await expect.poll(() => shownSeconds(page)).toBe(18) // 13 + 5: the audio position is the same one
  await scopeRadio(page, 'Chapter').click()
  await expect.poll(() => shownSeconds(page)).toBe(5)

  // ---- next / previous chapter ----
  await page.getByRole('button', { name: 'Next chapter' }).click()
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => shownSeconds(page)).toBe(0) // the chapter timeline restarted for the new chapter
  await page.getByRole('button', { name: 'Previous chapter' }).click() // within 3 s of the start → the previous chapter
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true')

  // ---- Notes: one list drives the sidebar items AND the timeline markers ----
  await scopeRadio(page, 'Book').click()
  await seekTo(page, 20)
  await expect.poll(() => shownSeconds(page)).toBe(20)
  const id = await bookIdOf(page)
  await page.getByRole('button', { name: '+ Note', exact: true }).click()
  // creating a note opens its editor right away; the text is optional
  const editor = page.getByRole('dialog', { name: 'Add note' })
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox').fill('Great quote')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)

  await expect(rail(page, 'Bookmark')).toHaveCount(0) // audio's marked positions are its Notes
  await rail(page, 'Notes').click()
  await expect(aside.getByRole('heading', { name: 'Notes' })).toBeVisible()
  const items = page.getByRole('list', { name: 'Notes' }).getByRole('listitem')
  const markers = page.locator('[data-audio-note-marker]')
  await expect(items).toHaveCount(1)
  await expect(markers).toHaveCount(1)
  await expect(items.first()).toContainText('0:20')
  await expect(items.first()).toContainText('Great quote')
  await expect.poll(async () => (await bookmarksOf(page, id)).map((n) => n.note)).toEqual(['Great quote'])

  // the marker sits where the timestamp says (the native thumb's travel is inset by half its 16 px width)
  const track = (await seek(page).boundingBox())!
  const duration = Number(await seek(page).getAttribute('max'))
  const mark = (await markers.first().boundingBox())!
  const expectedX = track.x + 8 + ((track.width - 16) * 20) / duration
  expect(Math.abs(mark.x + mark.width / 2 - expectedX)).toBeLessThan(3)

  // clicking the marker opens its menu and must NOT also seek the timeline
  await seekTo(page, 2)
  await expect.poll(() => shownSeconds(page)).toBe(2)
  await markers.first().click()
  const menu = page.getByRole('menu', { name: 'Note at 0:20' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Edit note', 'Seek to position', 'Delete note'])
  expect(await shownSeconds(page)).toBe(2) // no seek happened
  await menu.getByRole('menuitem', { name: 'Seek to position' }).click()
  await expect(menu).toHaveCount(0)
  await expect.poll(() => shownSeconds(page)).toBe(20)

  // Edit from the marker: same note, new text, still ONE item and ONE marker
  await markers.first().click()
  await menu.getByRole('menuitem', { name: 'Edit note' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit note' })
  await expect(edit.getByRole('textbox')).toHaveValue('Great quote')
  await edit.getByRole('textbox').fill('Edited from the marker')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(items).toHaveCount(1)
  await expect(markers).toHaveCount(1)
  await expect(items.first()).toContainText('Edited from the marker')
  await expect.poll(async () => (await bookmarksOf(page, id)).map((n) => n.note)).toEqual(['Edited from the marker'])

  // A second note without text is still a valid note; the sidebar falls back to its label
  await seekTo(page, 30)
  await expect.poll(() => shownSeconds(page)).toBe(30)
  await page.getByRole('button', { name: '+ Note', exact: true }).click()
  await page.keyboard.press('Escape') // no text typed: the note stays
  await expect(items).toHaveCount(2)
  await expect(markers).toHaveCount(2)
  await expect(items.nth(1)).toContainText('0:30')
  await expect(items.nth(1)).toContainText('Finale') // the chapter it was made in
  await expect(items.nth(1)).toContainText('No text')
  await expect(items.nth(1)).toContainText('Here') // playback is at this note
  await expect(items.nth(0)).not.toContainText('Here')
  if (process.env.READMATE_AUDIO_SHOT_DIR) await page.screenshot({ path: path.join(process.env.READMATE_AUDIO_SHOT_DIR, 'audio-notes.png') })

  // Sidebar ⋮: the same actions. Click the item to seek, edit text from the menu
  await seekTo(page, 1)
  await items.nth(0).getByRole('button', { name: /Seek to note/ }).click()
  await expect.poll(() => shownSeconds(page)).toBe(20)
  await items.nth(1).getByRole('button', { name: /Note actions/ }).click()
  const sideMenu = page.getByRole('menu', { name: 'Note at 0:30' })
  await expect(sideMenu.getByRole('menuitem')).toHaveText(['Add note', 'Seek to position', 'Delete note'])
  await sideMenu.getByRole('menuitem', { name: 'Add note' }).click()
  await page.getByRole('dialog', { name: 'Add note' }).getByRole('textbox').fill('From the sidebar')
  await page.keyboard.press('Control+Enter')
  await expect(items.nth(1)).toContainText('From the sidebar')
  await expect(items).toHaveCount(2)

  // Keyboard: a marker is focusable, Enter opens its menu, ↓ moves, Esc closes
  await markers.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu', { name: 'Note at 0:30' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Edit note' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Seek to position' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Delete: asks first (Cancel keeps the note), then both views lose it at once
  await markers.nth(1).click()
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(items).toHaveCount(2)
  await items.nth(1).getByRole('button', { name: /Note actions/ }).click()
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click()
  await expect(items).toHaveCount(1)
  await expect(markers).toHaveCount(1)
  await markers.first().click() // …and from the marker
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No notes yet')).toBeVisible()
  await expect(markers).toHaveCount(0)
  await expect.poll(async () => (await bookmarksOf(page, id)).length).toBe(0)

  // ---- Attachment exists in the rail but says plainly that it is not available for audio ----
  await rail(page, 'Attachment').click()
  await expect(aside.getByText(/not available for audiobooks/i)).toBeVisible()

  // ---- the panel closes (✕ or the edge handle) and opens again, like the text reader's ----
  await aside.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(aside).toHaveCount(0)
  await page.getByRole('button', { name: 'Open sidebar' }).click()
  await expect(aside).toBeVisible()
  await page.getByRole('button', { name: 'Close sidebar' }).click()
  await expect(aside).toHaveCount(0)

  // Optional: save a screenshot for a visual check (READMATE_AUDIO_SHOT_DIR=<dir>).
  const shotDir = process.env.READMATE_AUDIO_SHOT_DIR
  await rail(page, 'Contents').click()
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'audio-sidebar-open.png') })

  // ---- the app-styled dropdowns: keyboard, selection state, outside click ----
  await speed(page).focus()
  await page.keyboard.press('ArrowDown')
  const listbox = page.getByRole('listbox', { name: 'Playback speed' })
  await expect(listbox).toBeVisible()
  await expect(listbox.getByRole('option', { name: '1×', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(listbox).toHaveCount(0)
  await expect(speed(page)).toContainText('1.25×')
  await speed(page).click()
  await expect(listbox).toBeVisible()
  await page.mouse.click(5, 300) // outside
  await expect(listbox).toHaveCount(0)
  await choose(sleepTimer(page), 'End of chapter') // enabled: this book has chapters
  await expect(sleepTimer(page)).toContainText('End of chapter')
  await choose(sleepTimer(page), 'Off')
  if (shotDir) {
    await speed(page).click()
    await page.screenshot({ path: path.join(shotDir, 'audio-speed-menu.png') })
    await page.keyboard.press('Escape')
  }

  // ---- keyboard: the scope selector is a radio group operable without a mouse ----
  await scopeRadio(page, 'Book').focus()
  await page.keyboard.press('ArrowRight')
  await expect(scopeRadio(page, 'Chapter')).toHaveAttribute('aria-checked', 'true')
})

test('audiobook without chapters: Book timeline works, Chapter is disabled with a reason, no fake chapters; notes and volume survive a restart', async ({
  reader,
}) => {
  const { page, app, userData } = reader
  await mute(app)
  const file = reader.writeFixture('e2e-nochapters.mp3', buildMp3())
  await reader.importBook(file)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(seek(page)).toBeEnabled({ timeout: 20_000 })
  const id = await bookIdOf(page)

  await rail(page, 'Contents').click()
  await expect(page.getByText(/no chapter information/i).first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'Chapters' })).toHaveCount(0)
  await expect(scopeRadio(page, 'Chapter')).toHaveAttribute('aria-disabled', 'true')
  await expect(scopeRadio(page, 'Chapter')).toHaveAttribute('title', /no chapter information/i)
  await expect(page.getByRole('button', { name: 'Next chapter' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Previous chapter' })).toBeDisabled()
  await expect(page.getByText(/^Chapter \d+ of \d+$/)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
  await scopeRadio(page, 'Chapter').click({ force: true }) // disabled: nothing happens
  await expect(scopeRadio(page, 'Book')).toHaveAttribute('aria-checked', 'true')
  await seekTo(page, 10)
  await expect.poll(() => shownSeconds(page)).toBe(10)
  await sleepTimer(page).click()
  await expect(page.getByRole('option', { name: 'End of chapter' })).toHaveAttribute('aria-disabled', 'true') // needs chapters
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)

  await page.getByRole('button', { name: '+ Note', exact: true }).click()
  await page.keyboard.press('Escape') // no text: still a valid note
  await expect.poll(async () => (await bookmarksOf(page, id)).length).toBe(1)
  await expect.poll(async () => (await progressOf(page, id))?.positionSeconds ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(9.5)
  await choose(sleepTimer(page), '15 min')
  await expect(sleepTimer(page)).toContainText('15 min')
  await page.getByRole('slider', { name: 'Volume' }).fill('0.4')

  await app.close()
  const app2 = await launchApp(userData)
  try {
    await mute(app2)
    const page2 = await app2.firstWindow()
    await page2.waitForLoadState('domcontentloaded')
    await page2.evaluate((bookId) => {
      window.location.hash = `#/reader/${bookId}`
    }, id)
    await expect(seek(page2)).toBeEnabled({ timeout: 25_000 })
    expect(Math.abs((await shownSeconds(page2)) - 10)).toBeLessThanOrEqual(1)
    await expect(page2.locator('[data-audio-sidebar]')).toBeVisible() // the open panel is remembered
    await rail(page2, 'Notes').click()
    await expect(page2.getByRole('list', { name: 'Notes' }).getByRole('listitem')).toHaveCount(1)
    await expect(page2.locator('[data-audio-note-marker]')).toHaveCount(1) // and its marker on the timeline
    await expect(page2.getByRole('slider', { name: 'Volume' })).toHaveValue('0.4') // remembered
    await expect(sleepTimer(page2)).toContainText('Off') // a sleep timer never outlives the session
  } finally {
    await app2.close().catch(() => {})
  }
})
