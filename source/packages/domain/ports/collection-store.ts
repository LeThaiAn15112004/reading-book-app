import type { Book } from '../models/book.js';
import type { Collection, CollectionBook } from '../models/collection.js';

/**
 * Persistence port for collections and membership (SDS §2.6 / class diagram).
 */
export interface CollectionStore {
  findById(id: string): Promise<Collection | undefined>;
  listAll(): Promise<Collection[]>;
  save(collection: Collection): Promise<void>;
  delete(collectionId: string): Promise<void>;
  linkBook(link: CollectionBook): Promise<void>;
  unlinkBook(collectionId: string, bookId: string): Promise<void>;
  listBooks(collectionId: string): Promise<Book[]>;
}
