import { Author } from './author.js';
import { DocumentFormat } from './document-format.js';

export interface BookProps {
  id: string;
  title: string;
  filePath: string;
  normalizedPath?: string;
  format: DocumentFormat;
  coverPath?: string;
  sha256: string;
  fileSizeBytes?: number;
  isFavorite?: boolean;
  sourceUrl?: string;
  addedAt: string;
  updatedAt: string;
  authors?: Author[];
}

/**
 * Book / document metadata (SDS §3 — BOOK).
 * Binary file lives on disk; this model only stores paths + metadata.
 */
export class Book {
  readonly id: string;
  title: string;
  filePath: string;
  normalizedPath?: string;
  format: DocumentFormat;
  coverPath?: string;
  readonly sha256: string;
  fileSizeBytes?: number;
  isFavorite: boolean;
  sourceUrl?: string;
  readonly addedAt: string;
  updatedAt: string;
  authors: Author[];

  constructor(props: BookProps) {
    if (!props.id.trim()) throw new Error('Book.id is required');
    if (!props.title.trim()) throw new Error('Book.title is required');
    if (!props.filePath.trim()) throw new Error('Book.filePath is required');
    if (!props.sha256.trim()) throw new Error('Book.sha256 is required');

    this.id = props.id;
    this.title = props.title.trim();
    this.filePath = props.filePath;
    this.normalizedPath = props.normalizedPath;
    this.format = props.format;
    this.coverPath = props.coverPath;
    this.sha256 = props.sha256;
    this.fileSizeBytes = props.fileSizeBytes;
    this.isFavorite = props.isFavorite ?? false;
    this.sourceUrl = props.sourceUrl;
    this.addedAt = props.addedAt;
    this.updatedAt = props.updatedAt;
    this.authors = props.authors ? [...props.authors] : [];
  }

  isImportedFromUrl(): boolean {
    return Boolean(this.sourceUrl);
  }

  authorNames(): string {
    return this.authors.map((a) => a.name).join(', ');
  }

  setFavorite(value: boolean): void {
    this.isFavorite = value;
    this.touch();
  }

  rename(title: string): void {
    if (!title.trim()) throw new Error('Book.title must not be empty');
    this.title = title.trim();
    this.touch();
  }

  setAuthors(authors: Author[]): void {
    this.authors = [...authors];
    this.touch();
  }

  touch(now = new Date().toISOString()): void {
    this.updatedAt = now;
  }
}
