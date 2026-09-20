import type { Book, CollectionBook } from '../domain/index.js';
import type { CollectionStore, LibraryStore } from '../domain-ports/index.js';

/**
 * Manage membership of books in a collection (SDS — CollectionService add/remove/list).
 */
export class ManageCollectionBooksService {
  constructor(
    _collections: CollectionStore,
    _library: LibraryStore,
  ) {}

  async addBook(
    _collectionId: string,
    _bookId: string,
  ): Promise<CollectionBook> {
    throw new Error('ManageCollectionBooksService.addBook: not implemented');
  }

  async removeBook(_collectionId: string, _bookId: string): Promise<void> {
    throw new Error('ManageCollectionBooksService.removeBook: not implemented');
  }

  async listBooks(_collectionId: string): Promise<Book[]> {
    throw new Error('ManageCollectionBooksService.listBooks: not implemented');
  }
}
