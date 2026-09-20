import { DocumentFormat } from '@reading-book/book-reader-sdk'
import { createFilenameFallbackImporter } from './filename-fallback-importer'

/** Markdown DocumentImporter — filename stub (T2.9); deeper metadata / render → G6. */
export const mdAdapter = createFilenameFallbackImporter(DocumentFormat.Md)
