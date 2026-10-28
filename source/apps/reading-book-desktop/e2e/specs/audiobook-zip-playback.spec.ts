import { chmodSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, launchApp, test, type ReaderApp } from '../fixtures/app'
import type { DesktopApi } from '../../electron/ipc/api-types'
import { audiobookZip } from '../support/audiobook-zip'

/**
 * Multi-track audiobook PLAYBACK in the built app (hidden window, throw-away userData, audio muted): an audiobook imported from a
 * ZIP of 4 tracks of ≈6.4 s each (synthetic MPEG frames of silence — the wiring is real, the codec coverage is not).
 *
 *   A. tracks in Contents, play, AUTOMATIC advance to the next track at the end of a track (no click), previous / next keep the play
 *      state, a click on a track keeps it, a click on the current track does nothing, the last track stops, no Notes / percent
 *   B. progress is `trackId` + position inside the track and survives a full restart
 *   C. a track whose file is gone: only that track fails, the player stays up, nothing skips on by itself, "Skip to next track" works
 *
 * Needs `features.audiobookZipImportEnabled` on in the build (the committed value is off: the specs are then skipped).
 */

type WithApi = { api: DesktopApi }
const TRACKS = 4
const zipButton = (page: Page) => page.locator('[role="group"][aria-label="Import documents"] button').nth(2)
const playButton = (page: Page) => page.getByRole('button', { name: 'Play', exact: true })
const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true })
const seek = (page: Page) => page.getByRole('slider', { name: 'Seek' })
const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const trackLabel = (page: Page, n: number) => page.getByText(`Track ${n} of ${TRACKS}`).first()
const aside = (page: Page) => page.locator('[data-audio-sidebar]')
const row = (page: Page, n: number) => aside(page).getByRole('button', { name: new RegExp(`0${n} - Part ${n}`) })

async function mute(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setAudioMuted(true)
  })
}
async function shownSeconds(page: Page): Promise<number> {
  const label = await page.locator('[data-audio-elapsed]').textContent()
  return (label ?? '0:00').split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0)
}
async function bookIdOf(page: Page): Promise<string> {
  const id = new URL(page.url()).hash.match(/reader\/([^/?]+)/)?.[1]
  expect(id, 'on a /reader/:bookId route').toBeTruthy()
  return decodeURIComponent(id as string)
}
const progressOf = (page: Page, id: string) => page.evaluate((bookId) => (window as unknown as WithApi).api.overlay.getAudioProgress(bookId), id)
const tracksOf = (page: Page, id: string) => page.evaluate((bookId) => (window as unknown as WithApi).api.audio.getTracks(bookId), id)

/** Import a 4-track ZIP through the real preview flow and open the audiobook; returns its book id. Skips when the feature is off. */
async function importAndOpen(reader: ReaderApp, zipName: string): Promise<string> {
  const { page, app } = reader
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 30_000 })
  test.skip((await zipButton(page).count()) === 0 || !/audiobook zip/i.test((await zipButton(page).textContent()) ?? ''), 'the audiobook ZIP import is switched off in this build')
  await mute(app)
  const zip = reader.writeFixture(zipName, audiobookZip(TRACKS))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, zip)
  await zipButton(page).click()
  const preview = page.getByRole('dialog', { name: /Import audiobook from/ })
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await preview.getByRole('button', { name: `Import ${TRACKS} chapters` }).click()
  const done = page.getByRole('dialog', { name: 'Audiobook added' })
  await expect(done).toBeVisible({ timeout: 60_000 })
  await done.getByRole('button', { name: 'Open audiobook' }).click()
  await expect(trackLabel(page, 1)).toBeVisible({ timeout: 20_000 })
  await expect(seek(page)).toBeEnabled({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Contents', exact: true }).click()
  await expect(aside(page)).toBeVisible()
  return bookIdOf(page)
}

test('multi-track playback: tracks in Contents, AUTO-ADVANCE at the end of a track, previous / next / click keep the play state, the last track stops', async ({ reader }) => {
  const { page } = reader
  await importAndOpen(reader, 'Playback test.zip')

  // ---- what is on screen: the track list, the current track as the heading, no Notes, no whole-book percent ----
  await expect(aside(page).getByText(`${TRACKS} tracks`)).toBeVisible()
  await expect(aside(page).getByRole('listitem')).toHaveCount(TRACKS)
  await expect(heading(page)).toHaveText('01 - Part 1')
  await expect(row(page, 1)).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ Note' })).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/\d+% ·/)
  await expect(page.getByRole('radio', { name: 'Chapter', exact: true })).toHaveCount(0) // no Book / Chapter selector

  // ---- play; at the end of track 1 the player moves on by ITSELF and keeps playing (the autoplay question) ----
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  await expect(trackLabel(page, 2)).toBeVisible({ timeout: 30_000 }) // no click in between
  await expect(heading(page)).toHaveText('02 - Part 2')
  await expect(row(page, 2)).toHaveAttribute('aria-current', 'true')
  await expect(pauseButton(page)).toBeVisible()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1) // and it really is playing track 2

  // ---- Next / Previous keep the play state ----
  await page.getByRole('button', { name: 'Next track' }).click()
  await expect(trackLabel(page, 3)).toBeVisible()
  await expect(pauseButton(page)).toBeVisible() // was playing → still playing
  await pauseButton(page).click()
  await expect(playButton(page)).toBeVisible()
  await page.getByRole('button', { name: 'Previous track' }).click() // under 3 s into track 3: back one track
  await expect(trackLabel(page, 2)).toBeVisible()
  await expect(playButton(page)).toBeVisible() // was paused → still paused
  await page.getByRole('button', { name: 'Next track' }).click()
  await expect(trackLabel(page, 3)).toBeVisible()
  await expect(playButton(page)).toBeVisible()

  // ---- a click on a track (paused → stays paused); a click on the CURRENT track does nothing ----
  await row(page, 4).click()
  await expect(trackLabel(page, 4)).toBeVisible()
  await expect(heading(page)).toHaveText('04 - Part 4')
  await expect(playButton(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next track' })).toBeDisabled() // the last track
  await seek(page).fill('3')
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(3)
  await row(page, 4).click()
  await page.waitForTimeout(500)
  expect(await shownSeconds(page)).toBe(3)
  await expect(trackLabel(page, 4)).toBeVisible()

  // ---- Previous after MORE than 3 s restarts the track (it does not leave it) ----
  await seek(page).fill('5')
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(5)
  await page.getByRole('button', { name: 'Previous track' }).click()
  await expect(trackLabel(page, 4)).toBeVisible()
  await expect.poll(() => shownSeconds(page)).toBe(0)

  // ---- the last track just STOPS at its end: not restarted, no further track ----
  const max = Number(await seek(page).getAttribute('max'))
  await seek(page).fill(String(Math.max(0, Math.floor(max) - 2)))
  await seek(page).blur()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect(playButton(page)).toBeVisible({ timeout: 15_000 }) // it stopped by itself
  await expect(trackLabel(page, 4)).toBeVisible()
  await expect(heading(page)).toHaveText('04 - Part 4')
  expect(await shownSeconds(page)).toBeGreaterThanOrEqual(Math.floor(max) - 1)
})

test('multi-track progress: trackId + position inside the track, restored after a full app restart', async ({ reader }) => {
  const { page, app, userData } = reader
  const id = await importAndOpen(reader, 'Restart test.zip')
  const tracks = await tracksOf(page, id)
  expect(tracks.ok && tracks.tracks.length).toBe(TRACKS)

  await row(page, 3).click()
  await expect(trackLabel(page, 3)).toBeVisible()
  await playButton(page).click()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  await pauseButton(page).click()
  const heard = await shownSeconds(page)

  // the saved progress names track 3 and a position INSIDE it (the save follows the pause a moment later); no book-level numbers
  await expect
    .poll(
      async () => {
        const p = await progressOf(page, id)
        return p?.trackId === tracks.tracks[2]?.id && Math.abs((p?.positionSeconds ?? -99) - heard) <= 1.5
      },
      { timeout: 15_000 },
    )
    .toBe(true)
  const saved = await progressOf(page, id)
  expect(saved?.durationSeconds).toBeUndefined()
  expect(saved?.chapterId).toBeUndefined()

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
    await expect(trackLabel(page2, 3)).toBeVisible()
    await expect(heading(page2)).toHaveText('03 - Part 3')
    expect(Math.abs((await shownSeconds(page2)) - (saved?.positionSeconds ?? 0))).toBeLessThanOrEqual(1.5)
    await expect(playButton(page2)).toBeVisible() // restored paused
  } finally {
    await app2.close().catch(() => {})
  }
})

test('multi-track: a track whose file is gone fails alone — the player stays up, nothing skips by itself, "Skip to next track" moves on', async ({ reader }) => {
  const { page, userData } = reader
  await importAndOpen(reader, 'Broken track test.zip')

  // remove track 2's file from the book's own folder (chapter files are named {position}-{id}.{ext})
  const booksDir = path.join(userData, 'books')
  const bookDir = path.join(booksDir, readdirSync(booksDir)[0] as string)
  const victim = readdirSync(bookDir).find((f) => f.startsWith('0001-')) as string
  expect(victim).toBeTruthy()
  chmodSync(path.join(bookDir, victim), 0o666)
  rmSync(path.join(bookDir, victim))

  // play track 1 to its end: the player advances onto the broken track and STOPS there
  await playButton(page).click()
  await expect(trackLabel(page, 2)).toBeVisible({ timeout: 30_000 })
  const alert = page.getByRole('alert').filter({ hasText: 'could not be played' })
  await expect(alert).toBeVisible({ timeout: 10_000 })
  await expect(alert).toContainText('02 - Part 2')
  await expect(aside(page).getByText("⚠ Can't play")).toBeVisible()
  await expect(playButton(page)).toBeVisible() // stopped
  await expect(heading(page)).toHaveText('02 - Part 2') // the player is still there (no full-screen error)
  await page.waitForTimeout(1500)
  await expect(trackLabel(page, 2)).toBeVisible() // it did not skip on to track 3 by itself

  // the user decides: skip → track 3 loads, the notice goes, the other tracks work
  await alert.getByRole('button', { name: 'Skip to next track' }).click()
  await expect(trackLabel(page, 3)).toBeVisible()
  await expect(alert).toBeHidden()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)

  // clicking the broken track again retries it (and fails again, alone)
  await row(page, 2).click()
  await expect(alert).toBeVisible({ timeout: 10_000 })
  await expect(trackLabel(page, 2)).toBeVisible()
  await row(page, 4).click()
  await expect(trackLabel(page, 4)).toBeVisible()
  await expect(alert).toBeHidden()
})
