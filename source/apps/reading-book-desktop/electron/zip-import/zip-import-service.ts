import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  ZIP_IMPORT_LIMITS,
  archiveBasename,
  archiveExtension,
  classifyEntry,
  compareArchivePaths,
  orderWarnings,
  rankCoverCandidates,
  validateZipSelection,
  type ZipImportPreview,
  type ZipImportSelection,
  type ZipPreviewEntry,
  type ZipRejectCode,
  type ZipWarning,
} from '@reading-book/book-reader-sdk'
import {
  ZipFormatError,
  extractEntryToFile,
  readEntryBytes,
  readZipDirectory,
  type ZipDirectory,
  type ZipEntryRecord,
} from './zip-reader'

/**
 * Audiobook ZIP import, Main side and Electron-free (so it can be exercised headless): inspect → preview session →
 * confirm. Nothing here writes outside `tmpRoot`, nothing touches the user's ZIP except reading it, and the
 * renderer only ever holds a session id and entry ids.
 */

export type ZipImportErrorCode =
  | ZipRejectCode
  | 'unreadable'
  | 'cancelled'
  | 'session_expired'
  | 'archive_changed'
  | 'invalid_selection'
  | 'import_not_available'
  | 'import_failed'

export interface ZipImportFailure {
  ok: false
  errorCode: ZipImportErrorCode
  errorMessage: string
}

/** Header bytes parsed for non-MP4 audio; MP4-family files keep `moov` anywhere, so those are probed whole. */
const AUDIO_PREFIX_BYTES = 4 * 1024 ** 2
const MP4_FAMILY: ReadonlySet<string> = new Set(['m4a', 'm4b'])
const SESSION_TTL_MS = 30 * 60 * 1000
const MAX_SESSIONS = 4

export interface AudioProbeResult {
  durationSeconds?: number
}
/** Container + codec check (the importer's own rule, `probeAudioFile`). Throws a readable Error when invalid. */
export type AudioProbe = (filePath: string, format: string) => Promise<AudioProbeResult>

/** Everything the (future) multi-track importer needs. `archivePath` never leaves Main. */
export interface AudiobookImportRequest {
  archivePath: string
  archiveName: string
  /** Chapters in playback order. */
  chapters: { entryId: string; path: string; entry: ZipEntryRecord }[]
  cover: { entryId: string; path: string; entry: ZipEntryRecord } | null
  directory: ZipDirectory
}

export type ZipAudiobookImporter = (request: AudiobookImportRequest) => Promise<{ ok: true; bookId: string } | ZipImportFailure>

/**
 * The persistence stage. The library stores ONE file per book (`books.file_path`); there is no chapter model yet,
 * so until one exists this refuses — after the selection has been fully validated. Swap this function, nothing else.
 */
export const unavailableAudiobookImporter: ZipAudiobookImporter = async () => ({
  ok: false,
  errorCode: 'import_not_available',
  errorMessage:
    'Your selection is valid, but importing a multi-chapter audiobook is not available yet. Nothing was added to your library.',
})

interface Session {
  id: string
  zipPath: string
  fileSize: number
  mtimeMs: number
  directory: ZipDirectory
  preview: ZipImportPreview
  createdAt: number
}

export function failure(errorCode: ZipImportErrorCode, errorMessage: string): ZipImportFailure {
  return { ok: false, errorCode, errorMessage }
}

const REJECT_MESSAGES: Record<ZipRejectCode, string> = {
  invalid_zip: 'This file is not a valid ZIP archive, or it is damaged.',
  empty_zip: 'This ZIP archive is empty.',
  too_many_entries: `This archive has too many files (the limit is ${ZIP_IMPORT_LIMITS.maxEntries}).`,
  too_large: 'This archive is too large to import safely.',
  unsafe_path: 'This archive contains unsafe file paths, so it was not opened.',
  path_too_deep: 'This archive has folders nested too deeply to import safely.',
  duplicate_path: 'This archive contains duplicate file names, so it cannot be opened safely.',
}

function mapError(err: unknown): ZipImportFailure {
  if (err instanceof ZipFormatError) {
    if (err.code === 'cancelled') return failure('cancelled', 'Cancelled.')
    if (err.code in REJECT_MESSAGES) return failure(err.code as ZipRejectCode, REJECT_MESSAGES[err.code as ZipRejectCode])
    return failure('invalid_zip', REJECT_MESSAGES.invalid_zip)
  }
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOENT') return failure('unreadable', 'The ZIP file could not be found.')
  if (code === 'EACCES' || code === 'EPERM') return failure('unreadable', 'No permission to read this ZIP file.')
  return failure('unreadable', 'The ZIP file could not be read.')
}

/** Raster formats a cover may be; checked on the bytes, not the name. */
export function sniffImageMime(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

const entryId = (e: ZipEntryRecord): string => `e${e.index}`

export class ZipImportService {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly options: {
      /** Scratch folder for probe files; each inspection uses its own random sub-folder, removed afterwards. */
      tmpRoot: string
      probe: AudioProbe
      importer?: ZipAudiobookImporter
      now?: () => number
    },
  ) {}

  /** Inspect `zipPath` (chosen by the native dialog, never by the renderer) and open a preview session. */
  async inspect(
    zipPath: string,
    signal?: AbortSignal,
  ): Promise<{ ok: true; preview: ZipImportPreview } | ZipImportFailure> {
    this.expire()
    const workDir = path.join(this.options.tmpRoot, randomUUID())
    try {
      const stat = await fsp.stat(zipPath)
      if (!stat.isFile()) return failure('unreadable', 'The selected item is not a file.')
      const directory = await readZipDirectory(zipPath)
      await fsp.mkdir(workDir, { recursive: true })
      const sessionId = randomUUID()
      const preview = await this.buildPreview(zipPath, path.basename(zipPath), sessionId, directory, workDir, signal)
      while (this.sessions.size >= MAX_SESSIONS) {
        const oldest = this.sessions.keys().next().value
        if (oldest === undefined) break
        this.sessions.delete(oldest)
      }
      this.sessions.set(sessionId, {
        id: sessionId,
        zipPath,
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        directory,
        preview,
        createdAt: this.now(),
      })
      return { ok: true, preview }
    } catch (err) {
      return mapError(err)
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async buildPreview(
    zipPath: string,
    archiveName: string,
    sessionId: string,
    directory: ZipDirectory,
    workDir: string,
    signal?: AbortSignal,
  ): Promise<ZipImportPreview> {
    const entries: ZipPreviewEntry[] = []
    const audio: { entry: ZipEntryRecord; preview: ZipPreviewEntry; format: string }[] = []
    const images: ZipPreviewEntry[] = []

    for (const record of directory.entries) {
      const cls = classifyEntry(record.path, record.isDirectory)
      const preview: ZipPreviewEntry = {
        id: entryId(record),
        path: record.path,
        name: archiveBasename(record.path),
        kind: cls.kind,
        size: record.isDirectory ? 0 : record.size,
        status: cls.status,
        eligible: false,
        reason: cls.reason,
      }
      if (record.isSymlink) {
        Object.assign(preview, { kind: 'other', status: 'ignored', reason: 'Links are not imported' })
      } else if (cls.kind === 'audio' && cls.status === 'ok' && cls.audioFormat) {
        audio.push({ entry: record, preview, format: cls.audioFormat })
      } else if (cls.kind === 'image') {
        images.push(preview)
        if (record.size > ZIP_IMPORT_LIMITS.maxCoverBytes) {
          Object.assign(preview, { reason: 'Image is too large to use as a cover' })
        }
      }
      entries.push(preview)
    }

    // Covers: the bytes must really be a supported raster image (the extension alone proves nothing).
    const covers: ZipPreviewEntry[] = []
    for (const preview of images) {
      if (preview.reason) continue
      const record = directory.entries[Number(preview.id.slice(1))] as ZipEntryRecord
      if (!COVER_OK.has(archiveExtension(preview.path)) || record.size === 0) continue
      try {
        const head = await readEntryBytes(zipPath, directory.fileSize, record, 16, signal)
        if (sniffImageMime(head)) covers.push(preview)
        else preview.reason = 'Not a valid image'
      } catch (err) {
        if (err instanceof ZipFormatError && err.code === 'cancelled') throw err
        preview.reason = 'Image could not be read'
      }
    }

    for (const { entry, preview, format } of audio) {
      if (signal?.aborted) throw new ZipFormatError('cancelled', 'Cancelled')
      await this.probeTrack(zipPath, directory, entry, preview, format, workDir, signal)
    }

    const trackOrder = entries
      .filter((e) => e.eligible)
      .sort((a, b) => compareArchivePaths(a.path, b.path))
      .map((e) => e.id)
    const pathOf = new Map(entries.map((e) => [e.id, e.path]))
    const ranked = rankCoverCandidates(covers)
    const warnings: ZipWarning[] = orderWarnings(trackOrder.map((id) => pathOf.get(id) as string))
    if (ranked.length === 0) {
      warnings.push({ code: 'no_cover', message: 'No cover image was found. The default cover will be used.' })
    }
    return {
      sessionId,
      archiveName,
      entries,
      trackOrder,
      coverCandidates: ranked.map((c) => c.id),
      defaultCoverId: ranked[0]?.id ?? null,
      warnings,
    }
  }

  private async probeTrack(
    zipPath: string,
    directory: ZipDirectory,
    record: ZipEntryRecord,
    preview: ZipPreviewEntry,
    format: string,
    workDir: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const unsupported = (reason: string): void => {
      preview.status = 'unsupported'
      preview.eligible = false
      preview.reason = reason
    }
    if (record.encrypted) return unsupported('The file is password protected')
    if (record.size === 0) return unsupported('The file is empty')
    if (record.method !== 0 && record.method !== 8) return unsupported('Unsupported compression method')
    // Named by entry id, never by archive path; the extension is kept because the parser uses it as a hint.
    const temp = path.join(workDir, `${preview.id}.${archiveExtension(preview.path)}`)
    try {
      if (MP4_FAMILY.has(format) || record.size <= AUDIO_PREFIX_BYTES) {
        await extractEntryToFile(zipPath, directory.fileSize, record, temp, signal)
      } else {
        await fsp.writeFile(temp, await readEntryBytes(zipPath, directory.fileSize, record, AUDIO_PREFIX_BYTES, signal))
      }
      const result = await this.options.probe(temp, format)
      preview.eligible = true
      preview.status = 'ok'
      preview.reason = undefined
      if (typeof result.durationSeconds === 'number' && Number.isFinite(result.durationSeconds) && result.durationSeconds > 0) {
        preview.durationSeconds = result.durationSeconds
      }
    } catch (err) {
      if (err instanceof ZipFormatError && err.code === 'cancelled') throw err
      if (err instanceof ZipFormatError) return unsupported('The file is damaged inside the archive')
      unsupported(err instanceof Error && err.message ? err.message : 'Not a playable audio file')
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => {})
    }
  }

  /** A downscale-free preview of a candidate cover: validated raster bytes ≤ 2 MB as a data URL, else no preview. */
  async coverPreview(sessionId: unknown, id: unknown): Promise<{ ok: true; dataUrl: string | null } | ZipImportFailure> {
    const session = this.get(sessionId)
    if (!session) return failure('session_expired', 'This import preview has expired. Choose the ZIP again.')
    if (typeof id !== 'string' || !session.preview.coverCandidates.includes(id)) {
      return failure('invalid_selection', 'Not a cover candidate.')
    }
    const record = session.directory.entries[Number(id.slice(1))] as ZipEntryRecord
    if (record.size > ZIP_IMPORT_LIMITS.maxCoverPreviewBytes) return { ok: true, dataUrl: null }
    try {
      const bytes = await readEntryBytes(session.zipPath, session.directory.fileSize, record, record.size)
      const mime = sniffImageMime(bytes)
      return { ok: true, dataUrl: mime ? `data:${mime};base64,${bytes.toString('base64')}` : null }
    } catch {
      return { ok: true, dataUrl: null }
    }
  }

  /**
   * Confirmation: re-validate everything, then hand the chapters to the import stage. The renderer's selection is
   * checked against Main's own copy of the preview, the ZIP is re-read, and each chosen entry must still match.
   */
  async confirm(sessionId: unknown, input: unknown): Promise<{ ok: true; bookId: string } | ZipImportFailure> {
    const session = this.get(sessionId)
    if (!session) return failure('session_expired', 'This import preview has expired. Choose the ZIP again.')
    const check = validateZipSelection(session.preview, input)
    if (!check.ok) return failure('invalid_selection', check.reason)
    const selection = input as ZipImportSelection

    try {
      const stat = await fsp.stat(session.zipPath)
      if (stat.size !== session.fileSize || stat.mtimeMs !== session.mtimeMs) {
        return failure('archive_changed', 'The ZIP file changed after it was opened. Choose it again.')
      }
      const fresh = await readZipDirectory(session.zipPath)
      const same = (a: ZipEntryRecord, b: ZipEntryRecord | undefined): boolean =>
        b !== undefined &&
        a.path === b.path &&
        a.method === b.method &&
        a.size === b.size &&
        a.compressedSize === b.compressedSize &&
        a.crc32 === b.crc32 &&
        a.localOffset === b.localOffset
      const chosen = [...selection.trackIds, ...(selection.coverId ? [selection.coverId] : [])]
      for (const id of chosen) {
        const index = Number(id.slice(1))
        if (!same(session.directory.entries[index] as ZipEntryRecord, fresh.entries[index])) {
          return failure('archive_changed', 'The ZIP file changed after it was opened. Choose it again.')
        }
      }
      const toRef = (id: string): { entryId: string; path: string; entry: ZipEntryRecord } => {
        const entry = fresh.entries[Number(id.slice(1))] as ZipEntryRecord
        return { entryId: id, path: entry.path, entry }
      }
      const request: AudiobookImportRequest = {
        archivePath: session.zipPath,
        archiveName: session.preview.archiveName,
        // The user's selection keeps the proposed playback order; Main does not trust the renderer's array order.
        chapters: session.preview.trackOrder.filter((id) => selection.trackIds.includes(id)).map(toRef),
        cover: selection.coverId ? toRef(selection.coverId) : null,
        directory: fresh,
      }
      const result = await (this.options.importer ?? unavailableAudiobookImporter)(request)
      if (result.ok) this.discard(sessionId)
      return result
    } catch (err) {
      const mapped = mapError(err)
      return mapped.errorCode === 'unreadable' ? failure('import_failed', mapped.errorMessage) : mapped
    }
  }

  discard(sessionId: unknown): boolean {
    return typeof sessionId === 'string' && this.sessions.delete(sessionId)
  }

  discardAll(): void {
    this.sessions.clear()
  }

  get sessionCount(): number {
    return this.sessions.size
  }

  private get(sessionId: unknown): Session | null {
    this.expire()
    return typeof sessionId === 'string' ? (this.sessions.get(sessionId) ?? null) : null
  }

  private expire(): void {
    const now = this.now()
    for (const [id, s] of this.sessions) if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(id)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

const COVER_OK: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
