import type { DocumentFormat } from '../domain/document-format.js';

/**
 * Result of a successful local-file import (enough metadata to create a Book).
 * Binary file is already in sandbox; Domain does not perform I/O.
 */
export interface ImportResult {
  title: string;
  format: DocumentFormat;
  /** Absolute path inside the app sandbox after copy. */
  filePath: string;
  sha256: string;
  fileSizeBytes?: number;
  coverPath?: string;
  authorNames?: string[];
  /** Short description / blurb when extractable. */
  description?: string;
  /** Genre / subject names (stored in books.genres_json). */
  genreNames?: string[];
  /** Page or spine-section count when known. */
  pageCount?: number;
  /** Original source path before sandbox copy (optional). */
  sourcePath?: string;
}

/**
 * Import a local document into the sandbox and extract metadata (SDS §2.6).
 * Adapters: Epub / Pdf / Txt / Md Importers.
 */
/** Spec 016 (FR-003): what the caller already knows about the file, so the importer does not hash it again. */
export interface DocumentImportOptions {
  known?: { sha256: string; fileSizeBytes: number };
}

export interface DocumentImporter {
  canHandle(path: string): boolean;
  import(path: string, options?: DocumentImportOptions): Promise<ImportResult>;
}
