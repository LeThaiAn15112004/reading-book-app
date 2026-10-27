import { chmodSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { expect, launchApp, test } from '../fixtures/app'
import type { AudioBookmarkDto } from '../../electron/ipc/api-types'
import { mp3Bytes } from '../support/audiobook-zip'
import {
  TRACKS, addNote, aside, bookIdOf, gotoTrack, groupRow, importAndOpen, mute, notesOf, openGroup, pauseButton, playButton, rail, seek, seekTo,
  shownSeconds, trackLabel, trackRow, tracksOf, type WithApi,
} from '../support/audiobook-notes'
import { buildTocPdf } from '../support/build-toc-pdf.mjs'
import { currentPageInput, openBook } from '../support/reader'

const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')
/**
 * specs/001-multi-track-audiobook-notes quickstart §5 (T042), automated: a 68-track audiobook imported from a ZIP (hidden window,
 * throw-away userData, audio muted; tracks are ≈13 s of synthetic MPEG silence — the wiring is real, the codec coverage is not).
 *
 * The measured numbers (SC-003 jump, SC-008 500 Notes) are attached to the report and printed. Needs
 * `features.audiobookZipImportEnabled` on in the build (the committed value is off: the spec is then skipped).
 */


test('multi-track Notes (quickstart §5 / T042): 68 tracks — add, list by track, jump, restart, edit / delete, broken track, markers, single-file, remove', async ({
  reader,
}, testInfo) => {
  test.setTimeout(600_000)
  const { page, app, userData } = reader
  const id = await importAndOpen(reader)
  const tracks = await tracksOf(page, id)
  expect(tracks.ok && tracks.tracks.length).toBe(TRACKS)
  if (!tracks.ok) return
  const ids = tracks.tracks.map((t) => t.id)

  // ---- 1. Notes tab is in the rail, the list is empty with an explanation (US2 #4) ----
  await rail(page, 'Notes').click()
  await expect(aside(page).getByRole('heading', { name: 'Notes' })).toBeVisible()
  await expect(aside(page).getByText(/No notes yet/)).toBeVisible()

  // ---- 2. three Notes: track 3 @1 s (no text), track 12 @3 s (with text), track 30 near the end ----
  await addNote(page, 3, 1)
  await addNote(page, 12, 3, 'Chapter twelve idea')
  await gotoTrack(page, 30)
  const end30 = Math.max(1, Math.floor(Number(await seek(page).getAttribute('max'))) - 1)
  await addNote(page, 30, end30, 'Near the end of 30')

  // ---- 3. three groups in track order, each with its in-track timestamp (US2 #1-2) ----
  await rail(page, 'Notes').click()
  const groups = aside(page).getByRole('list', { name: 'Tracks with notes' }).locator('[data-note-group]')
  await expect(groups).toHaveCount(3)
  await expect(groups.nth(0)).toHaveAttribute('data-note-group', ids[2] as string)
  await expect(groups.nth(1)).toHaveAttribute('data-note-group', ids[11] as string)
  await expect(groups.nth(2)).toHaveAttribute('data-note-group', ids[29] as string)
  await expect(groupRow(page, 3)).toContainText('03')
  await openGroup(page, 3)
  await openGroup(page, 12)
  const open = aside(page).locator('[data-note-card]')
  await expect.poll(async () => open.count()).toBeGreaterThanOrEqual(2)
  await expect(aside(page).getByLabel(/Seek to note at 0:01/)).toBeVisible()
  await expect(aside(page).getByLabel(/Seek to note at 0:03/)).toBeVisible()
  const stored = await notesOf(page, id)
  expect(stored.map((n) => n.trackId).sort()).toEqual([ids[2], ids[11], ids[29]].sort())
  expect(stored.every((n) => n.chapterId === undefined)).toBe(true)

  // ---- 4. jump: playing track 12 → click the track-30 Note → plays track 30 at that second; paused → stays paused ----
  await gotoTrack(page, 12)
  await rail(page, 'Notes').click()
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  await openGroup(page, 30)
  const jumpStart = Date.now()
  await aside(page).getByLabel(/Seek to note at/).last().click()
  await expect(trackLabel(page, 30)).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => shownSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(end30)
  const jumpMs = Date.now() - jumpStart
  await expect(pauseButton(page)).toBeVisible() // was playing → still playing
  await pauseButton(page).click()
  await openGroup(page, 3)
  await aside(page).getByLabel(/Seek to note at 0:01/).click()
  await expect(trackLabel(page, 3)).toBeVisible({ timeout: 10_000 })
  await expect(playButton(page)).toBeVisible() // was paused → stays paused
  await expect.poll(() => shownSeconds(page), { timeout: 5000 }).toBe(1)
  // a Note on the CURRENT track only moves the position
  await seekTo(page, 0)
  await aside(page).getByLabel(/Seek to note at 0:01/).click()
  await expect(trackLabel(page, 3)).toBeVisible()
  await expect.poll(() => shownSeconds(page)).toBe(1)

  // ---- 5. quit and restart: the Notes and their jumps are intact (US1 #3, US3 #5) ----
  await app.close()
  const app2 = await launchApp(userData)
  let page2: Page
  try {
    await mute(app2)
    page2 = await app2.firstWindow()
    await page2.waitForLoadState('domcontentloaded')
    await page2.evaluate((b) => {
      window.location.hash = `#/reader/${b}`
    }, id)
    await expect(seek(page2)).toBeEnabled({ timeout: 30_000 })
    const after = await notesOf(page2, id)
    expect(after.map((n) => [n.trackId, n.positionSeconds, n.note ?? null])).toEqual(
      stored.map((n) => [n.trackId, n.positionSeconds, n.note ?? null]),
    )
    await rail(page2, 'Notes').click()
    await expect(aside(page2).getByRole('list', { name: 'Tracks with notes' }).locator('[data-note-group]')).toHaveCount(3)
    await openGroup(page2, 12)
    await aside(page2).getByLabel(/Seek to note at 0:03/).click()
    await expect(trackLabel(page2, 12)).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => shownSeconds(page2)).toBe(3)

    // ---- 6. edit one Note's text, clear another's, delete the third (cancel one deletion first) (US4) ----
    const menuFor = async (time: string) => {
      await aside(page2).getByLabel(`Note actions for ${time}`).click()
      return page2.getByRole('menu', { name: `Note at ${time}` })
    }
    await openGroup(page2, 12)
    let menu = await menuFor('0:03')
    await menu.getByRole('menuitem', { name: 'Edit note' }).click()
    const edit = page2.getByRole('dialog', { name: 'Edit note' })
    await expect(edit.getByRole('textbox')).toHaveAttribute('maxlength', '2000') // the "how much can I type" cue (same cap as single-file)
    await edit.getByRole('textbox').fill('Edited text')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await notesOf(page2, id)).find((n) => n.trackId === ids[11])?.note).toBe('Edited text')

    menu = await menuFor('0:03')
    await menu.getByRole('menuitem', { name: 'Edit note' }).click()
    await page2.getByRole('dialog', { name: 'Edit note' }).getByRole('textbox').fill('')
    await page2.getByRole('dialog', { name: /Edit note|Add note/ }).getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await notesOf(page2, id)).find((n) => n.trackId === ids[11])?.note).toBeUndefined()
    expect((await notesOf(page2, id)).length).toBe(3) // an empty text is still a Note

    menu = await menuFor('0:03')
    await menu.getByRole('menuitem', { name: 'Delete note' }).click()
    await page2.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Cancel' }).click()
    expect((await notesOf(page2, id)).length).toBe(3) // cancelled: nothing lost
    menu = await menuFor('0:03')
    await menu.getByRole('menuitem', { name: 'Delete note' }).click()
    await page2.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click()
    await expect.poll(async () => (await notesOf(page2, id)).length).toBe(2)

    // ---- 8. markers on the seek bar are the CURRENT track's Notes and follow track changes (US5) ----
    const markers = page2.locator('[data-audio-note-marker]')
    await rail(page2, 'Contents').click()
    await trackRow(page2, 3).click()
    await expect(trackLabel(page2, 3)).toBeVisible()
    await expect(markers).toHaveCount(1)
    await trackRow(page2, 5).click()
    await expect(trackLabel(page2, 5)).toBeVisible()
    await expect(markers).toHaveCount(0)
    await trackRow(page2, 30).click()
    await expect(trackLabel(page2, 30)).toBeVisible()
    await expect(markers).toHaveCount(1)

    // ---- 7. a track file made unreadable: the Note's jump names the track, the player stays on the previous track ----
    const booksDir = path.join(userData, 'books')
    const bookDir = path.join(booksDir, readdirSync(booksDir)[0] as string)
    // a track never played in this run (an earlier play can sit in the media cache): give track 40 a Note, then break its file
    const withExtra: AudioBookmarkDto[] = [
      ...(await notesOf(page2, id)),
      { id: 'broken-target', label: 'Broken', positionSeconds: 2, trackId: ids[39] as string, createdAt: new Date().toISOString() },
    ]
    expect((await page2.evaluate((a) => (window as unknown as WithApi).api.audio.saveBookmarks(a), { bookId: id, bookmarks: withExtra })).ok).toBe(true)
    await page2.reload()
    await expect(seek(page2)).toBeEnabled({ timeout: 30_000 })
    const victim = readdirSync(bookDir).find((f) => f.startsWith('0039-')) as string // track 40 (position 39)
    expect(victim).toBeTruthy()
    const victimPath = path.join(bookDir, victim)
    const backup = victimPath + '.bak'
    const { renameSync } = await import('node:fs')
    chmodSync(victimPath, 0o666)
    renameSync(victimPath, backup)
    await rail(page2, 'Notes').click()
    await openGroup(page2, 40)
    const originTrack = Number(((await page2.getByText(/Track \d+ of 68/).first().textContent()) ?? '').match(/Track (\d+)/)?.[1])
    await aside(page2).getByLabel(/Seek to note at 0:02/).click()
    const alert = page2.getByRole('status').filter({ hasText: /could not be played/ })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).toContainText('40 - Part 40')
    await expect(alert).toContainText('You are back on')
    await expect(trackLabel(page2, originTrack)).toBeVisible({ timeout: 15_000 }) // back on the track it was on
    await expect(seek(page2)).toBeEnabled() // the player is still there and usable
    renameSync(backup, victimPath) // restore the file

    // ---- 9. single-file audiobook / PDF / EPUB: covered by the second test below; here only the multi-track storage shape ----
    const rawStored = await notesOf(page2, id)
    expect(rawStored.every((n) => typeof n.trackId === 'string')).toBe(true)

    // ---- SC-008: ~500 Notes (the cap) — the Notes view opens and scrolls without a freeze > 1 s ----
    const many: AudioBookmarkDto[] = Array.from({ length: 500 }, (_, i) => ({
      id: `bulk-${i}`,
      label: `Note ${i}`,
      positionSeconds: (i % 10) + 1,
      note: `Bulk note ${i}`,
      trackId: ids[i % TRACKS] as string,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }))
    const saved = await page2.evaluate((a) => (window as unknown as WithApi).api.audio.saveBookmarks(a), { bookId: id, bookmarks: many })
    expect(saved.ok).toBe(true)
    await page2.reload()
    await expect(seek(page2)).toBeEnabled({ timeout: 30_000 })
    const t0 = Date.now()
    await rail(page2, 'Notes').click()
    await expect(aside(page2).locator('[data-note-group]').first()).toBeVisible({ timeout: 10_000 })
    const openMs = Date.now() - t0
    const worstFrame = await page2.evaluate(async () => {
      const el = document.querySelector('[data-audio-sidebar] .app-scroll') as HTMLElement
      let worst = 0
      let last = performance.now()
      for (let y = 0; y <= el.scrollHeight; y += 400) {
        el.scrollTop = y
        await new Promise((r) => requestAnimationFrame(r))
        const now = performance.now()
        worst = Math.max(worst, now - last)
        last = now
      }
      return worst
    })
    const numbers = { jumpMs, openMs, worstFrameMs: Math.round(worstFrame), notes: 500 }
    await testInfo.attach('sc-numbers', { body: JSON.stringify(numbers, null, 2), contentType: 'application/json' })
    console.log('T042 numbers', JSON.stringify(numbers))
    expect(openMs, 'SC-008: Notes view opens (500 Notes) in < 1 s').toBeLessThan(1000)
    expect(worstFrame, 'SC-008: scrolling 500 Notes has no freeze > 1 s').toBeLessThan(1000)
    expect(jumpMs, 'SC-003: a Note jump lands within 2 s').toBeLessThan(2000)

    // ---- 10. remove the audiobook; importing it again later starts with no Notes ----
    expect((await page2.evaluate(async (b) => (window as unknown as WithApi).api.library.removeAudiobook(b), id)).ok).toBe(true)
    expect(await notesOf(page2, id)).toEqual([])
    await page2.getByRole('link', { name: 'Library', exact: true }).click()
    const id2 = await importAndOpen({ ...reader, page: page2, app: app2 })
    expect(await notesOf(page2, id2)).toEqual([])
    await rail(page2, 'Notes').click()
    await expect(aside(page2).getByText(/No notes yet/)).toBeVisible()
  } finally {
    await app2.close().catch(() => {})
  }
})

test('multi-track Notes (quickstart §5 step 9): a single-file audiobook keeps its flat Notes; a PDF and an EPUB still open', async ({ reader }) => {
  test.setTimeout(180_000)
  const { page, app } = reader
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 30_000 })
  await mute(app)

  // ---- single-file audiobook: add / edit / jump / delete exactly as before (flat list, no track groups) ----
  await reader.importBook(reader.writeFixture('single.mp3', mp3Bytes(1200, 7)))
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(seek(page)).toBeEnabled({ timeout: 20_000 })
  const id = await bookIdOf(page)
  await seekTo(page, 5)
  await page.getByRole('button', { name: '+ Note', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Add note' })
  await editor.getByRole('textbox').fill('single-file note')
  await editor.getByRole('button', { name: 'Save' }).click()
  await rail(page, 'Notes').click()
  const items = page.getByRole('list', { name: 'Notes' }).getByRole('listitem')
  await expect(items).toHaveCount(1)
  await expect(aside(page).locator('[data-note-group]')).toHaveCount(0) // flat list: no track groups
  const stored = await notesOf(page, id)
  expect(stored).toHaveLength(1)
  expect(stored[0]?.trackId).toBeUndefined() // a single-file Note never carries a trackId
  await seekTo(page, 1)
  await items.first().getByRole('button', { name: /Seek to note/ }).click()
  await expect.poll(() => shownSeconds(page)).toBe(5)
  await items.first().getByRole('button', { name: /Note actions/ }).click()
  await page.getByRole('menuitem', { name: 'Edit note' }).click()
  await page.getByRole('dialog', { name: 'Edit note' }).getByRole('textbox').fill('edited single-file')
  await page.getByRole('dialog', { name: 'Edit note' }).getByRole('button', { name: 'Save' }).click()
  await expect(items.first()).toContainText('edited single-file')
  await items.first().getByRole('button', { name: /Note actions/ }).click()
  await page.getByRole('menuitem', { name: 'Delete note' }).click()
  await page.getByRole('alertdialog', { name: 'Delete note' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('No notes yet')).toBeVisible()
  expect(await notesOf(page, id)).toEqual([])

  // ---- a PDF and an EPUB still open in the reader (their annotations are not touched by this feature) ----
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await openBook(reader, reader.writeFixture('toc.pdf', buildTocPdf()))
  await expect(currentPageInput(page)).toBeVisible()
  await expect(rail(page, 'Notes')).toBeVisible()
  await page.getByRole('link', { name: 'Library', exact: true }).click()
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Chapter One' })).toBeVisible({ timeout: 30_000 })
})
