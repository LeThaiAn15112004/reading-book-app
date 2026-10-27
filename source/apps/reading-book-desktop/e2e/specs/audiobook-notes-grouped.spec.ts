import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, launchApp, test } from '../fixtures/app'
import type { AudioBookmarkDto } from '../../electron/ipc/api-types'
import { mp3Bytes } from '../support/audiobook-zip'
import {
  TRACKS, addNote, aside, bookIdOf, gotoTrack, groupRow, importAndOpen, mute, notesOf, openGroup, rail, seek, seekTo, shownSeconds, trackLabel,
  tracksOf, type WithApi,
} from '../support/audiobook-notes'
import { buildTocPdf } from '../support/build-toc-pdf.mjs'
import { currentPageInput, openBook } from '../support/reader'

const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

/**
 * specs/002-notes-grouped-by-track quickstart §4 (T021), automated: the multi-track Notes tab shows one row per track that has
 * Notes (closed rows render only their header), opened and closed by mouse and keyboard, with the open state kept across closing
 * the sidebar. Same 68-track synthetic ZIP as the 001 spec (hidden window, muted). Needs `features.audiobookZipImportEnabled` on.
 */

const groups = (page: Page) => aside(page).locator('[data-note-group]')
const expandedOf = async (page: Page, tracks: number[]) => Promise.all(tracks.map(async (n) => (await groupRow(page, n).getAttribute('aria-expanded')) === 'true'))
const openRows = (page: Page) => aside(page).locator('[data-note-group] > button[aria-expanded="true"]')
const playingRows = (page: Page) => aside(page).locator('[data-note-group] > button[aria-current="true"]')
const actionsFor = (page: Page, time: string) => aside(page).getByLabel(`Note actions for ${time}`)

test('grouped Notes tab (quickstart §4 / T021): rows only for tracks with Notes, mouse + keyboard toggling, state kept, follow the listener, restart, 500 Notes', async ({
  reader,
}, testInfo) => {
  test.setTimeout(600_000)
  const { page, app, userData } = reader
  const id = await importAndOpen(reader)
  const tracks = await tracksOf(page, id)
  expect(tracks.ok && tracks.tracks.length).toBe(TRACKS)
  if (!tracks.ok) return
  const ids = tracks.tracks.map((t) => t.id)

  // ---- 1. no Notes: the explanatory empty state ----
  await rail(page, 'Notes').click()
  await expect(aside(page).getByText(/No notes yet/)).toBeVisible()
  await expect(groups(page)).toHaveCount(0)

  // ---- 2./3. Notes on track 3, 12 (two) and 30: exactly three rows, count on each, "Playing" only on the current track ----
  await addNote(page, 3, 1)
  await addNote(page, 12, 3, 'twelve first')
  await addNote(page, 12, 7)
  await gotoTrack(page, 30)
  const end30 = Math.max(1, Math.floor(Number(await seek(page).getAttribute('max'))) - 1)
  await addNote(page, 30, end30, 'thirty')
  await rail(page, 'Notes').click()
  await expect(groups(page)).toHaveCount(3)
  await expect(groups(page).nth(0)).toHaveAttribute('data-note-group', ids[2] as string)
  await expect(groups(page).nth(1)).toHaveAttribute('data-note-group', ids[11] as string)
  await expect(groups(page).nth(2)).toHaveAttribute('data-note-group', ids[29] as string)
  await expect(groupRow(page, 3)).toHaveAccessibleName(/1 note$/)
  await expect(groupRow(page, 12)).toHaveAccessibleName(/2 notes$/)
  await expect(groupRow(page, 30)).toHaveAccessibleName(/1 note$/)
  await expect(playingRows(page)).toHaveCount(1)
  await expect(groupRow(page, 30)).toHaveAttribute('aria-current', 'true')

  // ---- 4. mouse close / open, keyboard (Enter, Space), two rows open at once, focus stays on the row ----
  await openGroup(page, 12)
  await groupRow(page, 12).click()
  await expect(groupRow(page, 12)).toHaveAttribute('aria-expanded', 'false')
  await expect(aside(page).getByRole('list', { name: 'Notes in 12 - Part 12' })).toHaveCount(0) // a closed row renders only its header
  await groupRow(page, 12).focus()
  await page.keyboard.press('Enter')
  await expect(groupRow(page, 12)).toHaveAttribute('aria-expanded', 'true')
  await expect(groupRow(page, 12)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(groupRow(page, 12)).toHaveAttribute('aria-expanded', 'false')
  await expect(groupRow(page, 12)).toBeFocused()
  await page.keyboard.press('Space')
  await openGroup(page, 3)
  expect(await expandedOf(page, [3, 12])).toEqual([true, true]) // two rows at once

  // ---- 5. inside an open row: time order, jump to another track, edit, delete (cancel first), the last Note removes its row ----
  const inTwelve = aside(page).getByRole('list', { name: 'Notes in 12 - Part 12' }).locator('[data-note-card]')
  await expect(inTwelve).toHaveCount(2)
  await expect(inTwelve.nth(0)).toContainText('0:03')
  await expect(inTwelve.nth(1)).toContainText('0:07')
  await inTwelve.nth(0).getByRole('button', { name: /Seek to note/ }).click() // another track than the playing one (30)
  await expect(trackLabel(page, 12)).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBe(3)
  await actionsFor(page, '0:07').click()
  await page.getByRole('menuitem', { name: 'Edit note' }).or(page.getByRole('menuitem', { name: 'Add note' })).click()
  await page.getByRole('dialog', { name: /Edit note|Add note/ }).getByRole('textbox').fill('seven edited')
  await page.getByRole('dialog', { name: /Edit note|Add note/ }).getByRole('button', { name: 'Save' }).click()
  await expect(inTwelve.nth(1)).toContainText('seven edited')
  await actionsFor(page, '0:07').click()
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(inTwelve).toHaveCount(2) // cancelled: nothing lost
  await actionsFor(page, '0:07').click()
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click()
  await expect(inTwelve).toHaveCount(1)
  await expect(groupRow(page, 12)).toHaveAccessibleName(/1 note$/)
  await expect(groups(page)).toHaveCount(3)
  await actionsFor(page, '0:01').click() // the only Note of track 3
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click()
  await expect(groups(page)).toHaveCount(2) // its row is gone
  await expect(groupRow(page, 3)).toHaveCount(0)

  // ---- 6. close the sidebar / switch to Contents and back: the rows are as left (12 open, 30 closed) ----
  await openGroup(page, 12)
  if ((await groupRow(page, 30).getAttribute('aria-expanded')) === 'true') await groupRow(page, 30).click()
  expect(await expandedOf(page, [12, 30])).toEqual([true, false])
  await aside(page).getByRole('button', { name: 'Close' }).click()
  await expect(aside(page)).toHaveCount(0)
  await rail(page, 'Notes').click()
  expect(await expandedOf(page, [12, 30])).toEqual([true, false])
  await rail(page, 'Contents').click()
  await rail(page, 'Notes').click()
  expect(await expandedOf(page, [12, 30])).toEqual([true, false])

  // ---- 7. a Note on a track that had none, made with the "+ Note" pill while the sidebar is closed: a NEW row, open, with the Note ----
  await gotoTrack(page, 50)
  await seekTo(page, 2)
  await aside(page).getByRole('button', { name: 'Close' }).click()
  await expect(aside(page)).toHaveCount(0)
  await page.getByRole('button', { name: '+ Note', exact: true }).click()
  await page.keyboard.press('Escape') // no text: the Note stays
  await rail(page, 'Notes').click()
  await expect(groups(page)).toHaveCount(3)
  await expect(groupRow(page, 50)).toHaveAttribute('aria-expanded', 'true')
  await expect(aside(page).getByRole('list', { name: 'Notes in 50 - Part 50' }).locator('[data-note-card]')).toHaveCount(1)

  // ---- 8. playback moving to another track neither opens nor closes a row; the "Playing" mark follows ----
  await gotoTrack(page, 29)
  await rail(page, 'Notes').click()
  const before = await expandedOf(page, [12, 30, 50])
  await expect(playingRows(page)).toHaveCount(0) // track 29 has no row
  await page.getByRole('button', { name: 'Next track' }).click()
  await expect(trackLabel(page, 30)).toBeVisible()
  await expect(groupRow(page, 30)).toHaveAttribute('aria-current', 'true')
  expect(await expandedOf(page, [12, 30, 50])).toEqual(before)
  await page.getByRole('button', { name: 'Next track' }).click()
  await expect(trackLabel(page, 31)).toBeVisible()
  await expect(playingRows(page)).toHaveCount(0)
  expect(await expandedOf(page, [12, 30, 50])).toEqual(before)

  // ---- 9. quit and restart: all Notes are there; only the playing track's row is open ----
  const stored = await notesOf(page, id)
  expect(stored.map((n) => n.trackId).sort()).toEqual([ids[11], ids[29], ids[49]].sort())
  await gotoTrack(page, 30) // make the playing track one that has a row, so "only the playing row is open" is meaningful
  await app.close()
  const app2 = await launchApp(userData)
  try {
    await mute(app2)
    const page2 = await app2.firstWindow()
    await page2.waitForLoadState('domcontentloaded')
    await page2.evaluate((b) => {
      window.location.hash = `#/reader/${b}`
    }, id)
    await expect(seek(page2)).toBeEnabled({ timeout: 30_000 })
    expect((await notesOf(page2, id)).length).toBe(3)
    await rail(page2, 'Notes').click()
    await expect(groups(page2)).toHaveCount(3)
    await expect(openRows(page2)).toHaveCount(1)
    await expect(playingRows(page2)).toHaveCount(1)
    await expect(playingRows(page2)).toHaveAttribute('aria-expanded', 'true')

    // ---- 10. ~500 Notes: the tab opens and rows open / close without a freeze > 1 s (SC-005) ----
    const many: AudioBookmarkDto[] = Array.from({ length: 500 }, (_, i) => ({
      id: `bulk-${i}`,
      label: `Note ${i}`,
      positionSeconds: (i % 10) + 1,
      note: `Bulk note ${i}`,
      trackId: ids[i % TRACKS] as string,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }))
    expect((await page2.evaluate((a) => (window as unknown as WithApi).api.audio.saveBookmarks(a), { bookId: id, bookmarks: many })).ok).toBe(true)
    await page2.reload()
    await expect(seek(page2)).toBeEnabled({ timeout: 30_000 })
    const t0 = Date.now()
    await rail(page2, 'Notes').click()
    await expect(groups(page2).first()).toBeVisible({ timeout: 10_000 })
    const openMs = Date.now() - t0
    const toggles = await page2.evaluate(async () => {
      const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-audio-sidebar] [data-note-group] > button'))
      let worst = 0
      for (const row of rows) {
        const start = performance.now()
        row.click()
        await new Promise((r) => requestAnimationFrame(r))
        worst = Math.max(worst, performance.now() - start)
      }
      return { rows: rows.length, worstToggleMs: Math.round(worst) }
    })
    const numbers = { openMs, ...toggles, notes: 500 }
    await testInfo.attach('sc-numbers', { body: JSON.stringify(numbers, null, 2), contentType: 'application/json' })
    console.log('T021 numbers', JSON.stringify(numbers))
    expect(openMs, 'SC-005: opening the Notes tab with 500 Notes takes < 1 s').toBeLessThan(1000)
    expect(toggles.worstToggleMs, 'SC-005: opening / closing a row takes < 1 s').toBeLessThan(1000)
  } finally {
    await app2.close().catch(() => {})
  }
})

test('grouped Notes tab (quickstart §4 step 11): a single-file audiobook keeps the flat list; a PDF and an EPUB still open', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page, app } = reader
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 30_000 })
  await mute(app)
  await reader.importBook(reader.writeFixture('single.mp3', mp3Bytes(1200, 7)))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(seek(page)).toBeEnabled({ timeout: 20_000 })
  const id = await bookIdOf(page)
  await seekTo(page, 4)
  await page.getByRole('button', { name: '+ Note', exact: true }).click()
  await page.keyboard.press('Escape')
  await rail(page, 'Notes').click()
  await expect(page.getByRole('list', { name: 'Notes' }).getByRole('listitem')).toHaveCount(1) // the flat list as before
  await expect(groups(page)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Tracks with notes' })).toHaveCount(0)
  expect((await notesOf(page, id))[0]?.trackId).toBeUndefined()

  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await openBook(reader, reader.writeFixture('toc.pdf', buildTocPdf()))
  await expect(currentPageInput(page)).toBeVisible()
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Chapter One' })).toBeVisible({ timeout: 30_000 })
})
