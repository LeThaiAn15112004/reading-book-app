import type { LibraryStore, OverlayStore } from '@reading-book/domain';
import type { BookSession } from '../models/book-session.js';

/**
 * Open a book for reading and load last session state (SDS — ReaderService.open).
 */
export class OpenReaderService {
  constructor(
    private readonly library: LibraryStore,
    private readonly overlays: OverlayStore,
  ) {}

  async open(_bookId: string): Promise<BookSession> {
    throw new Error('OpenReaderService.open: not implemented');
  }
}
