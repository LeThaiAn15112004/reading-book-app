import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test, type ReaderApp } from '../fixtures/app'
import type { DesktopApi } from '../../electron/ipc/api-types'
import { audiobookZip } from './audiobook-zip'

/** Shared by the multi-track audiobook Notes E2E specs (68-track ZIP, sidebar Notes tab helpers). */

export type WithApi = { api: DesktopApi }
export const TRACKS = 68
export const zipButton = (page: Page) => page.locator('[role="group"][aria-label="Import documents"] button').nth(2)
export const playButton = (page: Page) => page.getByRole('button', { name: 'Play', exact: true })
export const pauseButton = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true })
export const seek = (page: Page) => page.getByRole('slider', { name: 'Seek' })
export const trackLabel = (page: Page, n: number) => page.getByText(`Track ${n} of ${TRACKS}`).first()
export const aside = (page: Page) => page.locator('[data-audio-sidebar]')
export const rail = (page: Page, name: 'Contents' | 'Notes') => page.getByRole('button', { name, exact: true })
export const pad = (n: number) => String(n).padStart(2, '0')
export const trackRow = (page: Page, n: number) => aside(page).getByRole('button', { name: new RegExp(`${pad(n)} - Part ${n}\\b`) })
export const groupRow = (page: Page, n: number) => aside(page).getByRole('button', { name: new RegExp(`^Track ${n}, `) })
/** Open a track's group only when it is closed (the playing track's row opens by itself, a click toggles). */
export async function openGroup(page: Page, n: number) {
  const row = groupRow(page, n)
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
}
export const addNoteButton = (page: Page) => page.getByRole('button', { name: '+ Note at current position' })

export async function mute(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setAudioMuted(true)
  })
}
export async function shownSeconds(page: Page): Promise<number> {
  const label = await page.locator('[data-audio-elapsed]').textContent()
  return (label ?? '0:00').split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0)
}
export async function seekTo(page: Page, seconds: number) {
  await seek(page).fill(String(seconds))
  await seek(page).blur()
  await expect.poll(() => shownSeconds(page)).toBe(seconds)
}
export async function bookIdOf(page: Page): Promise<string> {
  const id = new URL(page.url()).hash.match(/reader\/([^/?]+)/)?.[1]
  expect(id, 'on a /reader/:bookId route').toBeTruthy()
  return decodeURIComponent(id as string)
}
export const notesOf = (page: Page, id: string) => page.evaluate((b) => (window as unknown as WithApi).api.audio.getBookmarks(b), id)
export const tracksOf = (page: Page, id: string) => page.evaluate((b) => (window as unknown as WithApi).api.audio.getTracks(b), id)

export async function importAndOpen(reader: ReaderApp): Promise<string> {
  const { page, app } = reader
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 30_000 })
  test.skip((await zipButton(page).count()) === 0 || !/audiobook zip/i.test((await zipButton(page).textContent()) ?? ''), 'the audiobook ZIP import is switched off in this build')
  await mute(app)
  const zip = reader.writeFixture('Notes test.zip', audiobookZip(TRACKS, 200))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, zip)
  await zipButton(page).click()
  const preview = page.getByRole('dialog', { name: /Import audiobook from/ })
  await expect(preview).toBeVisible({ timeout: 60_000 })
  await preview.getByRole('button', { name: `Import ${TRACKS} chapters` }).click()
  const done = page.getByRole('dialog', { name: 'Audiobook added' })
  await expect(done).toBeVisible({ timeout: 120_000 })
  await done.getByRole('button', { name: 'Open audiobook' }).click()
  await expect(trackLabel(page, 1)).toBeVisible({ timeout: 30_000 })
  await expect(seek(page)).toBeEnabled({ timeout: 30_000 })
  return bookIdOf(page)
}

/** Open the track `n` from Contents (paused stays paused), wait for it to load. */
export async function gotoTrack(page: Page, n: number) {
  await rail(page, 'Contents').click()
  await trackRow(page, n).click()
  await expect(trackLabel(page, n)).toBeVisible()
  await expect(seek(page)).toBeEnabled()
}

/** Add a Note at `seconds` of track `n` through the sidebar; `text` optional. */
export async function addNote(page: Page, n: number, seconds: number, text?: string) {
  await gotoTrack(page, n)
  await seekTo(page, seconds)
  await rail(page, 'Notes').click()
  await expect(addNoteButton(page)).toBeEnabled()
  await addNoteButton(page).click()
  const editor = page.getByRole('dialog', { name: /Add note|Edit note/ })
  await expect(editor).toBeVisible()
  if (text) {
    await editor.getByRole('textbox').fill(text)
    await editor.getByRole('button', { name: 'Save' }).click()
  } else {
    await page.keyboard.press('Escape') // no text: the Note stays
  }
  await expect(editor).toHaveCount(0)
}
