import { DocumentFormat } from '@reading-book/domain'
import { createFilenameFallbackImporter } from './filename-fallback-importer'

/** Legacy DOC DocumentImporter — filename stub (T2.9); normalize / render → G6. */
export const docAdapter = createFilenameFallbackImporter(DocumentFormat.Doc)
