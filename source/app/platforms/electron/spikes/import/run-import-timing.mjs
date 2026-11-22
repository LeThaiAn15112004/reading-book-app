/**
 * Spec 016 (US1, T019): reads the developer timing log and prints a table per flow / format / size bucket / step.
 *
 *   npm run spike:import:timing [-- --file <timing.jsonl>] [--label <name>] [--compare <label>] [--since <ISO time>] [--self-test]
 *
 * - Default file: `{appData}/reading-book-desktop/logs/timing.jsonl` (the dev userData), written when the app runs with
 *   `READMATE_TIMING=1`.
 * - `--label baseline|after|…` saves the summary to `out/timing-<label>.json` beside this script; when both a
 *   `baseline` and an `after` summary exist, the change per row is printed too (SC-002 / SC-009 / SC-005).
 * - FAILS (exit 1) when any line has a key outside the StepTiming fields or a bad value (FR-001: no title, file name
 *   or path may ever appear). Offending lines are reported by number only, never by content.
 * - `--compare <label>` compares with `out/timing-<label>.json` instead of `baseline` (spec 017: `--label open-after
 *   --compare open-baseline`).
 * - Spec 017 (FR-019, SC-005): the `open` flow also gets a summary per format / size bucket — tap → first page
 *   (`open-first-page`) and how openings ended (opened / left / failed:<cause>, from the `open-left` /
 *   `open-failed-<cause>` steps).
 * - `--self-test` checks the parser and the summary on built-in lines (no file needed).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { parseTimingLine } = await import('../../../../../core/src/perf/step-timing.ts')

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function defaultLogFile() {
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.config'))
  return path.join(appData, 'reading-book-desktop', 'logs', 'timing.jsonl')
}

/** Size buckets used by the report (spec samples: one small book, large PDF / EPUB above 100 MB). */
export function sizeBucket(bytes) {
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return '< 1 MB'
  if (mb < 10) return '1–10 MB'
  if (mb < 100) return '10–100 MB'
  return '≥ 100 MB'
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Parses the text of a log; returns the valid lines and the numbers of the invalid ones. */
export function readLines(text, since) {
  const valid = []
  const invalid = []
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return
    const t = parseTimingLine(raw)
    if (!t) {
      invalid.push(i + 1)
      return
    }
    if (since && Date.parse(t.at) < Date.parse(since)) return
    valid.push(t)
  })
  return { valid, invalid }
}

/** One row per flow / host / format / size bucket / step: n, median and max ms. */
export function summarize(lines) {
  const groups = new Map()
  for (const t of lines) {
    const key = [t.flow, t.host, t.format, sizeBucket(t.sizeBytes), t.step].join('|')
    const g = groups.get(key) ?? []
    g.push(t.ms)
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, ms]) => {
      const [flow, host, format, size, step] = key.split('|')
      return { flow, host, format, size, step, n: ms.length, medianMs: Math.round(median(ms)), maxMs: Math.round(Math.max(...ms)) }
    })
    .sort((a, b) => (a.flow + a.host + a.format + a.size + a.step).localeCompare(b.flow + b.host + b.format + b.size + b.step))
}

function rowKey(r) {
  return [r.flow, r.host, r.format, r.size, r.step].join('|')
}

function printTable(rows, compareTo) {
  const before = new Map((compareTo ?? []).map((r) => [rowKey(r), r]))
  const head = ['flow', 'host', 'format', 'size', 'step', 'n', 'median ms', 'max ms', ...(compareTo ? ['baseline ms', 'change'] : [])]
  const body = rows.map((r) => {
    const b = before.get(rowKey(r))
    const change = b && b.medianMs > 0 ? `${Math.round(((r.medianMs - b.medianMs) / b.medianMs) * 100)} %` : '—'
    return [r.flow, r.host, r.format, r.size, r.step, String(r.n), String(r.medianMs), String(r.maxMs), ...(compareTo ? [b ? String(b.medianMs) : '—', change] : [])]
  })
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |'
  console.log(line(head))
  console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|')
  for (const row of body) console.log(line(row))
}

/** Spec 017: per format / size bucket of the `open` flow — n opened, median tap → first page, and the outcomes. */
export function summarizeOpenings(lines) {
  const groups = new Map()
  for (const t of lines) {
    if (t.flow !== 'open') continue
    const outcome =
      t.step === 'open-first-page' ? 'opened' : t.step === 'open-left' ? 'left' : t.step.startsWith('open-failed-') ? `failed:${t.step.slice(12)}` : null
    if (!outcome) continue
    const key = [t.host, t.format, sizeBucket(t.sizeBytes)].join('|')
    const g = groups.get(key) ?? { firstPageMs: [], outcomes: {} }
    if (outcome === 'opened') g.firstPageMs.push(t.ms)
    g.outcomes[outcome] = (g.outcomes[outcome] ?? 0) + 1
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const [host, format, size] = key.split('|')
      return {
        host,
        format,
        size,
        opened: g.firstPageMs.length,
        medianFirstPageMs: g.firstPageMs.length ? Math.round(median(g.firstPageMs)) : null,
        outcomes: Object.entries(g.outcomes)
          .map(([k, v]) => `${k} ${v}`)
          .join(', '),
      }
    })
    .sort((a, b) => (a.host + a.format + a.size).localeCompare(b.host + b.format + b.size))
}

function printOpenings(rows) {
  if (!rows.length) return
  console.log('\nopen — tap → first page and outcomes')
  const head = ['host', 'format', 'size', 'opened', 'median first page ms', 'outcomes']
  const body = rows.map((r) => [r.host, r.format, r.size, String(r.opened), r.medianFirstPageMs == null ? '—' : String(r.medianFirstPageMs), r.outcomes])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |'
  console.log(line(head))
  console.log('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|')
  for (const row of body) console.log(line(row))
}

function selfTest() {
  const ok = JSON.stringify({ flow: 'import', step: 'fingerprint', format: 'pdf', sizeBytes: 200 * 1024 * 1024, ms: 900, host: 'desktop', at: '2026-11-21T00:00:00.000Z' })
  const ok2 = JSON.stringify({ flow: 'import', step: 'fingerprint', format: 'pdf', sizeBytes: 150 * 1024 * 1024, ms: 1100, host: 'desktop', at: '2026-11-21T00:00:01.000Z' })
  const leak = JSON.stringify({ flow: 'import', step: 'details', format: 'pdf', sizeBytes: 1, ms: 1, host: 'desktop', at: '2026-11-21T00:00:00.000Z', fileName: 'Secret.pdf' })
  const { valid, invalid } = readLines([ok, '', ok2, leak, 'garbage'].join('\n'))
  if (valid.length !== 2 || invalid.join(',') !== '4,5') throw new Error(`self-test: parse ${valid.length} / ${invalid}`)
  const rows = summarize(valid)
  if (rows.length !== 1 || rows[0].medianMs !== 1000 || rows[0].size !== '≥ 100 MB') throw new Error('self-test: summary')
  if (sizeBucket(500) !== '< 1 MB' || sizeBucket(5 * 1024 * 1024) !== '1–10 MB') throw new Error('self-test: buckets')
  const open = (step, ms) => ({ flow: 'open', step, format: 'epub', sizeBytes: 60 * 1024 * 1024, ms, host: 'desktop', at: '2026-11-22T00:00:00.000Z' })
  const openRows = summarizeOpenings([open('open-first-page', 800), open('open-first-page', 1200), open('open-left', 300), open('open-failed-took_too_long', 20001), open('open-content', 10)])
  if (openRows.length !== 1 || openRows[0].opened !== 2 || openRows[0].medianFirstPageMs !== 1000 || openRows[0].outcomes !== 'opened 2, left 1, failed:took_too_long 1') {
    throw new Error('self-test: open summary ' + JSON.stringify(openRows))
  }
  console.log('spike:import:timing self-test passed (parse, refusal of extra keys, buckets, median, open outcomes)')
}

if (args.includes('--self-test')) {
  selfTest()
} else {
  const file = arg('--file') ?? defaultLogFile()
  if (!fs.existsSync(file)) {
    console.error(`No timing log at ${file}. Run the app with READMATE_TIMING=1 and import / open the sample books first.`)
    process.exit(1)
  }
  const { valid, invalid } = readLines(fs.readFileSync(file, 'utf8'), arg('--since'))
  if (invalid.length) {
    console.error(`FAIL: ${invalid.length} line(s) are not valid StepTiming lines (line numbers: ${invalid.slice(0, 20).join(', ')}${invalid.length > 20 ? ', …' : ''}).`)
    console.error('A timing line may only hold flow, step, format, sizeBytes, ms, host, at (FR-001).')
    process.exit(1)
  }
  const rows = summarize(valid)
  const outDir = path.join(here, 'out')
  const label = arg('--label')
  let compareTo
  if (label) {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, `timing-${label}.json`), JSON.stringify({ label, file: 'timing.jsonl', rows, openings: summarizeOpenings(valid) }, null, 2))
  }
  const compareLabel = arg('--compare') ?? (label && label !== 'baseline' ? 'baseline' : undefined)
  const compareFile = compareLabel ? path.join(outDir, `timing-${compareLabel}.json`) : null
  if (compareFile && compareLabel !== label && fs.existsSync(compareFile)) compareTo = JSON.parse(fs.readFileSync(compareFile, 'utf8')).rows
  console.log(`${valid.length} timing line(s)${label ? ` — label "${label}"` : ''}`)
  printTable(rows, compareTo)
  printOpenings(summarizeOpenings(valid))
}
