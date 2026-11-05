import type { Book } from '../domain/index.js';
import type { DocumentImporter, LibraryStore } from '../domain-ports/index.js';

/**
 * Import a local document into the library (SDS — ImportBookService).
 * Skeleton: real import/dedup lands in later phases.
 */
export class ImportBookService {
  constructor(
    _importer: DocumentImporter,
    _library: LibraryStore,
  ) {}

  async importFromPath(_path: string): Promise<Book> {
    throw new Error('ImportBookService.importFromPath: not implemented');
  }
}
