import type { DocumentFormat } from '../models/document-format.js';

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
  /** Original source path before sandbox copy (optional). */
  sourcePath?: string;
}

/**
 * Import a local document into the sandbox and extract metadata (SDS §2.6).
 * Adapters: Epub / Pdf / Txt / Md Importers.
 */
export interface DocumentImporter {
  canHandle(path: string): boolean;
  import(path: string): Promise<ImportResult>;
}
