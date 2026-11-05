/**
 * `files.*` (spec 008, T052, T091; `contracts/host-services.md`, `data-model.md` Import job and Removal).
 *
 * Every path is built here from a fixed folder and a validated id, never taken from the WebView:
 *
 *   staging/{stagingId}/file   an import being copied and hashed
 *   books/{bookId}/file        an imported book (read only from then on: no route writes to it)
 *   covers/{bookId}.png        its cover
 *
 * The picked file itself is a copy in the cache (the picker's `copyToCacheDirectory`), addressed by an opaque
 * `pickId` that only this service can resolve. The rules live here, over the `HostFs` port: `expo-host-fs.ts` on the
 * device, an in-memory implementation in the vitest suite.
 */
import { base64ToBytes, bytesToBase64, isUuid } from './encoding'
import { DEV_BOOK_MAX_BYTES, DEV_CHUNK_MAX_BYTES, HostServiceError, type ImportProgressPayload } from './protocol'
import { argsObject } from './rpc'
import { Sha256 } from './sha256'

export interface PickedDocument {
  uri: string
  name: string
  size: number
}

export interface ByteReader {
  read(length: number): Uint8Array
  close(): void
}

export interface ByteWriter {
  write(bytes: Uint8Array): void
  close(): void
}

/** App-private storage. `rel` paths are `/`-separated, relative to the app's document folder. */
export interface HostFs {
  /** Native picker; the result is a copy in the cache, or null when the user cancelled. */
  pickDocument(): Promise<PickedDocument | null>
  availableBytes(): number
  exists(rel: string): boolean
  /** Size of a file, or undefined when it does not exist. */
  fileSize(rel: string): number | undefined
  /** Entry names of a folder; empty when it does not exist. */
  list(rel: string): string[]
  mkdirp(rel: string): void
  /** File or folder tree; nothing when it does not exist. */
  remove(rel: string): void
  move(fromRel: string, toRel: string): Promise<void>
  openRead(rel: string): ByteReader
  openReadUri(uri: string): ByteReader
  openWrite(rel: string): ByteWriter
  writeFile(rel: string, bytes: Uint8Array): void
  readRange(rel: string, offset: number, length: number): Uint8Array
  /** Removes a picked cache copy; never throws. */
  discardUri(uri: string): void
}

export interface FileServiceOptions {
  fs: HostFs
  /** Expo Go only: adds `files.readChunk` and `files.readCover`. Every other build answers `UNKNOWN_METHOD`. */
  devChunks: boolean
  emitProgress?: (payload: ImportProgressPayload) => void
  /** Lets cancel requests through between chunks. */
  yieldToEvents?: () => Promise<void>
  newPickId?: () => string
}

export const FILE_LIMITS = {
  chunkBytes: 1024 * 1024,
  /** Kept free on top of the book itself, so a full disk fails at the start, not halfway. */
  spaceMarginBytes: 16 * 1024 * 1024,
  coverMaxBytes: 4 * 1024 * 1024,
  progressEveryBytes: 4 * 1024 * 1024,
} as const

/** The four first-release formats (FR-017g); the picker result is checked against them by name. */
export const IMPORTABLE_EXTENSIONS = ['epub', 'pdf', 'txt', 'md'] as const
export type ImportableExtension = (typeof IMPORTABLE_EXTENSIONS)[number]

export type PickResult =
  | { status: 'picked'; pickId: string; name: string; size: number; extension: ImportableExtension }
  | { status: 'cancelled' }
  | { status: 'unsupported'; name: string }

export const stagingDir = (stagingId: string) => `staging/${stagingId}`
export const stagingFile = (stagingId: string) => `staging/${stagingId}/file`
export const bookDir = (bookId: string) => `books/${bookId}`
export const bookFile = (bookId: string) => `books/${bookId}/file`
export const coverFile = (bookId: string) => `covers/${bookId}.png`

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function requireUuid(value: unknown, name: string): string {
  if (!isUuid(value)) throw new HostServiceError('INVALID_ARGUMENT', `${name} must be a UUID`)
  return value.toLowerCase()
}

function isNoSpace(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /ENOSPC|no space|disk full|not enough space/i.test(text)
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim())
  return match ? match[1]!.toLowerCase() : ''
}

/** The display name only: no folder part, no control characters, bounded. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, ' ').trim()
  return base.slice(0, 200) || 'Untitled'
}

export function createFileService(options: FileServiceOptions) {
  const { fs } = options
  const yieldToEvents = options.yieldToEvents ?? (() => Promise.resolve())
  let pickCounter = 0
  const newPickId = options.newPickId ?? (() => `pick-${++pickCounter}-${Math.random().toString(36).slice(2, 12)}`)
  const picks = new Map<string, PickedDocument>()
  /** Running stage / hash jobs; `cancelled` is read between chunks. */
  const jobs = new Map<string, { cancelled: boolean }>()

  function startJob(stagingId: string) {
    if (jobs.has(stagingId)) throw new HostServiceError('ALREADY_EXISTS', 'This import is already running')
    const job = { cancelled: false }
    jobs.set(stagingId, job)
    return job
  }

  async function pick(raw: unknown): Promise<PickResult> {
    const args = argsObject(raw)
    const wanted = args.extensions
    if (!Array.isArray(wanted) || wanted.length === 0 || !wanted.every((e) => (IMPORTABLE_EXTENSIONS as readonly unknown[]).includes(e))) {
      throw new HostServiceError('INVALID_ARGUMENT', `extensions must be a non-empty subset of ${IMPORTABLE_EXTENSIONS.join(', ')}`)
    }
    let picked: PickedDocument | null
    try {
      picked = await fs.pickDocument()
    } catch {
      throw new HostServiceError('READ_FAILED', 'The file picker could not open the file')
    }
    if (!picked) return { status: 'cancelled' }
    const name = safeDisplayName(picked.name)
    const extension = extensionOf(name)
    if (!(wanted as string[]).includes(extension)) {
      fs.discardUri(picked.uri)
      return { status: 'unsupported', name }
    }
    const pickId = newPickId()
    picks.set(pickId, { ...picked, name })
    return { status: 'picked', pickId, name, size: picked.size, extension: extension as ImportableExtension }
  }

  async function stage(raw: unknown): Promise<{ size: number }> {
    const args = argsObject(raw)
    const stagingId = requireUuid(args.stagingId, 'stagingId')
    const picked = typeof args.pickId === 'string' ? picks.get(args.pickId) : undefined
    if (!picked) throw new HostServiceError('NOT_FOUND', 'Unknown pickId')
    picks.delete(args.pickId as string)
    const job = startJob(stagingId)
    const target = stagingFile(stagingId)
    let reader: ByteReader | undefined
    let writer: ByteWriter | undefined
    try {
      if (fs.availableBytes() < picked.size + FILE_LIMITS.spaceMarginBytes) {
        throw new HostServiceError('NO_SPACE', 'There is not enough free space on this device for this book')
      }
      fs.mkdirp(stagingDir(stagingId))
      try {
        reader = fs.openReadUri(picked.uri)
      } catch {
        throw new HostServiceError('READ_FAILED', 'The picked file could not be read')
      }
      writer = fs.openWrite(target)
      let done = 0
      let reported = 0
      options.emitProgress?.({ stagingId, step: 'copying', doneBytes: 0, totalBytes: picked.size })
      for (;;) {
        if (job.cancelled) throw new HostServiceError('CANCELLED', 'Import cancelled')
        let chunk: Uint8Array
        try {
          chunk = reader.read(FILE_LIMITS.chunkBytes)
        } catch {
          throw new HostServiceError('READ_FAILED', 'The picked file could not be read')
        }
        if (chunk.length === 0) break
        try {
          writer.write(chunk)
        } catch (error) {
          if (isNoSpace(error)) throw new HostServiceError('NO_SPACE', 'The device ran out of space while copying the book')
          throw new HostServiceError('WRITE_FAILED', 'The book could not be copied into the app')
        }
        done += chunk.length
        if (done - reported >= FILE_LIMITS.progressEveryBytes) {
          reported = done
          options.emitProgress?.({ stagingId, step: 'copying', doneBytes: done, totalBytes: picked.size })
        }
        await yieldToEvents()
      }
      writer.close()
      writer = undefined
      options.emitProgress?.({ stagingId, step: 'copying', doneBytes: done, totalBytes: done })
      return { size: done }
    } catch (error) {
      writer?.close()
      fs.remove(stagingDir(stagingId))
      if (error instanceof HostServiceError) throw error
      if (isNoSpace(error)) throw new HostServiceError('NO_SPACE', 'The device ran out of space while copying the book')
      throw new HostServiceError('WRITE_FAILED', 'The book could not be copied into the app')
    } finally {
      reader?.close()
      fs.discardUri(picked.uri)
      jobs.delete(stagingId)
    }
  }

  async function hashStaged(raw: unknown): Promise<{ sha256: string; size: number }> {
    const stagingId = requireUuid(argsObject(raw).stagingId, 'stagingId')
    const file = stagingFile(stagingId)
    const size = fs.fileSize(file)
    if (size === undefined) throw new HostServiceError('NOT_FOUND', 'Nothing is staged under this id')
    const job = startJob(stagingId)
    const reader = fs.openRead(file)
    try {
      const hash = new Sha256()
      let done = 0
      let reported = 0
      for (;;) {
        if (job.cancelled) throw new HostServiceError('CANCELLED', 'Import cancelled')
        const chunk = reader.read(FILE_LIMITS.chunkBytes)
        if (chunk.length === 0) break
        hash.update(chunk)
        done += chunk.length
        if (done - reported >= FILE_LIMITS.progressEveryBytes) {
          reported = done
          options.emitProgress?.({ stagingId, step: 'hashing', doneBytes: done, totalBytes: size })
        }
        await yieldToEvents()
      }
      return { sha256: hash.digestHex(), size: done }
    } catch (error) {
      if (error instanceof HostServiceError) throw error
      throw new HostServiceError('READ_FAILED', 'The staged book could not be read')
    } finally {
      reader.close()
      jobs.delete(stagingId)
    }
  }

  async function commitStaged(raw: unknown): Promise<{ path: string }> {
    const args = argsObject(raw)
    const stagingId = requireUuid(args.stagingId, 'stagingId')
    const bookId = requireUuid(args.bookId, 'bookId')
    if (fs.fileSize(stagingFile(stagingId)) === undefined) throw new HostServiceError('NOT_FOUND', 'Nothing is staged under this id')
    if (fs.exists(bookDir(bookId))) throw new HostServiceError('ALREADY_EXISTS', 'A book folder with this id already exists')
    try {
      fs.mkdirp(bookDir(bookId))
      await fs.move(stagingFile(stagingId), bookFile(bookId))
    } catch (error) {
      fs.remove(bookDir(bookId))
      if (isNoSpace(error)) throw new HostServiceError('NO_SPACE', 'The device ran out of space while saving the book')
      throw new HostServiceError('WRITE_FAILED', 'The book could not be moved into the library')
    }
    fs.remove(stagingDir(stagingId))
    return { path: bookFile(bookId) }
  }

  function discardStaged(raw: unknown): { discarded: true } {
    const stagingId = requireUuid(argsObject(raw).stagingId, 'stagingId')
    const job = jobs.get(stagingId)
    if (job) job.cancelled = true
    fs.remove(stagingDir(stagingId))
    return { discarded: true }
  }

  /** Stops a running `stage` / `hashStaged`; the job then fails with `CANCELLED` and removes its staging folder. */
  function cancel(raw: unknown): { cancelled: boolean } {
    const stagingId = requireUuid(argsObject(raw).stagingId, 'stagingId')
    const job = jobs.get(stagingId)
    if (job) job.cancelled = true
    return { cancelled: job !== undefined }
  }

  /** Only `books/{uuid}/` and `covers/{uuid}.png`: the id is a validated UUID, so nothing else can be named. */
  function removeBook(raw: unknown): { removed: true } {
    const bookId = requireUuid(argsObject(raw).bookId, 'bookId')
    fs.remove(bookDir(bookId))
    fs.remove(coverFile(bookId))
    return { removed: true }
  }

  function writeCover(raw: unknown): { path: string } {
    const args = argsObject(raw)
    const bookId = requireUuid(args.bookId, 'bookId')
    if (typeof args.base64 !== 'string' || args.base64.length > Math.ceil(FILE_LIMITS.coverMaxBytes / 3) * 4) {
      throw new HostServiceError('TOO_LARGE', 'A cover must be at most 4 MB')
    }
    const bytes = base64ToBytes(args.base64)
    if (!bytes || bytes.length <= PNG_MAGIC.length || PNG_MAGIC.some((b, i) => bytes[i] !== b)) {
      throw new HostServiceError('INVALID_ARGUMENT', 'A cover must be a PNG image')
    }
    if (fs.fileSize(bookFile(bookId)) === undefined) throw new HostServiceError('NOT_FOUND', 'No book with this id')
    try {
      fs.mkdirp('covers')
      fs.writeFile(coverFile(bookId), bytes)
    } catch (error) {
      if (isNoSpace(error)) throw new HostServiceError('NO_SPACE', 'There is not enough free space for the cover')
      throw new HostServiceError('WRITE_FAILED', 'The cover could not be saved')
    }
    return { path: coverFile(bookId) }
  }

  /** Startup: empties `staging/` (except running jobs), and removes book folders and covers that have no row. */
  function sweep(raw: unknown): { removed: number } {
    const known = argsObject(raw).knownBookIds
    if (!Array.isArray(known) || !known.every((id) => typeof id === 'string')) {
      throw new HostServiceError('INVALID_ARGUMENT', 'knownBookIds must be a list of ids')
    }
    const keep = new Set((known as string[]).map((id) => id.toLowerCase()))
    let removed = 0
    for (const name of fs.list('staging')) {
      if (jobs.has(name.toLowerCase())) continue
      fs.remove(`staging/${name}`)
      removed++
    }
    for (const name of fs.list('books')) {
      if (isUuid(name) && keep.has(name.toLowerCase())) continue
      fs.remove(`books/${name}`)
      removed++
    }
    for (const name of fs.list('covers')) {
      const id = name.endsWith('.png') ? name.slice(0, -4) : ''
      if (isUuid(id) && keep.has(id.toLowerCase())) continue
      fs.remove(`covers/${name}`)
      removed++
    }
    return { removed }
  }

  /** Expo Go only: a book's bytes as base64, at most 1 MiB per call and 20 MB per book. Read only. */
  function readChunk(raw: unknown): { base64: string; eof: boolean; size: number } {
    const args = argsObject(raw)
    const bookId = requireUuid(args.bookId, 'bookId')
    const { offset, length } = args
    if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new HostServiceError('INVALID_ARGUMENT', 'offset must be a whole number')
    if (!Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > DEV_CHUNK_MAX_BYTES) {
      throw new HostServiceError('INVALID_ARGUMENT', `length must be 1 to ${DEV_CHUNK_MAX_BYTES} bytes`)
    }
    const size = fs.fileSize(bookFile(bookId))
    if (size === undefined) throw new HostServiceError('NOT_FOUND', 'No book with this id')
    if (size > DEV_BOOK_MAX_BYTES) throw new HostServiceError('BOOK_TOO_LARGE_FOR_DEV', 'Books above 20 MB open only in the installed app, not in Expo Go')
    if ((offset as number) > size) throw new HostServiceError('INVALID_ARGUMENT', 'offset is past the end of the book')
    const take = Math.min(length as number, size - (offset as number))
    let bytes: Uint8Array
    try {
      bytes = take > 0 ? fs.readRange(bookFile(bookId), offset as number, take) : new Uint8Array(0)
    } catch {
      throw new HostServiceError('READ_FAILED', 'The book could not be read')
    }
    return { base64: bytesToBase64(bytes), eof: (offset as number) + bytes.length >= size, size }
  }

  /** Expo Go only: the cover as base64, for a `data:` URL (there are no cover routes without the local server). */
  function readCover(raw: unknown): { base64: string } | null {
    const bookId = requireUuid(argsObject(raw).bookId, 'bookId')
    const size = fs.fileSize(coverFile(bookId))
    if (size === undefined || size > FILE_LIMITS.coverMaxBytes) return null
    try {
      return { base64: bytesToBase64(fs.readRange(coverFile(bookId), 0, size)) }
    } catch {
      return null
    }
  }

  const methods: Record<string, (args: unknown) => unknown> = {
    pick,
    stage,
    hashStaged,
    commitStaged,
    discardStaged,
    cancel,
    removeBook,
    writeCover,
    sweep,
  }
  if (options.devChunks) Object.assign(methods, { readChunk, readCover })
  return methods
}
