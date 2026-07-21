export interface CollectionProps {
  id: string;
  name: string;
  description?: string;
  /** ISO-8601 datetime */
  createdAt: string;
  /** ISO-8601 datetime */
  updatedAt: string;
}

/**
 * User-curated set of books (SDS §3 — COLLECTION).
 * Does not own book files; membership is via CollectionBook.
 */
export class Collection {
  readonly id: string;
  name: string;
  description?: string;
  readonly createdAt: string;
  updatedAt: string;

  constructor(props: CollectionProps) {
    if (!props.id.trim()) throw new Error('Collection.id is required');
    if (!props.name.trim()) throw new Error('Collection.name is required');

    this.id = props.id;
    this.name = props.name.trim();
    this.description = props.description?.trim() || undefined;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  rename(name: string): void {
    if (!name.trim()) throw new Error('Collection.name must not be empty');
    this.name = name.trim();
    this.touch();
  }

  setDescription(description?: string): void {
    this.description = description?.trim() || undefined;
    this.touch();
  }

  touch(now = new Date().toISOString()): void {
    this.updatedAt = now;
  }

  static create(id: string, name: string, description?: string): Collection {
    const now = new Date().toISOString();
    return new Collection({
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export interface CollectionBookProps {
  collectionId: string;
  bookId: string;
  /** Display order within the collection (lower first). */
  sortOrder: number;
  /** ISO-8601 datetime when the book was added to the collection */
  addedAt: string;
}

/** Collection ↔ Book membership with display order (SDS §3 — COLLECTION_BOOK). */
export class CollectionBook {
  readonly collectionId: string;
  readonly bookId: string;
  sortOrder: number;
  readonly addedAt: string;

  constructor(props: CollectionBookProps) {
    if (!props.collectionId.trim()) {
      throw new Error('CollectionBook.collectionId is required');
    }
    if (!props.bookId.trim()) {
      throw new Error('CollectionBook.bookId is required');
    }
    this.collectionId = props.collectionId;
    this.bookId = props.bookId;
    this.sortOrder = props.sortOrder;
    this.addedAt = props.addedAt;
  }

  withOrder(sortOrder: number): CollectionBook {
    return new CollectionBook({
      collectionId: this.collectionId,
      bookId: this.bookId,
      sortOrder,
      addedAt: this.addedAt,
    });
  }

  static link(
    collectionId: string,
    bookId: string,
    sortOrder = 0,
  ): CollectionBook {
    return new CollectionBook({
      collectionId,
      bookId,
      sortOrder,
      addedAt: new Date().toISOString(),
    });
  }
}
