/**
 * Spec 016 (T021): records what TODAY's import produces, before story 2 changes anything (FR-007 / SC-002 reference).
 *
 *   cd source/app/platforms/electron && node --experimental-transform-types \
 *     --import ./spikes/pdf-annotations/register-alias.mjs spikes/import/capture-baseline-rows.mjs [--samples <dir>]
 *
 * Without `--samples` it uses the synthetic sample set of `import-samples.mjs`; the result is written to
 * `fixtures/baseline-rows.json` (synthetic) or `fixtures/baseline-rows.samples.json` (real books, not committed:
 * keys are format + size only, but the rows hold the books' titles). To capture real books on the pre-story-2 code
 * later, run this script from a worktree checked out at the commit recorded in the fixture's `capturedAt.commit`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSyntheticSamples, importSamples, listSampleFiles } from './import-samples.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const samplesDir = args.includes('--samples') ? args[args.indexOf('--samples') + 1] : null

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-016-baseline-'))
try {
  const files = samplesDir ? listSampleFiles(samplesDir) : buildSyntheticSamples(work)
  if (files.length === 0) throw new Error('no sample files found')
  const { rows, duplicateOk } = await importSamples(files)
  if (!duplicateOk) throw new Error('importing the first sample twice was not reported as a duplicate')
  let commit = 'unknown'
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    // not a git checkout
  }
  const out = path.join(here, 'fixtures', samplesDir ? 'baseline-rows.samples.json' : 'baseline-rows.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(
    out,
    JSON.stringify({ version: 1, sampleSet: samplesDir ? 'real' : 'synthetic', capturedAt: { commit }, rows }, null, 2) + '\n',
  )
  console.log(`captured ${Object.keys(rows).length} row(s) → ${path.relative(process.cwd(), out)} (duplicate check: ok)`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
