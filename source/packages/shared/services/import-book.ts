import type { Book, DocumentImporter, LibraryStore } from '@reading-book/domain';

/**
 * Import a local document into the library (SDS — ImportBookService).
 * Skeleton: real import/dedup lands in later phases.
 */
export class ImportBookService {
  constructor(
    private readonly importer: DocumentImporter,
    private readonly library: LibraryStore,
  ) {}

  async importFromPath(_path: string): Promise<Book> {
    throw new Error('ImportBookService.importFromPath: not implemented');
  }
}
