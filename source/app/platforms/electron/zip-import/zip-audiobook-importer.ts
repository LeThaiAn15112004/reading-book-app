import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  Book,
  CHAPTER_FORMATS,
  ZIP_IMPORT_LIMITS,
  archiveBasename,
  archiveExtension,
  audioFormatFromExtension,
  audiobookParentSha256,
  chapterFileName,
  type AudioChapterRecord,
} from '@reading-book/book-reader-sdk'
import { hashFile } from '../files/file-hash'
import type { ReadTrack, TrackMetadata } from './track-metadata'
import {
  failure,
  sniffImageMime,
  type AudiobookImportRequest,
  type ZipAudiobookImporter,
} from './zip-import-service'
import { ZipFormatError, extractEntryToFile, readEntryBytes } from './zip-reader'

/**
 * The real import stage behind `ZipAudiobookImporter` (docs/implementation_plan/audiobook_multi_chapter_import.md §3).
 * Electron-free: every collaborator is injected so the whole flow runs headless in `spike:audio:zip-import`.
 *
 *  - ONE selected track ⇒ the ordinary single-file import (`importSingleFile` = `importDownloadedFile`): same metadata,
 *    duplicate detection, storage and playback as a standalone file. The cover picked in the preview is not applied.
 *  - TWO OR MORE ⇒ one multi-chapter audiobook: extract each track to a scratch folder (actual-byte guard), validate each
 *    with the importer's own rule, refuse duplicates by the ordered-track hash, place the files in the book's own folder
 *    (`{books}/{uuid}/{position}-{id}.{ext}`, with a `.partial` marker until the database commit), then write the parent
 *    row, authors and ALL chapter rows in one transaction. Any failure or cancellation removes everything created.
 *
 * The user's ZIP is only ever read. Nothing is concatenated or transcoded.
 */
export interface ZipAudiobookImporterDeps {
  /** Scratch parent folder (the same `{userData}/zip-import-tmp` the preview uses). */
  tmpRoot: string
  /** `{userData}/books`. */
  booksRoot: () => string
  /** `{userData}/covers`. */
  coversDir: () => string
  readTrack: ReadTrack
  store: {
    findBySha256(hash: string): Promise<{ id: string } | undefined>
    persistImportedAudiobook(book: Book, chapters: readonly AudioChapterRecord[], authorNames: string[], genreNames: string[]): void
  }
  importSingleFile: (tempPath: string) => Promise<{ ok: boolean; bookId?: string | null; errorCode?: string; errorMessage?: string }>
  /** Remove a book folder this import created. Default: recursive delete. */
  removeDir?: (dir: string) => Promise<void>
  removeCover?: (coverPath: string) => Promise<void>
  /** Free bytes on the volume of `dir`; `null` = unknown (the check is skipped). */
  freeBytes?: (dir: string) => Promise<number | null>
}

const PARTIAL_MARKER = '.partial'
const SPACE_MARGIN_BYTES = 64 * 1024 ** 2
const DUPLICATE_MESSAGE = 'This audiobook is already in your local library. Open the existing copy?'
const COVER_EXT_BY_MIME: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }

const isUnique = (err: unknown): boolean => {
  const code = (err as { code?: unknown } | null)?.code
  const message = err instanceof Error ? err.message : String(err)
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/.test(message)
}

/** A file name safe on Windows/macOS/Linux, keeping the extension (the single-file path derives the title from it). */
export function safeTrackFileName(name: string): string {
  // Plain string work: `path.basename` would treat `a:` in `a:b.mp3` as a Windows drive.
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : ''
  const cleaned = [...(dot > 0 ? name.slice(0, dot) : name)]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch))
    .join('')
  let stem = cleaned.replace(/[. ]+$/g, '')
  if (!stem) stem = 'track'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) stem = `_${stem}`
  return `${stem.slice(0, 120)}${ext.toLowerCase()}`
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fsp.rename(from, to)
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== 'EXDEV') throw err
    await fsp.copyFile(from, to)
    await fsp.rm(from, { force: true })
  }
}

export function createZipAudiobookImporter(deps: ZipAudiobookImporterDeps): ZipAudiobookImporter {
  const removeDir = deps.removeDir ?? ((dir: string) => fsp.rm(dir, { recursive: true, force: true }))
  const removeCover = deps.removeCover ?? ((p: string) => fsp.rm(p, { force: true }))

  return async (request: AudiobookImportRequest) => {
    const { signal } = request
    const scratch = path.join(deps.tmpRoot, randomUUID())
    let bookDir: string | undefined
    let coverPath: string | undefined
    let committed = false
    const throwIfAborted = (): void => {
      if (signal?.aborted) throw new ZipFormatError('cancelled', 'Cancelled')
    }

    try {
      await fsp.mkdir(scratch, { recursive: true })
      if (request.chapters.length === 1) return await importOneTrack(request, scratch)
      if (request.chapters.length < 2) return failure('invalid_selection', 'Select at least one audio track.')

      // ---- 1. room on disk (the scratch folder and the books folder share a volume in practice, so one copy of the data)
      const declared = request.chapters.reduce((n, c) => n + c.entry.size, 0)
      const free = await deps.freeBytes?.(deps.booksRoot())
      if (typeof free === 'number' && free < declared + SPACE_MARGIN_BYTES) {
        return failure('insufficient_space', 'There is not enough free disk space to import this audiobook.')
      }

      // ---- 2. extract + validate every track, in playback order
      const total = request.chapters.length
      const tracks: Array<{ file: string; format: string; sha256: string; size: number; meta: TrackMetadata; source: string }> = []
      for (let i = 0; i < total; i += 1) {
        const c = request.chapters[i] as AudiobookImportRequest['chapters'][number]
        throwIfAborted()
        request.onProgress?.({ stage: 'extracting', done: i, total, name: archiveBasename(c.path) })
        const format = audioFormatFromExtension(archiveExtension(c.path))
        if (!format || !CHAPTER_FORMATS.includes(format)) {
          return failure('invalid_track', `“${archiveBasename(c.path)}” is not a supported audio file.`)
        }
        const file = path.join(scratch, `${String(i).padStart(4, '0')}.${format}`)
        try {
          await extractEntryToFile(request.archivePath, request.directory.fileSize, c.entry, file, signal)
        } catch (err) {
          if (err instanceof ZipFormatError && err.code !== 'cancelled') {
            return failure('invalid_track', `“${archiveBasename(c.path)}” is damaged inside the ZIP.`)
          }
          throw err
        }
        let meta: TrackMetadata
        try {
          meta = await deps.readTrack(file, format)
        } catch (err) {
          const reason = err instanceof Error && err.message ? err.message : 'not a playable audio file'
          return failure('invalid_track', `“${archiveBasename(c.path)}” could not be validated: ${reason}`)
        }
        const { sha256, fileSizeBytes } = await hashFile(file)
        tracks.push({ file, format, sha256, size: fileSizeBytes, meta, source: c.path })
      }
      request.onProgress?.({ stage: 'extracting', done: total, total })
      throwIfAborted()

      // ---- 3. duplicate = the same tracks in the same order (whatever ZIP they came from)
      const parentSha = audiobookParentSha256(tracks.map((t) => t.sha256))
      const existing = await deps.store.findBySha256(parentSha)
      if (existing) return failure('duplicate', DUPLICATE_MESSAGE, existing.id)

      // ---- 4. place the files in the book's own folder (marker until the database commit)
      const bookId = randomUUID()
      bookDir = path.join(deps.booksRoot(), bookId)
      await fsp.mkdir(bookDir, { recursive: true })
      await fsp.writeFile(path.join(bookDir, PARTIAL_MARKER), '')
      const chapters: AudioChapterRecord[] = []
      for (let i = 0; i < tracks.length; i += 1) {
        throwIfAborted()
        const t = tracks[i] as (typeof tracks)[number]
        const id = randomUUID()
        const fileName = chapterFileName(i, id, t.format)
        const dest = path.join(bookDir, fileName)
        await moveFile(t.file, dest)
        await fsp.chmod(dest, 0o444).catch(() => {})
        const stem = archiveBasename(t.source).replace(/\.[^.]*$/, '')
        chapters.push({
          id,
          bookId,
          position: i,
          title: t.meta.title ?? (stem || `Chapter ${i + 1}`),
          fileName,
          sourcePath: t.source,
          fileFormat: t.format,
          sizeBytes: t.size,
          sha256: t.sha256,
          durationSeconds: t.meta.durationSeconds,
        })
      }

      // ---- 5. cover: the explicit choice; else (no candidate in the archive at all) the first track's own picture
      const first = tracks[0] as (typeof tracks)[number]
      coverPath = await writeCover(request, first.meta)
      throwIfAborted()

      // ---- 6. one transaction: parent row + authors + every chapter (not cancellable beyond this point)
      request.onProgress?.({ stage: 'saving', done: total, total })
      const now = new Date().toISOString()
      const firstChapter = chapters[0] as AudioChapterRecord
      const book = new Book({
        id: bookId,
        title: path.parse(request.archiveName).name.trim() || first.meta.title || 'Audiobook',
        filePath: path.join(bookDir, firstChapter.fileName),
        format: firstChapter.fileFormat as Book['format'],
        coverPath,
        sha256: parentSha,
        fileSizeBytes: tracks.reduce((n, t) => n + t.size, 0),
        description: first.meta.album ? `Album: ${first.meta.album}` : undefined,
        addedAt: now,
        updatedAt: now,
      })
      try {
        deps.store.persistImportedAudiobook(book, chapters, first.meta.artists, first.meta.genres)
      } catch (err) {
        if (isUnique(err)) {
          const dup = await deps.store.findBySha256(parentSha).catch(() => undefined)
          await rollback()
          return dup ? failure('duplicate', DUPLICATE_MESSAGE, dup.id) : failure('import_failed', 'Could not save the audiobook to the library.')
        }
        console.warn('[zip-import] saving the audiobook failed', err)
        await rollback()
        return failure('import_failed', 'Could not save the audiobook to the library.')
      }
      committed = true
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await fsp.rm(path.join(bookDir, PARTIAL_MARKER), { force: true })
          break
        } catch {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
        }
      }
      return { ok: true as const, bookId }
    } catch (err) {
      if (!committed) await rollback()
      if (err instanceof ZipFormatError && err.code === 'cancelled') return failure('cancelled', 'Import cancelled.')
      if (signal?.aborted) return failure('cancelled', 'Import cancelled.')
      console.warn('[zip-import] import failed', err)
      return failure('import_failed', 'Could not import the audiobook. Nothing was added to your library.')
    } finally {
      await fsp.rm(scratch, { recursive: true, force: true }).catch(() => {})
    }

    /** Remove everything this import created outside the scratch folder. Never touches the ZIP. */
    async function rollback(): Promise<void> {
      if (bookDir) await removeDir(bookDir).catch(() => {})
      if (coverPath) await removeCover(coverPath).catch(() => {})
      bookDir = undefined
      coverPath = undefined
    }
  }

  /** One selected track: hand the extracted file to the existing single-file import. */
  async function importOneTrack(request: AudiobookImportRequest, scratch: string) {
    const c = request.chapters[0] as AudiobookImportRequest['chapters'][number]
    const file = path.join(scratch, safeTrackFileName(archiveBasename(c.path)))
    try {
      await extractEntryToFile(request.archivePath, request.directory.fileSize, c.entry, file, request.signal)
    } catch (err) {
      if (err instanceof ZipFormatError && err.code === 'cancelled') return failure('cancelled', 'Import cancelled.')
      return failure('invalid_track', `“${archiveBasename(c.path)}” is damaged inside the ZIP.`)
    }
    if (request.signal?.aborted) return failure('cancelled', 'Import cancelled.')
    request.onProgress?.({ stage: 'saving', done: 1, total: 1 })
    const result = await deps.importSingleFile(file)
    if (result.ok && result.bookId) return { ok: true as const, bookId: result.bookId }
    if (result.errorCode === 'duplicate' && result.bookId) {
      return failure('duplicate', result.errorMessage ?? 'This book is already in your local library. Open the existing copy?', result.bookId)
    }
    return failure('import_failed', result.errorMessage ?? 'Could not import this audio file.')
  }

  async function writeCover(request: AudiobookImportRequest, firstMeta: TrackMetadata): Promise<string | undefined> {
    let bytes: Uint8Array | undefined
    let mime: string | null = null
    try {
      if (request.cover) {
        if (request.cover.entry.size > ZIP_IMPORT_LIMITS.maxCoverBytes) return undefined
        const data = await readEntryBytes(request.archivePath, request.directory.fileSize, request.cover.entry, request.cover.entry.size, request.signal)
        bytes = data
        mime = sniffImageMime(data)
      } else if (!request.hadCoverCandidates && firstMeta.picture) {
        bytes = firstMeta.picture.data
        mime = firstMeta.picture.format.toLowerCase().replace('image/jpg', 'image/jpeg')
      }
      const ext = mime ? COVER_EXT_BY_MIME[mime] : undefined
      if (!bytes || !ext) return undefined
      await fsp.mkdir(deps.coversDir(), { recursive: true })
      const dest = path.join(deps.coversDir(), `${randomUUID()}${ext}`)
      await fsp.writeFile(dest, bytes)
      return dest
    } catch (err) {
      if (err instanceof ZipFormatError && err.code === 'cancelled') throw err
      return undefined // a bad cover never fails the import; the library's generated cover is used
    }
  }
}

/**
 * Startup sweep for a crash between placing the files and the database commit: a book folder that still has the
 * `.partial` marker AND that no `books` row points into is the leftover of an import that never committed. A folder
 * with a marker but a registered book (the marker removal failed after the commit) is kept and only loses the marker.
 */
export async function sweepPartialBookDirs(
  booksRoot: string,
  hasBookInDir: (dir: string) => boolean | Promise<boolean>,
): Promise<string[]> {
  const removed: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(booksRoot, { withFileTypes: true })
  } catch {
    return removed
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(booksRoot, entry.name)
    const marker = path.join(dir, PARTIAL_MARKER)
    const hasMarker = await fsp.stat(marker).then((s) => s.isFile(), () => false)
    if (!hasMarker) continue
    if (await hasBookInDir(dir)) {
      await fsp.rm(marker, { force: true }).catch(() => {})
      continue
    }
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
    removed.push(dir)
  }
  return removed
}

