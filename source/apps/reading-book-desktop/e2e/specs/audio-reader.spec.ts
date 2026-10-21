import { statSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
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

function buildMp3(): Buffer {
  const tag = Buffer.concat([
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
const speed = (page: Page) => page.getByRole('combobox')

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
  const label = await page.locator('main .tabular-nums span').first().textContent()
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
  await expect(page.locator('main .tabular-nums span').nth(1)).toHaveText(/^0:3[89]$|^0:40$/)

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
  await speed(page).selectOption('1.5')
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
  await page.getByRole('button', { name: '← Library' }).click()
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 10_000 })
  const afterLeave = (await progressOf(page, id))?.positionSeconds ?? 0
  expect(afterLeave).toBeGreaterThanOrEqual(6)

  // ---- come back through the route: position and speed restored ----
  await page.evaluate((bookId) => {
    window.location.hash = `#/reader/${bookId}`
  }, id)
  await expect(seek(page)).toBeEnabled({ timeout: 15_000 })
  await expect(speed(page)).toHaveValue('1.5')
  const restored = await shownSeconds(page)
  expect(Math.abs(restored - Math.floor(afterLeave))).toBeLessThanOrEqual(1)
  await expect(playButton(page)).toBeVisible() // restoring never auto-plays

  // ---- the user's file is never touched ----
  expect(statSync(file).mtimeMs).toBe(mtime)
  expect(statSync(file).size).toBe(bytes.length)

  // ---- a text book still opens in the unchanged text reader, and back to the audiobook ----
  await page.getByRole('button', { name: '← Library' }).click()
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
  await speed(page).selectOption('1.25')
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
    await expect(speed(page2)).toHaveValue('1.25')
    expect(Math.abs((await shownSeconds(page2)) - 17)).toBeLessThanOrEqual(1)
    await expect(playButton(page2)).toBeVisible()

    // ---- the file disappears: reopening gives the specific error and the relink offer, not a media error ----
    await page2.getByRole('button', { name: '← Library' }).click()
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
