import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/app'
import { audiobookZip } from '../support/audiobook-zip'

/**
 * Audiobook ZIP import in the BUILT app (hidden window, throw-away userData): the native file dialog is stubbed in Main, everything
 * else is the real flow. What the user asked for, step by step:
 *
 *   1. choosing the ZIP makes the "Audiobook ZIP" entry show a SPINNER while the archive is read — no blocking "Inspecting…" modal;
 *   2. when it is read, the panel to choose which audio files to import opens;
 *   3. pressing Import closes that panel at once and the entry keeps a spinner + count while the import runs in the background —
 *      the rest of the app stays usable;
 *   4. when it is done a panel lists the imported audio files, and "Open audiobook" opens the player with the tracks in Contents.
 *
 * Needs `features.audiobookZipImportEnabled` on in the build (the committed value is off, then the spec is skipped).
 */

const TRACKS = 60
const zipButton = (page: Page) => page.locator('[role="group"][aria-label="Import documents"] button').nth(2)

/** Wait for the Library, then say whether this build has the ZIP entry (the flag is off in committed builds). */
async function hasZipEntry(page: Page): Promise<boolean> {
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible({ timeout: 30_000 })
  return (await zipButton(page).count()) > 0 && /audiobook zip/i.test((await zipButton(page).textContent()) ?? '')
}

/** Records every DOM change of the ZIP entry (busy flag + label) and whether a blocking "Inspecting…" dialog ever appeared. */
async function startRecording(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __zipLog: string[]; __modalSeen: boolean }
    w.__zipLog = []
    w.__modalSeen = false
    const read = () => {
      const button = document.querySelectorAll('[role="group"][aria-label="Import documents"] button')[2]
      if (button) {
        const entry = `${button.getAttribute('aria-busy') ?? 'false'}|${(button.textContent ?? '').trim()}|spinner=${button.querySelector('svg.animate-spin') ? 1 : 0}`
        if (w.__zipLog.at(-1) !== entry) w.__zipLog.push(entry)
      }
      for (const d of Array.from(document.querySelectorAll('[role="dialog"]'))) {
        if (/inspecting archive/i.test(d.getAttribute('aria-label') ?? '') || /inspecting archive/i.test(d.textContent ?? '')) w.__modalSeen = true
      }
    }
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    read()
  })
}
const recorded = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __zipLog: string[]; __modalSeen: boolean }
    return { log: w.__zipLog, modalSeen: w.__modalSeen }
  })

test('audiobook ZIP: spinner while reading → choose files → Import runs in the background → result panel → open with tracks in Contents', async ({ reader }) => {
  const { page, app } = reader
  test.skip(!(await hasZipEntry(page)), 'the audiobook ZIP import is switched off in this build')
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.setAudioMuted(true)
  })
  const zip = reader.writeFixture('War and Peace test.zip', audiobookZip(TRACKS))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, zip)
  await startRecording(page)

  // ---- 1. choosing the ZIP: spinner on the entry, no blocking modal ----
  await zipButton(page).click()
  const preview = page.getByRole('dialog', { name: /Import audiobook from War and Peace test\.zip/ })
  await expect(preview).toBeVisible({ timeout: 30_000 })

  // ---- 2. the choose-files panel ----
  // The panel sits ABOVE the app's own title / menu bar: its top buttons are what the user actually hits (a tall list reaches the bar).
  const topmost = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const buttons = Array.from(dialog?.querySelectorAll('header button') ?? [])
    return buttons.map((button) => {
      const r = button.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { label: button.textContent, reachable: hit !== null && button.contains(hit), top: Math.round(r.y) }
    })
  })
  expect(topmost.length).toBeGreaterThan(0)
  for (const b of topmost) expect(b.reachable, `the "${b.label}" button at y=${b.top} is covered by something`).toBe(true)
  await preview.getByRole('button', { name: 'Cancel' }).first().hover() // Playwright refuses a click/hover on an obscured element
  const overlay = await page.evaluate(() => {
    const el = document.querySelector('[role="presentation"]')
    return el ? Number(getComputedStyle(el).zIndex) : null
  })
  expect(overlay, 'the dialog overlay stacks above the app chrome (z-200)').toBeGreaterThan(200)
  await expect(preview.getByText(`${TRACKS} audio tracks detected`)).toBeVisible()
  const afterRead = await recorded(page)
  expect(afterRead.modalSeen, 'no blocking "Inspecting archive…" dialog').toBe(false)
  expect(afterRead.log.some((e) => e.startsWith('true|Reading ZIP') && e.endsWith('spinner=1')), `spinner while reading: ${afterRead.log.join(' ; ')}`).toBe(true)
  await expect(zipButton(page)).toHaveAttribute('aria-busy', 'false') // back to normal once the panel is there
  // un-tick one file: only the chosen files are imported
  await preview.getByRole('checkbox', { name: 'Include 02 - Part 2.mp3' }).uncheck()
  const importButton = preview.getByRole('button', { name: `Import ${TRACKS - 1} chapters` })
  await expect(importButton).toBeEnabled()

  // ---- 3. Import: the panel closes at once, the entry spins with a count, the app stays usable ----
  await importButton.click()
  await expect(preview).toBeHidden({ timeout: 2_000 })
  // other things work meanwhile: go to Settings and back
  await page.getByText('Settings', { exact: true }).first().click()
  await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible({ timeout: 10_000 })
  await page.getByText('Library', { exact: true }).first().click()
  await expect(page.getByRole('button', { name: 'Add file from this device' }).first()).toBeVisible()

  // ---- 4. the result panel lists the imported audio files ----
  const done = page.getByRole('dialog', { name: 'Audiobook added' })
  await expect(done).toBeVisible({ timeout: 60_000 })
  await expect(done.getByText(`${TRACKS - 1} audio files imported`)).toBeVisible()
  const items = done.getByRole('listitem')
  await expect(items).toHaveCount(TRACKS - 1)
  await expect(items.first()).toContainText('01 - Part 1')
  await expect(done.getByText('02 - Part 2')).toHaveCount(0) // the one that was un-ticked
  const afterImport = await recorded(page)
  expect(
    afterImport.log.some((e) => /^true\|Importing \d+\/\d+\|spinner=1$/.test(e) || /^true\|Importing Saving…\|spinner=1$/.test(e)),
    `spinner + count while importing: ${afterImport.log.join(' ; ')}`,
  ).toBe(true)
  await expect(zipButton(page)).toHaveAttribute('aria-busy', 'false')
  expect(afterImport.modalSeen).toBe(false)

  // ---- open it: the player lists the tracks in the left Contents sidebar ----
  await done.getByRole('button', { name: 'Open audiobook' }).click()
  await expect(page.getByText(`Track 1 of ${TRACKS - 1}`).first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Contents', exact: true }).click()
  const aside = page.locator('[data-audio-sidebar]')
  await expect(aside.getByText(`${TRACKS - 1} tracks`)).toBeVisible()
  await expect(aside.getByRole('listitem')).toHaveCount(TRACKS - 1)
  await expect(page.getByRole('button', { name: 'Next track' })).toBeEnabled()
})

test('audiobook ZIP chosen in the ordinary "Add file" dialog: same spinner → choose files panel', async ({ reader }) => {
  const { page, app } = reader
  test.skip(!(await hasZipEntry(page)), 'the audiobook ZIP import is switched off in this build')
  const zip = reader.writeFixture('From add file.zip', audiobookZip(3, 20))
  await reader.importBook(zip) // stubs the dialog and clicks "Add file from this device"
  const preview = page.getByRole('dialog', { name: /Import audiobook from From add file\.zip/ })
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(preview.getByText('3 audio tracks detected')).toBeVisible()
  await preview.getByRole('button', { name: 'Cancel' }).first().click()
  await expect(preview).toBeHidden()
  void app
})
