// Host-side adapter implementations for a plain Node process. This is the ONLY place that
// touches node:fs / node:sqlite — the SDK receives these objects and never imports a driver.
import { mkdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** SqlDatabase port over node:sqlite (DatabaseSync). better-sqlite3 has the same shape. */
export function nodeSqliteDatabase(db) {
  return {
    async run(sql, params = []) {
      const { changes } = db.prepare(sql).run(...params)
      return { changes: Number(changes) }
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params)
    },
  }
}

/** FileSystemAdapter: sandbox is one directory; deletes are refused outside it. */
export async function nodeFileSystem(sandboxDir) {
  const sandbox = resolve(sandboxDir)
  await mkdir(sandbox, { recursive: true })
  const inSandbox = (ref) => resolve(ref).startsWith(sandbox + sep)

  return {
    readBytes: async (ref) => new Uint8Array(await readFile(ref)),
    async copyToSandbox(source, targetName) {
      const target = join(sandbox, targetName)
      await copyFile(source, target) // copy, never move — the original stays untouched
      return target
    },
    async writeSandboxFile(targetName, bytes) {
      const target = join(sandbox, targetName)
      await writeFile(target, bytes)
      return target
    },
    async removeSandboxFile(ref) {
      if (!inSandbox(ref)) throw new Error(`refusing to delete outside the sandbox: ${ref}`)
      await rm(ref, { force: true })
    },
    exists: (ref) =>
      stat(ref).then(
        () => true,
        () => false,
      ),
  }
}

/**
 * LibraryRepository + ReadingSessionRepository on SQLite, written by the HOST. The SDK ships
 * SQL only for the `notes` table (shared, format-stable); book/session tables differ per app
 * (desktop has normalized authors/genres), so those stay host-owned behind the port.
 */
export async function nodeSqliteLibraryAndSessions(sql) {
  await sql.run(`CREATE TABLE IF NOT EXISTS demo_books (
    id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, book_json TEXT NOT NULL)`)
  await sql.run(`CREATE TABLE IF NOT EXISTS demo_sessions (
    book_id TEXT PRIMARY KEY, session_json TEXT NOT NULL)`)

  const parse = (rows, column) => rows.map((r) => JSON.parse(r[column]))

  return {
    library: {
      listBooks: async () => parse(await sql.all('SELECT book_json FROM demo_books'), 'book_json'),
      getBook: async (id) =>
        parse(await sql.all('SELECT book_json FROM demo_books WHERE id = ?', [id]), 'book_json')[0] ?? null,
      findBySha256: async (sha) =>
        parse(await sql.all('SELECT book_json FROM demo_books WHERE sha256 = ?', [sha]), 'book_json')[0] ?? null,
      saveBook: async (book) => {
        await sql.run(
          `INSERT INTO demo_books (id, sha256, book_json) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET book_json = excluded.book_json`,
          [book.id, book.sha256, JSON.stringify(book)],
        )
      },
      deleteBook: async (id) => {
        await sql.run('DELETE FROM notes WHERE book_id = ?', [id])
        await sql.run('DELETE FROM demo_sessions WHERE book_id = ?', [id])
        return (await sql.run('DELETE FROM demo_books WHERE id = ?', [id])).changes > 0
      },
    },
    sessions: {
      getSession: async (bookId) =>
        parse(await sql.all('SELECT session_json FROM demo_sessions WHERE book_id = ?', [bookId]), 'session_json')[0] ??
        null,
      saveSession: async (session) => {
        await sql.run(
          `INSERT INTO demo_sessions (book_id, session_json) VALUES (?, ?)
           ON CONFLICT(book_id) DO UPDATE SET session_json = excluded.session_json`,
          [session.bookId, JSON.stringify(session)],
        )
      },
    },
  }
}
