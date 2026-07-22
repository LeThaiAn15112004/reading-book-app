import { DocumentFormat } from '@reading-book/domain'
import { createFilenameFallbackImporter } from './filename-fallback-importer'

/** DOCX DocumentImporter — filename stub (T2.9); deeper metadata / render → G6. */
export const docxAdapter = createFilenameFallbackImporter(DocumentFormat.Docx)
