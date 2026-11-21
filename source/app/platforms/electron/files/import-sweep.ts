/**
 * Spec 016 (FR-013 / FR-013a, SC-006, research R11): at startup, before the IPC handlers, remove what an import cut
 * short by a quit, crash or shutdown may have left — only inside the app's own folders:
 *   - `{userData}/books/{uuid}/` folders that no `books` row points into (a `.partial` ZIP folder is left to the ZIP
 *     importer's own sweep);
 *   - `{userData}/covers/*` files no `books.cover_path` references;
 *   - download temp folders `{tmp}/reading-book-*` older than one hour.
 * A referenced book's file lives outside these folders and is never looked at.
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getDatabase } from '../persistence/db'
import { getBooksSandboxPath, getCoversPath } from './sandbox'

const TEMP_PREFIX = 'reading-book-'
const TEMP_MAX_AGE_MS = 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))

export type SweepReport = { bookDirs: number; covers: number; tempDirs: number }

export type SweepSources = {
  /** `books.file_path` and `books.cover_path` of every row. */
  rows: () => { filePath: string | null; coverPath: string | null }[]
  booksDir: string
  coversDir: string
  tempDir: string
  now: number
}

export async function sweepImportLeftovers(sources?: Partial<SweepSources>): Promise<SweepReport> {
  const s: SweepSources = {
    rows: () =>
      getDatabase()
        .prepare('SELECT file_path AS filePath, cover_path AS coverPath FROM books')
        .all() as { filePath: string | null; coverPath: string | null }[],
    booksDir: getBooksSandboxPath(),
    coversDir: getCoversPath(),
    tempDir: os.tmpdir(),
    now: Date.now(),
    ...sources,
  }
  const report: SweepReport = { bookDirs: 0, covers: 0, tempDirs: 0 }
  let rows: { filePath: string | null; coverPath: string | null }[]
  try {
    rows = s.rows()
  } catch (err) {
    console.warn('[import-sweep] could not read the library; nothing removed', err)
    return report
  }
  const usedDirs = new Set(rows.filter((r) => r.filePath).map((r) => norm(path.dirname(r.filePath!))))
  const usedCovers = new Set(rows.filter((r) => r.coverPath).map((r) => norm(r.coverPath!)))

  for (const name of await fsp.readdir(s.booksDir).catch(() => [] as string[])) {
    if (!UUID_RE.test(name)) continue // only `{uuid}` folders the importer creates
    const dir = path.join(s.booksDir, name)
    if (usedDirs.has(norm(dir))) continue
    const entries = await fsp.readdir(dir).catch(() => null)
    if (!entries || entries.some((e) => e.endsWith('.partial'))) continue
    await fsp.rm(dir, { recursive: true, force: true }).then(
      () => (report.bookDirs += 1),
      () => {},
    )
  }

  for (const name of await fsp.readdir(s.coversDir).catch(() => [] as string[])) {
    const file = path.join(s.coversDir, name)
    if (usedCovers.has(norm(file))) continue
    const info = await fsp.stat(file).catch(() => null)
    if (!info?.isFile()) continue
    await fsp.rm(file, { force: true }).then(
      () => (report.covers += 1),
      () => {},
    )
  }

  for (const name of await fsp.readdir(s.tempDir).catch(() => [] as string[])) {
    if (!name.startsWith(TEMP_PREFIX)) continue
    const dir = path.join(s.tempDir, name)
    const info = await fsp.stat(dir).catch(() => null)
    if (!info?.isDirectory() || s.now - info.mtimeMs < TEMP_MAX_AGE_MS) continue
    await fsp.rm(dir, { recursive: true, force: true }).then(
      () => (report.tempDirs += 1),
      () => {},
    )
  }
  return report
}
