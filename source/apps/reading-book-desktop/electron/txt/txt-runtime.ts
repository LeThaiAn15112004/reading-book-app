import { invalidateBookChunks } from '../chunking/book-chunk-service'
import { resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { getOverlayStore } from '../persistence/sqlite-overlay-store'
import { getTxtStore } from '../persistence/sqlite-txt-store'
import { createTxtDocumentService, type TxtDocumentService } from './txt-document-service'
import { getTxtWorkingCopies } from './txt-storage'

let service: TxtDocumentService | null = null

/** The singleton TXT document service wired to the real library, overlay and SQLite stores. */
export function getTxtDocumentService(): TxtDocumentService {
  service ??= createTxtDocumentService({
    findBook: async (id) => {
      const book = await getLibraryStore().findById(id)
      return book ? { id: book.id, filePath: book.filePath, format: book.format, sha256: book.sha256 } : undefined
    },
    resolveFile: resolveBookFile,
    store: getTxtStore(),
    overlays: getOverlayStore(),
    copies: getTxtWorkingCopies(),
    invalidateIndex: invalidateBookChunks,
    log: (message, err) => console.warn(`[txt] ${message}`, err ?? ''),
  })
  return service
}

/** A book left the library: forget its session and delete its edited copy. */
export async function removeTxtData(bookId: string): Promise<void> {
  getTxtDocumentService().forget(bookId)
  await getTxtWorkingCopies()
    .remove(bookId)
    .catch((err) => console.warn('[txt] removing the edited copy failed', err))
}
