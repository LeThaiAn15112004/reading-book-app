#!/usr/bin/env node
// Proves Desktop is unchanged by spec 008 (US1): runs the Desktop and SDK checks recorded in
// specs/008-shared-core-architecture/baseline.md, checks that no Main-process file or migration changed, and, when a
// copied library is given, compares its counts with the recorded pre-change library.
//
//   node scripts/check-desktop-baseline.mjs                  # all checks, then git, then the library if its copy exists
//   node scripts/check-desktop-baseline.mjs --only git       # one group: checks | git | library
//   node scripts/check-desktop-baseline.mjs --library <dir>  # a userData copy other than the default
//   node scripts/check-desktop-baseline.mjs --base <ref>     # compare electron/ with another commit
//   node scripts/check-desktop-baseline.mjs --ci             # SDK tests exactly as CI runs them (see below)
//
// Read-only: it never opens the real userData, and opens the library copy read-only.
// Exit code 0 only when every group that ran passed.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.dirname(sourceRoot)
const specDir = path.join(repoRoot, 'specs/008-shared-core-architecture')
const expectedLibraryFile = path.join(specDir, 'baseline-library.json')

/** Base commit of baseline.md. Main-process files must be identical to it for the whole of spec 008. */
const DEFAULT_BASE = '8130c17'
/** SDK tests at the baseline; later work may add tests, never lose passing ones. */
const BASELINE_SDK_TESTS = 998

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const only = option('--only')
const base = option('--base') ?? DEFAULT_BASE
const ciMode = args.includes('--ci')
const defaultLibrary = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local/share'),
  'readmate-baseline/userdata-pre-change',
)
const libraryDir = option('--library') ?? defaultLibrary
if (only && !['checks', 'git', 'library'].includes(only)) fail(`--only must be checks, git or library, not "${only}"`)

const results = []
const record = (group, name, ok, detail = '') => results.push({ group, name, ok, detail })
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '')

function fail(message) {
  console.error(message)
  process.exit(2)
}

function run(command, cwd, env = {}) {
  const started = Date.now()
  const out = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  })
  const output = stripAnsi(`${out.stdout ?? ''}${out.stderr ?? ''}`)
  return { ok: out.status === 0, output, seconds: Math.round((Date.now() - started) / 1000) }
}

/** git without a shell: cmd.exe would eat the `^` in `<ref>^{commit}`. */
function git(...gitArgs) {
  const out = spawnSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: out.status === 0, output: `${out.stdout ?? ''}` }
}

function tail(output, lines = 25) {
  return output.trimEnd().split(/\r?\n/).slice(-lines).join('\n')
}

// --- Group 1: the checks of baseline.md -------------------------------------------------------------------------

function runChecks() {
  // The 2 feature-flag gate tests read `git show HEAD:features.ts`. While the flag change of T001 is uncommitted they
  // fail in CI's form, so by default they read the working file through their documented fallback (baseline.md).
  const testEnv = ciMode ? {} : { GIT_DIR: path.join(os.tmpdir(), 'readmate-no-git') }
  const checks = [
    // Spec 009: one manifest at the repository root, so every check is a root script.
    { name: 'SDK typecheck', cwd: repoRoot, cmd: 'npm run sdk:typecheck' },
    { name: 'SDK typecheck:tests', cwd: repoRoot, cmd: 'npm run sdk:typecheck:tests' },
    { name: `SDK test${ciMode ? ' (CI form)' : ''}`, cwd: repoRoot, cmd: 'npm run sdk:test', env: testEnv, tests: true },
    { name: 'SDK build', cwd: repoRoot, cmd: 'npm run sdk:build' },
    { name: 'Desktop typecheck', cwd: repoRoot, cmd: 'npm run desktop:typecheck' },
    { name: 'Desktop lint', cwd: repoRoot, cmd: 'npm run desktop:lint' },
    { name: 'Desktop e2e:typecheck', cwd: repoRoot, cmd: 'npm run e2e:typecheck' },
    { name: 'Desktop vite build', cwd: repoRoot, cmd: 'npm run build' },
  ]
  for (const check of checks) {
    console.log(`… ${check.name}`)
    const { ok, output, seconds } = run(check.cmd, check.cwd, check.env)
    let passed = ok
    let detail = `${seconds} s`
    if (check.tests) {
      const line = output.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed[^\n]*/)
      const failed = Number(line?.[1] ?? 0)
      const count = Number(line?.[2] ?? 0)
      passed = ok && failed === 0 && count >= BASELINE_SDK_TESTS
      detail = line ? `${line[0].trim()}; baseline ${BASELINE_SDK_TESTS}` : 'no vitest summary found'
    }
    record('checks', check.name, passed, detail)
    if (!passed) console.log(`\n--- ${check.name} output (last lines) ---\n${tail(output)}\n`)
  }
}

// --- Group 2: no Main-process change, no new migration (T027) ---------------------------------------------------

function runGit() {
  const electron = 'source/apps/reading-book-desktop/electron'
  const migrations = `${electron}/persistence/migrations`
  if (!git('rev-parse', '--verify', '--quiet', `${base}^{commit}`).ok) {
    record('git', `base ${base}`, false, 'commit not found')
    return
  }
  const changed = git('diff', '--name-only', base, '--', electron)
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', electron)
  const files = `${changed.output}\n${untracked.output}`.split(/\r?\n/).map((f) => f.trim()).filter(Boolean)
  // Spec 009 changes Main on purpose; each changed file must be listed with its reason.
  const approved = JSON.parse(readFileSync(path.join(sourceRoot, 'scripts/desktop-main-changes.json'), 'utf8')).files
  const unexpected = files.filter((f) => !(f in approved))
  record('git', `electron/ changes since ${base} all approved`, changed.ok && untracked.ok && unexpected.length === 0,
    unexpected.length
      ? `${unexpected.length} unapproved: ${unexpected.slice(0, 5).join(', ')}${unexpected.length > 5 ? ', …' : ''}`
      : `${files.length} approved file(s) (desktop-main-changes.json)`)

  const atBase = git('ls-tree', '--name-only', base, '--', `${migrations}/`)
  const before = new Set(atBase.output.split(/\r?\n/).map((f) => path.posix.basename(f.trim())).filter(Boolean))
  const now = readdirSync(path.join(repoRoot, migrations)).filter((f) => f.endsWith('.sql'))
  const added = now.filter((f) => !before.has(f))
  const removed = [...before].filter((f) => f.endsWith('.sql') && !now.includes(f))
  record('git', 'no new or removed migration', atBase.ok && added.length === 0 && removed.length === 0,
    `${now.length} migrations${added.length ? `; added ${added.join(', ')}` : ''}${removed.length ? `; removed ${removed.join(', ')}` : ''}`)
  checkMigrationHashes()
}

/**
 * Spec 009 (T002): the 30 Desktop migrations keep their exact content wherever they move. Hashes are of the text with
 * CRLF normalised to LF (git `autocrlf` checkouts), recorded in `desktop-migrations.sha256.json`.
 */
export const DESKTOP_MIGRATION_DIRS = [
  'source/apps/reading-book-desktop/electron/persistence/migrations',
  'source/core/src/db/desktop/migrations',
]

function checkMigrationHashes() {
  const expected = JSON.parse(readFileSync(path.join(sourceRoot, 'scripts/desktop-migrations.sha256.json'), 'utf8'))
  const dir = DESKTOP_MIGRATION_DIRS.map((d) => path.join(repoRoot, d)).find((d) => existsSync(d))
  if (!dir) {
    record('git', 'migrations byte-identical', false, 'migrations folder not found')
    return
  }
  const wrong = Object.entries(expected).filter(([file, hash]) => {
    const full = path.join(dir, file)
    if (!existsSync(full)) return true
    const text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
    return createHash('sha256').update(text).digest('hex') !== hash
  })
  record('git', 'migrations byte-identical', wrong.length === 0,
    wrong.length ? `${wrong.length} differ or missing: ${wrong.slice(0, 5).map(([f]) => f).join(', ')}` : `${Object.keys(expected).length} files, ${path.relative(repoRoot, dir).replaceAll('\\', '/')}`)
}

// --- Group 3: the copied pre-change library (T026) --------------------------------------------------------------

/** Counts of a Readmate library. Keys and meaning are documented in baseline.md "Pre-change library check". */
export function libraryCounts(DatabaseSync, dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    const value = (sql) => Object.values(db.prepare(sql).get() ?? {})[0] ?? 0
    const rows = (sql) => db.prepare(sql).all()
    const hash = (sql) => createHash('sha256').update(rows(sql).map((r) => Object.values(r).join('\u0000')).join('\n')).digest('hex').slice(0, 16)
    const byKey = (sql) => Object.fromEntries(rows(sql).map((r) => [r.k ?? '(none)', r.n]))
    return {
      migrations: value('SELECT count(*) FROM schema_migrations'),
      lastMigration: value('SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1'),
      books: value('SELECT count(*) FROM books'),
      booksByFormat: byKey('SELECT file_format k, count(*) n FROM books GROUP BY 1 ORDER BY 1'),
      positions: value("SELECT count(*) FROM books WHERE json_extract(reading_state_json, '$.lastReadLocation') IS NOT NULL"),
      audioPositions: value("SELECT count(*) FROM books WHERE json_extract(reading_state_json, '$.audioProgress') IS NOT NULL"),
      bookmarks: value("SELECT count(*) FROM notes WHERE json_extract(note_json, '$.type') = 'bookmark'"),
      annotations: value("SELECT count(*) FROM notes WHERE coalesce(json_extract(note_json, '$.type'), '') <> 'bookmark'"),
      annotationsByType: byKey("SELECT json_extract(note_json, '$.type') k, count(*) n FROM notes WHERE coalesce(json_extract(note_json, '$.type'), '') <> 'bookmark' GROUP BY 1 ORDER BY 1"),
      audioNotes: value("SELECT coalesce(sum(json_array_length(reading_state_json, '$.audioBookmarks')), 0) FROM books WHERE json_type(reading_state_json, '$.audioBookmarks') = 'array'"),
      collections: value('SELECT count(*) FROM collections'),
      collectionBooks: value('SELECT count(*) FROM collection_books'),
      txtDocuments: value('SELECT count(*) FROM txt_documents'),
      bookIdsHash: hash('SELECT id FROM books ORDER BY id'),
      noteIdsHash: hash('SELECT id FROM notes ORDER BY id'),
    }
  } finally {
    db.close()
  }
}

async function runLibrary() {
  const dbFile = path.join(libraryDir, 'reading-book.db')
  if (!existsSync(dbFile)) {
    record('library', 'library copy', !option('--library') && only !== 'library', `no copy at ${libraryDir}; see baseline.md T026`)
    return
  }
  if (path.resolve(libraryDir) === path.resolve(process.env.APPDATA ?? '', 'reading-book-desktop')) {
    fail('Refusing to open the real userData folder; copy it first (baseline.md, T026).')
  }
  const { DatabaseSync } = await import('node:sqlite')
  const actual = libraryCounts(DatabaseSync, dbFile)
  if (args.includes('--print-library')) console.log(JSON.stringify(actual, null, 2))
  if (!existsSync(expectedLibraryFile)) {
    record('library', 'expected counts', false, `missing ${path.relative(repoRoot, expectedLibraryFile)}`)
    return
  }
  const expected = JSON.parse(readFileSync(expectedLibraryFile, 'utf8')).counts
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key]
    const ok = JSON.stringify(got) === JSON.stringify(want)
    record('library', key, ok, ok ? '' : `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  }
}

// --- Main -------------------------------------------------------------------------------------------------------

if (!only || only === 'checks') runChecks()
if (!only || only === 'git') runGit()
if (!only || only === 'library') await runLibrary()

const width = Math.max(...results.map((r) => r.name.length))
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.group.padEnd(7)}  ${r.name.padEnd(width)}  ${r.detail}`)
const failed = results.filter((r) => !r.ok)
console.log(failed.length ? `\n${failed.length} of ${results.length} failed.` : `\nAll ${results.length} passed.`)
process.exit(failed.length ? 1 : 0)
