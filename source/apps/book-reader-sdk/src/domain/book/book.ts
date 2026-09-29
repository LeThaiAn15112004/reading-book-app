import { Author } from './author.js';
import type { BookSignatureInfo } from './book-signature.js';
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
  /** Short blurb / OPF description for Library cards. */
  description?: string;
  /** Page or spine-section count when known. */
  pageCount?: number;
  isFavorite?: boolean;
  /**
   * Cached signature-verification result (`metadata_json.signatureStatus` & co). Absent = the file
   * has not been checked yet. Only trust it after `isSignatureInfoCurrent(…, hashOfFileNow)`.
   */
  signature?: BookSignatureInfo;
  sourceUrl?: string;
  /** Cloud Sources provenance: provider this file was downloaded from, if any. */
  sourceProvider?: string;
  /** Cloud Sources provenance: the provider's id for this file, if any. */
  externalId?: string;
  addedAt: string;
  updatedAt: string;
  authors?: Author[];
}

/**
 * Book / document metadata (SDS §3 — BOOK).
 * Binary file lives on disk; this model only stores paths + metadata.
 * Genres are linked via BOOK_GENRE (n–n), not a column on Book.
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
  description?: string;
  pageCount?: number;
  isFavorite: boolean;
  signature?: BookSignatureInfo;
  sourceUrl?: string;
  sourceProvider?: string;
  externalId?: string;
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
    this.description = props.description?.trim() || undefined;
    this.pageCount =
      props.pageCount != null && props.pageCount > 0
        ? Math.floor(props.pageCount)
        : undefined;
    this.isFavorite = props.isFavorite ?? false;
    this.signature = props.signature ? { ...props.signature } : undefined;
    this.sourceUrl = props.sourceUrl;
    this.sourceProvider = props.sourceProvider;
    this.externalId = props.externalId;
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

  /** Replace the cached signature result (`undefined` clears it, e.g. before a re-check). */
  setSignature(info: BookSignatureInfo | undefined): void {
    this.signature = info ? { ...info } : undefined;
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
