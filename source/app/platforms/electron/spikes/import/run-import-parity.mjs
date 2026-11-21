/**
 * Spec 016 (T042, FR-007 / SC-002): the new import pipeline produces the same library entries as before.
 *
 *   npm run spike:import:parity [-- --samples <dir>]
 *
 * Imports the sample set through the real `import:fromFile` handler on a fresh migrated database and compares every
 * row (title, authors, format, genres, sha256, reading status, metadata incl. size / pages / description, cover
 * stored in the file by SHA-256) with `fixtures/baseline-rows.json` — captured on the code before story 2 by
 * `capture-baseline-rows.mjs` (`fixtures/baseline-rows.samples.json` with `--samples`). Also checks:
 *   - importing the same file twice → `duplicate` (US2 AS5);
 *   - a PDF row has NO `signatureStatus` right after saving (FR-005) and, once the background signature queue has
 *     run, the same value as the baseline.
 * Generated covers (PDF / TXT / MD) are drawn by the renderer and are not part of this headless check.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSyntheticSamples, importSamples, listSampleFiles, rowOf } from './import-samples.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { whenSignatureQueueIdle } = await import('../../signature/signature-queue.ts')

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const samplesDir = args.includes('--samples') ? args[args.indexOf('--samples') + 1] : null
const fixture = path.join(here, 'fixtures', samplesDir ? 'baseline-rows.samples.json' : 'baseline-rows.json')
if (!fs.existsSync(fixture)) {
  console.error(`No baseline at ${fixture}: run capture-baseline-rows.mjs on the pre-story-2 code first.`)
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(fixture, 'utf8'))

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-016-parity-'))
let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

try {
  const files = samplesDir ? listSampleFiles(samplesDir) : buildSyntheticSamples(work)
  const rightAfterSave = {}
  const { rows, duplicateOk } = await importSamples(files, {
    afterImport: async (bookId) => {
      const row = rowOf(getDatabase(), bookId)
      rightAfterSave[bookId] = row
      await whenSignatureQueueIdle()
    },
  })

  check('importing the same file twice is reported as a duplicate (US2 AS5)', () => assert.equal(duplicateOk, true))
  check('the same samples were imported as in the baseline', () =>
    assert.deepEqual(Object.keys(rows).sort(), Object.keys(baseline.rows).sort()),
  )
  for (const [key, row] of Object.entries(rows)) {
    check(`${key}: library entry identical to the baseline (FR-007)`, () => assert.deepEqual(row, baseline.rows[key]))
  }
  const pdfRowsAfterSave = Object.values(rightAfterSave).filter((r) => r.format === 'pdf')
  if (pdfRowsAfterSave.length > 0) {
    check('a PDF is saved before its signature is checked: no signatureStatus right after saving (FR-005)', () => {
      for (const r of pdfRowsAfterSave) assert.equal(r.metadata.signatureStatus, undefined)
    })
  }
  console.log(`spike:import:parity — ${passed} checks passed (${baseline.sampleSet} sample set, baseline ${baseline.capturedAt.commit.slice(0, 7)})`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
