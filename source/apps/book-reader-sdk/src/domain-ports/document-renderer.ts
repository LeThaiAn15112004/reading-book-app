import type { Book } from '../domain/book.js';
import type { DocumentFormat } from '../domain/document-format.js';
import type { Location } from '../domain/location.js';

/**
 * Pluggable document renderer chosen by Book.format (SDS §2.6).
 * Adapters: ReflowHtmlRenderer, PdfPageRenderer — implemented in app Infrastructure.
 */
export interface DocumentRenderer {
  canHandle(format: DocumentFormat): boolean;
  open(book: Book): Promise<void>;
  goTo(location: Location): Promise<void>;
  close(): Promise<void>;
}
