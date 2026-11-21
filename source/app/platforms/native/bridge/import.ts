/**
 * `import.fromFile`, `cancel`, `onProgress` (spec 008, T060; `data-model.md`, Import job; FR-017g, FR-017h).
 *
 *   picking → copying → hashing → checking → storing → done        any step → failed | cancelled → cleanup
 *
 * The picked file is always copied (never referenced): into `staging/{uuid}/`, hashed there in chunks, checked for a
 * duplicate, then moved to `books/{id}/` just before the row is written. A failed row write removes the moved file;
 * the startup sweep catches anything a killed process left. `duplicate` is a result, not an error, and leaves nothing
 * behind. Metadata is read in the WebView: EPUB through the SDK's OPF reader, everything else from the file name.
 * Covers are not made here: the Library renders one for each book that has none (`generateBookCover.ts`).
 */
import { Book, parseDocumentFormat, readEpubImportMetadata, type DocumentFormat } from '@core'
import { phoneStepTimer } from './app'
import { openBookZip } from './ranged-book'
import type { PickResult } from '../host/file-service'
import type { ImportProgressPayload } from '../host/protocol'
import { bookFilePath } from '../stores/library-store'
import type { BridgeContext } from './context'
import { HostCallError } from './host-client'
import { notAvailableResult } from './unavailable'

type ImportGroup = Window['api']['import']
type ImportResult = Awaited<ReturnType<ImportGroup['fromFile']>>
type ImportProgressDto = Parameters<Parameters<ImportGroup['onProgress']>[0]>[0]

export const MOBILE_IMPORT_EXTENSIONS = ['epub', 'pdf', 'txt', 'md'] as const

const failure = (errorCode: NonNullable<ImportResult['errorCode']>, errorMessage: string, bookId: string | null = null): ImportResult => ({
  ok: false,
  bookId,
  errorCode,
  errorMessage,
})

/** Desktop's titleFromFilename: the base name without its last extension. */
export function titleFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim()
  return stem || base || 'Untitled'
}

interface Metadata {
  title?: string
  authors: string[]
  genres: string[]
  description?: string
  pageCount?: number
}

async function readMetadata(ctx: BridgeContext, bookId: string, format: DocumentFormat): Promise<Metadata> {
  if (format !== 'epub') return { authors: [], genres: [] }
  try {
    // Spec 016 (FR-004a): only the archive's index and the container / OPF entries are read, by ranges from the
    // local server — the WebView never receives the whole file during an import. Same parser, same result.
    const meta = await readEpubImportMetadata(await openBookZip(ctx, bookId), { includeCover: false })
    return { title: meta.title, authors: meta.authors, genres: meta.genres, description: meta.description, pageCount: meta.pageCount }
  } catch (error) {
    // Desktop falls back to the file name too when the OPF cannot be read.
    console.warn('[bridge] EPUB metadata could not be read; using the file name', error)
    return { authors: [], genres: [] }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

export function createImportGroup(ctx: BridgeContext): ImportGroup {
  const listeners = new Set<(progress: ImportProgressDto) => void>()
  let running: { stagingId: string; filename: string; cancelled: boolean; committed: boolean } | null = null

  const emit = (progress: ImportProgressDto) => {
    for (const handler of listeners) {
      try {
        handler(progress)
      } catch (error) {
        console.warn('[bridge] import progress handler failed', error)
      }
    }
  }

  ctx.client.onEvent('importProgress', (raw) => {
    const p = raw as ImportProgressPayload
    if (!running || p?.stagingId !== running.stagingId) return
    emit({
      stage: 'importing',
      filename: running.filename,
      receivedBytes: p.doneBytes,
      totalBytes: p.totalBytes,
      step: p.step === 'copying' ? 'copying' : 'checking',
      doneBytes: p.doneBytes,
    })
  })

  async function discard(stagingId: string) {
    try {
      await ctx.client.call('files', 'discardStaged', { stagingId })
    } catch {
      // The startup sweep removes it.
    }
  }

  async function fromFile(): Promise<ImportResult> {
    if (running) return failure('save_failed', 'Another import is still running.')
    let picked: PickResult
    try {
      picked = await ctx.client.call<PickResult>('files', 'pick', { extensions: MOBILE_IMPORT_EXTENSIONS }, { timeoutMs: 0 })
    } catch {
      return { ok: false, bookId: null, errorMessage: 'Could not open the file picker.' }
    }
    if (picked.status === 'cancelled') return failure('cancelled', 'Import cancelled.')
    if (picked.status === 'unsupported') return failure('unsupported_format', `“${picked.name}” is not a book format Readmate can open here (EPUB, PDF, TXT or Markdown).`)

    const stagingId = ctx.newId()
    const job = { stagingId, filename: picked.name, cancelled: false, committed: false }
    running = job
    emit({ stage: 'importing', filename: picked.name })
    // Spec 016 (US1): developer step timing — format + size only; a no-op unless timing is on.
    const timer = phoneStepTimer()
    const timing = { format: picked.extension, sizeBytes: picked.size ?? 0 }
    try {
      // copying
      const copyStartedAt = Date.now()
      try {
        const staged = await ctx.client.call<{ size: number; fallback?: boolean }>('files', 'stage', { pickId: picked.pickId, stagingId }, { timeoutMs: 0 })
        timer.record('import', staged.fallback ? 'copy-fallback' : 'copy', timing, Date.now() - copyStartedAt)
      } catch (error) {
        const code = error instanceof HostCallError ? error.code : ''
        console.warn('[bridge] import: copying the picked file failed', code, error instanceof Error ? error.message : error)
        if (code === 'CANCELLED' || job.cancelled) return failure('cancelled', 'Import cancelled.')
        if (code === 'NO_SPACE') return failure('save_failed', 'There is not enough free space on this device for this book. Nothing was added.')
        if (code === 'READ_FAILED') return failure('access_denied', 'Could not read the selected file.')
        return failure('save_failed', 'Could not save the book to the library.')
      }
      // hashing
      let sha256: string
      let size: number
      const hashMark = timer.start('import', 'fingerprint', timing)
      try {
        ;({ sha256, size } = await ctx.client.call<{ sha256: string; size: number }>('files', 'hashStaged', { stagingId }, { timeoutMs: 0 }))
        hashMark.end()
      } catch (error) {
        await discard(stagingId)
        if ((error instanceof HostCallError && error.code === 'CANCELLED') || job.cancelled) return failure('cancelled', 'Import cancelled.')
        return failure('save_failed', 'Could not save the book to the library.')
      }
      if (job.cancelled) {
        await discard(stagingId)
        return failure('cancelled', 'Import cancelled.')
      }

      // checking + storing, in the write queue: no other write can slip between the duplicate check and the row.
      return await ctx.writes.run(async () => {
        const dupMark = timer.start('import', 'duplicate-check', timing)
        const existing = await ctx.library.findBySha256(sha256)
        dupMark.end()
        if (existing) {
          await discard(stagingId)
          return failure('duplicate', 'This book is already in your local library. Open the existing copy?', existing.id)
        }
        const bookId = ctx.newId()
        try {
          await ctx.client.call('files', 'commitStaged', { stagingId, bookId })
        } catch (error) {
          await discard(stagingId)
          if (error instanceof HostCallError && error.code === 'NO_SPACE') return failure('save_failed', 'There is not enough free space on this device for this book. Nothing was added.')
          return failure('save_failed', 'Could not save the book to the library.')
        }
        job.committed = true
        const format = parseDocumentFormat(picked.extension)
        const detailsMark = timer.start('import', 'details', timing)
        const meta = await readMetadata(ctx, bookId, format)
        detailsMark.end()
        const now = new Date().toISOString()
        const book = new Book({
          id: bookId,
          title: meta.title?.trim() || titleFromFilename(picked.name),
          filePath: bookFilePath(bookId),
          format,
          sha256,
          fileSizeBytes: size,
          description: meta.description?.trim() || undefined,
          pageCount: meta.pageCount != null && meta.pageCount > 0 ? Math.floor(meta.pageCount) : undefined,
          addedAt: now,
          updatedAt: now,
        })
        const saveMark = timer.start('import', 'save', timing)
        try {
          await ctx.library.persistImported(book, meta.authors, meta.genres)
          saveMark.end()
        } catch (error) {
          // The move succeeded and the commit failed: the file goes (data-model.md).
          try {
            await ctx.client.call('files', 'removeBook', { bookId })
          } catch {
            // The startup sweep removes it: it has no row.
          }
          if (isUniqueViolation(error)) {
            const other = await ctx.library.findBySha256(sha256)
            if (other) return failure('duplicate', 'This book is already in your local library. Open the existing copy?', other.id)
          }
          return failure('save_failed', 'Could not save the book to the library.')
        }
        return { ok: true, bookId }
      })
    } finally {
      running = null
    }
  }

  return {
    fromFile,
    /** Stops copying or hashing; once the file is in the library the import is short and finishes. */
    async cancel() {
      const job = running
      if (!job || job.committed) return { ok: false }
      job.cancelled = true
      try {
        await ctx.client.call('files', 'cancel', { stagingId: job.stagingId })
      } catch {
        // The flag above still stops the job between steps.
      }
      return { ok: true }
    },
    onProgress(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
    fromUrl: notAvailableResult('import.fromUrl', { bookId: null }),
  }
}
