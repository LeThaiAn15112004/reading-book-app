export interface GenreProps {
  id: string;
  name: string;
  /** ISO-8601 datetime */
  createdAt: string;
}

/** Shared genre / subject label (SDS — GENRE). */
export class Genre {
  readonly id: string;
  name: string;
  readonly createdAt: string;

  constructor(props: GenreProps) {
    if (!props.id.trim()) throw new Error('Genre.id is required');
    if (!props.name.trim()) throw new Error('Genre.name is required');
    this.id = props.id;
    this.name = props.name.trim();
    this.createdAt = props.createdAt;
  }

  static create(id: string, name: string): Genre {
    return new Genre({
      id,
      name,
      createdAt: new Date().toISOString(),
    });
  }
}

export interface BookGenreProps {
  bookId: string;
  genreId: string;
}

/** Book ↔ Genre link (SDS — BOOK_GENRE). */
export class BookGenre {
  readonly bookId: string;
  readonly genreId: string;

  constructor(props: BookGenreProps) {
    this.bookId = props.bookId;
    this.genreId = props.genreId;
  }
}
