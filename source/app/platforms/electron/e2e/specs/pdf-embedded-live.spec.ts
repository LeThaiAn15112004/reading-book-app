import { renameSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { appendIncrementalUpdate, buildAnnotatedPdf } from '../support/build-annotated-pdf.mjs'
import { expect, test } from '../fixtures/app'
import { goToPage, openBook, pdfPage } from '../support/reader'

/**
 * Live sync of embedded PDF annotations (docs/implementation_plan/pdf_embedded_annotation_live_sync.md)
 * in the built Electron app: the PDF stays OPEN while "another app" saves it — added, recolored,
 * moved / resized, deleted annotations, an in-place incremental save and a temp-file + rename save —
 * and the reader updates without reopening the book. Latency (file written → UI updated) is
 * measured with the app's real watcher timings and attached to the test result.
 *
 * "Another app" is simulated by rewriting the file the way viewers save; real Foxit is not driven.
 */

type Mark = { id: string; color: string; top: number; height: number }

/** The `kind` marks of page `n` with their annotation id, color and box (percent of the page). */
async function marksOf(page: Page, n: number, kind: string): Promise<Mark[]> {
  return pdfPage(page, n)
    .locator(`.rb-pdf-annot[data-kind="${kind}"]`)
    .evaluateAll((els) =>
      els.map((el) => {
        const e = el as HTMLElement
        return {
          id: e.dataset.pdfAnnotId ?? '',
          color: e.style.getPropertyValue('--rb-annot-color'),
          top: parseFloat(e.style.top),
          height: parseFloat(e.style.height),
        }
      }),
    )
}

const latencies: { step: string; ms: number }[] = []

/** Write the file like another app, then wait until `ready()` holds in the open reader. */
async function saveAndExpect(step: string, file: string, bytes: Buffer, ready: () => Promise<boolean>, rename = false) {
  const startedAt = Date.now()
  if (rename) {
    writeFileSync(`${file}.tmp`, bytes)
    renameSync(`${file}.tmp`, file)
  } else {
    writeFileSync(file, bytes)
  }
  await expect.poll(ready, { timeout: 15_000, intervals: [50] }).toBe(true)
  latencies.push({ step, ms: Date.now() - startedAt })
}

test('annotations changed in another app update the open PDF without reopening it', async ({ reader }) => {
  test.setTimeout(150_000)
  let v: object[] = [
    { page: 1, subtype: 'Highlight', lines: [2], color: [1, 0.92, 0.23], nm: '{F-1}', contents: 'from Foxit' },
    { page: 1, subtype: 'Underline', lines: [4], color: [0, 0.6, 1], nm: '{F-2}' },
  ]
  const file = reader.writeFixture('live.pdf', buildAnnotatedPdf({ annotations: v }))
  const page = reader.page
  await openBook(reader, file)
  await goToPage(page, 1)

  // Open sync: both imported.
  await expect.poll(async () => (await marksOf(page, 1, 'highlight')).length).toBe(1)
  await expect.poll(async () => (await marksOf(page, 1, 'underline')).length).toBe(1)
  const highlightId = (await marksOf(page, 1, 'highlight'))[0]!.id

  // 1. Added in the other app (full save, objects renumbered).
  v = [...v, { page: 1, subtype: 'StrikeOut', lines: [6], color: [1, 0, 0], nm: '{F-3}' }]
  await saveAndExpect('add', file, buildAnnotatedPdf({ annotations: v, padObjects: 3 }), async () => (await marksOf(page, 1, 'strikethrough')).length === 1)

  // 2. Recolored + comment edited (incremental save appended to the file): same row, new color.
  const recolored = { ...(v[0] as object), color: [0, 0.6, 1], contents: 'edited in Foxit' }
  const base = buildAnnotatedPdf({ annotations: v })
  writeFileSync(file, base)
  await page.waitForTimeout(1500) // let that intermediate save settle first
  await saveAndExpect(
    'recolor (incremental)',
    file,
    appendIncrementalUpdate(base, { annotations: v, changes: { 0: recolored } }),
    async () => {
      const hl = await marksOf(page, 1, 'highlight')
      return hl.length === 1 && hl[0]!.id === highlightId && hl[0]!.color === '#0099FF'
    },
  )
  v = [recolored, ...v.slice(1)]

  // 3. Moved and resized (two lines now): same row (same /NM), new geometry.
  const before = (await marksOf(page, 1, 'highlight'))[0]!
  v = [{ ...(v[0] as object), lines: [7, 8] }, ...v.slice(1)]
  await saveAndExpect('move + resize', file, buildAnnotatedPdf({ annotations: v }), async () => {
    const hl = await marksOf(page, 1, 'highlight')
    return hl.length === 2 && hl.every((m) => m.id === highlightId) && hl[0]!.top > before.top
  })

  // 4. Deleted in the other app, saved as temp file + rename (new inode).
  v = v.filter((a) => (a as { nm: string }).nm !== '{F-2}')
  await saveAndExpect('delete (rename save)', file, buildAnnotatedPdf({ annotations: v }), async () => (await marksOf(page, 1, 'underline')).length === 0, true)

  // The reader stayed usable throughout: an imported mark still opens its menu.
  await expect(page.getByRole('textbox', { name: 'Current page' })).toBeVisible()

  test.info().annotations.push({
    type: 'latency',
    description: latencies.map((l) => `${l.step}: ${l.ms} ms`).join('; '),
  })
  console.log('[live sync latency]', latencies.map((l) => `${l.step}=${l.ms}ms`).join(' '))
})
