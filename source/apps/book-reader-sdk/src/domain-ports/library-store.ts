import type { Book } from '../domain/book.js';
import type { BookAuthor } from '../domain/author.js';
import type { BookGenre } from '../domain/genre.js';

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
  linkGenres(bookId: string, genres: BookGenre[]): Promise<void>;
  deleteCascade(bookId: string): Promise<void>;
}
