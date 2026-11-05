import { requirePort } from '../core/adapter-guard.js'
import { SdkError, toSdkError } from '../core/errors.js'
import type { SdkRuntime } from '../core/runtime.js'
import { Book, DocumentFormat, isDocumentFormat } from '../domain/index.js'
import { readEpubImportMetadata, type EpubImportMetadata } from '../epub/epub-package.js'
import type { ArchiveReader } from '../ports/archive.js'
import type { FileRef } from '../ports/file-system.js'

export interface ImportFileInput {
  /** Where to read the original from. Never modified. */
  sourceRef: FileRef
  /** Display name when `sourceRef` has none (content URIs, downloads). */
  fileName?: string
  sourceUrl?: string
  sourceProvider?: string
  externalId?: string
}

export type ImportOutcome =
  | { status: 'imported'; book: Book }
  /** Same SHA-256 already in the library (BR-03) — `book` is the existing row. */
  | { status: 'duplicate'; book: Book }

export type BookUpdate = Partial<Pick<Book, 'title' | 'description' | 'isFavorite'>>

export interface LibraryService {
  list(): Promise<Book[]>
  get(id: string): Promise<Book | null>
  importFile(input: ImportFileInput): Promise<ImportOutcome>
  update(id: string, patch: BookUpdate): Promise<Book>
  /** Deletes the row (cascading overlays) and the sandbox copies — never the original source file. */
  remove(id: string): Promise<boolean>
}

/** `path/to/My Book.epub` → `My Book.epub`. Works for POSIX paths, `file://` and `content://` URIs. */
function fileNameFromRef(ref: FileRef): string {
  const withoutQuery = ref.split(/[?#]/, 1)[0] ?? ref
  const segments = withoutQuery.split('/')
  return decodeURIComponent(segments[segments.length - 1] ?? ref)
}

function formatFromFileName(fileName: string): DocumentFormat | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase()
  return ext && isDocumentFormat(ext) ? ext : undefined
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, '').trim() || fileName
}

export function createLibraryService(rt: SdkRuntime): LibraryService {
  const repo = rt.storage.library

  const storage = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      throw toSdkError(err, 'STORAGE_FAILED', message)
    }
  }

  async function readMetadata(bytes: Uint8Array, bookId: string): Promise<EpubImportMetadata | undefined> {
    if (!rt.archive) {
      rt.logger.info('No archive adapter — EPUB imported with file-name metadata only', { bookId })
      return undefined
    }
    let reader: ArchiveReader | undefined
    try {
      reader = await rt.archive.open(bytes)
      return await readEpubImportMetadata(reader)
    } catch (err) {
      // Metadata is best-effort: a quirky package must not block the import itself.
      rt.logger.warn('EPUB metadata extraction failed, using file-name fallback', { bookId, error: err })
      return undefined
    } finally {
      await reader?.close?.()
    }
  }

  return {
    // `LibraryStore` (packages/domain) has no "list all books" method yet — only lookups by id,
    // sha256 or author. Listing the whole library needs that port extended before this can work.
    list: () => {
      throw new SdkError('ADAPTER_MISSING', 'library.list: LibraryStore has no list-all method yet')
    },

    get: (id) => storage('Could not load book', async () => (await repo.findById(id)) ?? null),

    async importFile(input) {
      rt.lifecycle.assertAlive('library.importFile')
      const fs = requirePort('fileSystem', rt.fileSystem, 'library.importFile')
      const hash = requirePort('hash', rt.hash, 'library.importFile')

      const fileName = input.fileName?.trim() || fileNameFromRef(input.sourceRef)
      const format = formatFromFileName(fileName)
      if (!format) {
        throw new SdkError('UNSUPPORTED_FORMAT', `Unsupported file type: ${fileName || input.sourceRef}`)
      }

      const bytes = await fs.readBytes(input.sourceRef)
      const sha256 = (await hash.sha256Hex(bytes)).toLowerCase()

      const existing = await storage('Could not check for duplicates', () => repo.findBySha256(sha256))
      if (existing) return { status: 'duplicate', book: existing }

      const id = rt.ids.newId()
      const created: FileRef[] = []
      try {
        const filePath = await fs.copyToSandbox(input.sourceRef, `${id}.${format}`)
        created.push(filePath)

        const metadata = format === DocumentFormat.Epub ? await readMetadata(bytes, id) : undefined
        let coverPath: FileRef | undefined
        if (metadata?.cover) {
          coverPath = await fs.writeSandboxFile(`${id}-cover.${metadata.cover.extension}`, metadata.cover.bytes)
          created.push(coverPath)
        }

        const now = rt.clock.nowIso()
        const book = new Book({
          id,
          title: metadata?.title || titleFromFileName(fileName),
          format,
          filePath,
          sha256,
          fileSizeBytes: bytes.length,
          isFavorite: false,
          addedAt: now,
          updatedAt: now,
          ...(coverPath ? { coverPath } : {}),
          ...(metadata?.description ? { description: metadata.description } : {}),
          ...(metadata?.pageCount ? { pageCount: metadata.pageCount } : {}),
          ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
          ...(input.sourceProvider ? { sourceProvider: input.sourceProvider } : {}),
          ...(input.externalId ? { externalId: input.externalId } : {}),
        })
        // Author / genre linking needs id lookup-or-create against LibraryStore, which the SDK's
        // port surface does not expose yet — the book row is saved without them for now.

        await storage('Could not save imported book', () => repo.save(book))
        rt.events.emit('library:changed', { reason: 'imported', bookId: id })
        return { status: 'imported', book }
      } catch (err) {
        // Compensate: no orphan sandbox files for a book that never made it into the library.
        for (const ref of created) {
          await fs.removeSandboxFile(ref).catch((cleanupErr: unknown) =>
            rt.logger.warn('Could not remove orphan sandbox file', { ref, error: cleanupErr }),
          )
        }
        throw err
      }
    },

    async update(id, patch) {
      const current = await storage('Could not load book', () => repo.findById(id))
      if (!current) throw new SdkError('NOT_FOUND', `Book ${id} not found`)
      if (patch.title !== undefined) current.rename(patch.title)
      if (patch.isFavorite !== undefined) current.setFavorite(patch.isFavorite)
      if (patch.description !== undefined) current.description = patch.description
      current.touch(rt.clock.nowIso())
      await storage('Could not update book', () => repo.save(current))
      rt.events.emit('library:changed', { reason: 'updated', bookId: id })
      return current
    },

    async remove(id) {
      const current = await storage('Could not load book', () => repo.findById(id))
      if (!current) return false
      await storage('Could not delete book', () => repo.deleteCascade(id))
      if (rt.fileSystem) {
        for (const ref of [current.filePath, current.coverPath]) {
          if (!ref) continue
          await rt.fileSystem
            .removeSandboxFile(ref)
            .catch((err: unknown) => rt.logger.warn('Could not remove sandbox file', { ref, error: err }))
        }
      }
      rt.events.emit('library:changed', { reason: 'removed', bookId: id })
      return true
    },
  }
}
