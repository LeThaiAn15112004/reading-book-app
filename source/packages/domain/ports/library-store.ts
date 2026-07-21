import type { Book } from '../models/book.js';
import type { BookAuthor } from '../models/author.js';

/**
 * Persistence port for books and author links (SDS §2.6 / class diagram).
 * Implemented by SqliteStore in Infrastructure — Domain only declares the contract.
 */
export interface LibraryStore {
  findById(id: string): Promise<Book | undefined>;
  findBySha256(hash: string): Promise<Book | undefined>;
  findByAuthor(authorId: string): Promise<Book[]>;
  save(book: Book): Promise<void>;
  linkAuthors(bookId: string, authors: BookAuthor[]): Promise<void>;
  deleteCascade(bookId: string): Promise<void>;
}
