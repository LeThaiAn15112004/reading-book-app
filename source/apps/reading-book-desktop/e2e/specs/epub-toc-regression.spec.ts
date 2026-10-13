import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '../fixtures/app'
import {
  activeTocEntry,
  expectActiveTocEntry,
  openBook,
  openContents,
  tocEntry,
  waitForStableBox,
} from '../support/reader'

// Tracked two-chapter sample (spikes/epub-engine/build-fixture.mjs): "Chapter One", "Chapter Two".
const sampleEpub = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/spikes/spike-sample.epub')

test('E2E 7 — EPUB TOC still highlights the current chapter by href', async ({ reader }) => {
  const { page } = reader
  await openBook(reader, reader.writeFixture('sample.epub', readFileSync(sampleEpub)))
  // epub.js must have displayed the first section before a TOC click can navigate.
  const content = page.frameLocator('iframe').first()
  await expect(content.getByRole('heading', { name: 'Chapter One' })).toBeVisible()
  await openContents(page)
  await waitForStableBox(page.locator('iframe').first())
  await expectActiveTocEntry(page, 'Chapter One')

  // A TOC jump issued soon after the book / sidebar opened can be dropped by epub.js (pre-existing,
  // reproduced on the pre-change build too — see docs/implementation_plan/pdf_toc_sync.md). This
  // spec checks the highlight, so it re-clicks until the jump lands, then asserts the active entry.
  await expect(async () => {
    await tocEntry(page, 'Chapter Two').click()
    await expect(content.getByRole('heading', { name: 'Chapter Two' })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expectActiveTocEntry(page, 'Chapter Two')

  await expect(async () => {
    await tocEntry(page, 'Chapter One').click()
    await expect(content.getByRole('heading', { name: 'Chapter One' })).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expectActiveTocEntry(page, 'Chapter One')
  await expect(activeTocEntry(page)).toBeInViewport()

  // Page turning (not a TOC click) into the next chapter moves the highlight too.
  const next = page.getByRole('button', { name: 'Next page' })
  await expect
    .poll(
      async () => {
        if (await next.isEnabled()) await next.click()
        return activeTocEntry(page).getAttribute('aria-label')
      },
      { timeout: 20_000, intervals: [300] },
    )
    .toBe('Chapter Two')
  await expectActiveTocEntry(page, 'Chapter Two')
})
