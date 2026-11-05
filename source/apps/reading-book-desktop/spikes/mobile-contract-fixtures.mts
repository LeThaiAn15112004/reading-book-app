/**
 * Data contract, Desktop side (spec 008, US4, T038 / SC-006): the versioned fixtures of
 * `book-reader-sdk/tests/contracts/fixtures/` run through the REAL `SqliteOverlayStore` and `SqliteLibraryStore`, on
 * the REAL better-sqlite3 with every numbered migration applied (FTS5 included), on a temp file in WAL mode like the app.
 * Mobile runs the same runner on its own stores (`reading-book-mobile/web/tests/contract-conformance.test.ts`).
 *
 * better-sqlite3 is built for Electron's ABI, so this script re-launches itself with the app's own Electron binary in
 * `ELECTRON_RUN_AS_NODE` mode, like `spike:audio:migration`: no window, no user data, only os.tmpdir(). No Desktop
 * source is changed or stubbed except the database module (`spikes/annotations/db-stub-bs.mjs`).
 *
 * Run: npm run spike:contract:fixtures   (builds the SDK bundle first)
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

if (!process.versions.electron) {
  const electron = require('electron') as string // path to the app's Electron binary
  const alias = pathToFileURL(path.join(here, 'annotations/register-alias-bs.mjs')).href
  const r = spawnSync(electron, ['--experimental-transform-types', '--import', alias, fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  })
  process.exit(r.status ?? 1)
}

const sdk = await import('@reading-book/book-reader-sdk')
const { getDatabase, closeAndRemove } = await import('./annotations/db-stub-bs.mjs')
const { SqliteOverlayStore } = await import('../electron/persistence/sqlite-overlay-store.ts')
const { SqliteLibraryStore } = await import('../electron/persistence/sqlite-library-store.ts')
const { runOverlayContract } = await import('../../book-reader-sdk/tests/contracts/contract-runner.ts')
const { loadContractFixtures } = await import('../../book-reader-sdk/tests/contracts/fixtures.ts')

type Row = Record<string, unknown>
const db = getDatabase()
const version = (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v
const migrations = (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n
console.log(`better-sqlite3 on SQLite ${version} (Electron-as-Node ${process.versions.node}); ${migrations} tables after every migration`)

let books = 0
const host = {
  overlay: new SqliteOverlayStore(db),
  library: new SqliteLibraryStore(db),
  async addBook(format: string) {
    const id = `contract-book-${format}-${++books}`
    db.prepare(
      `INSERT INTO books (id, title, file_path, file_format, sha256, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run(id, `Contract ${format}`, `books/${id}/file`, format, `sha-${id}`)
    return id
  },
  async noteRow(id: string) {
    return db.prepare('SELECT id, book_id, note_json, created_at, updated_at FROM notes WHERE id = ?').get(id) as
      | { id: string; book_id: string; note_json: string; created_at: string; updated_at: string }
      | undefined
  },
  async insertNoteRow(row: Row) {
    db.prepare('INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (@id, @book_id, @note_json, @created_at, @updated_at)').run(row)
  },
  async bookRow(id: string) {
    return db.prepare('SELECT * FROM books WHERE id = ?').get(id) as Row | undefined
  },
  async countNotes(bookId: string) {
    return (db.prepare('SELECT count(*) AS n FROM notes WHERE book_id = ?').get(bookId) as { n: number }).n
  },
}

const fixtures = loadContractFixtures()
const results = await runOverlayContract(host, sdk, fixtures)
closeAndRemove()

for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${fixtures.length} fixtures, ${results.length - failed.length} of ${results.length} checks passed against Desktop's stores`)
process.exit(failed.length ? 1 : 0)
