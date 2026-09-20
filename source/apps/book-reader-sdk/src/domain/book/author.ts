export interface AuthorProps {
  id: string;
  name: string;
  sortName?: string;
  /** ISO-8601 datetime */
  createdAt: string;
}

/** Shared author profile (SDS §3 — AUTHOR). */
export class Author {
  readonly id: string;
  name: string;
  sortName?: string;
  readonly createdAt: string;

  constructor(props: AuthorProps) {
    if (!props.id.trim()) {
      throw new Error('Author.id is required');
    }
    if (!props.name.trim()) {
      throw new Error('Author.name is required');
    }
    this.id = props.id;
    this.name = props.name.trim();
    this.sortName = props.sortName?.trim() || undefined;
    this.createdAt = props.createdAt;
  }

  displaySortKey(): string {
    return (this.sortName ?? this.name).toLocaleLowerCase();
  }

  rename(name: string, sortName?: string): void {
    if (!name.trim()) {
      throw new Error('Author.name must not be empty');
    }
    this.name = name.trim();
    this.sortName = sortName?.trim() || undefined;
  }

  static create(id: string, name: string, sortName?: string): Author {
    return new Author({
      id,
      name,
      sortName,
      createdAt: new Date().toISOString(),
    });
  }
}

export interface BookAuthorProps {
  bookId: string;
  authorId: string;
  sortOrder: number;
}

/** Book ↔ Author link with display order (SDS §3 — BOOK_AUTHOR). */
export class BookAuthor {
  readonly bookId: string;
  readonly authorId: string;
  sortOrder: number;

  constructor(props: BookAuthorProps) {
    this.bookId = props.bookId;
    this.authorId = props.authorId;
    this.sortOrder = props.sortOrder;
  }

  withOrder(sortOrder: number): BookAuthor {
    return new BookAuthor({
      bookId: this.bookId,
      authorId: this.authorId,
      sortOrder,
    });
  }
}
