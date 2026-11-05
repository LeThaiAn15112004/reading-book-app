import type { LibraryStore, OverlayStore } from '../domain-ports/index.js';
import type { BookSession } from '../app-models/book-session.js';

/**
 * Open a book for reading and load last session state (SDS — ReaderService.open).
 */
export class OpenReaderService {
  constructor(
    _library: LibraryStore,
    _overlays: OverlayStore,
  ) {}

  async open(_bookId: string): Promise<BookSession> {
    throw new Error('OpenReaderService.open: not implemented');
  }
}
