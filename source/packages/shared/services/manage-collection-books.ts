import type {
  Book,
  CollectionBook,
  CollectionStore,
  LibraryStore,
} from '@reading-book/domain';

/**
 * Manage membership of books in a collection (SDS — CollectionService add/remove/list).
 */
export class ManageCollectionBooksService {
  constructor(
    private readonly collections: CollectionStore,
    private readonly library: LibraryStore,
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
