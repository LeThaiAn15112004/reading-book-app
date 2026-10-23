import { DocumentFormat, type DocumentImporter } from '@reading-book/book-reader-sdk'
import { createEpubAdapter } from './epub.adapter'
import { mdAdapter } from './md.adapter'
import { createMp3Adapter } from './mp3.adapter'
import { pdfAdapter } from './pdf.adapter'
import { txtAdapter } from './txt.adapter'
import { ensureCoversDir } from '../files/sandbox'

const REGISTRY: ReadonlyMap<DocumentFormat, DocumentImporter> = new Map([
  [DocumentFormat.Epub, createEpubAdapter({ coversDir: ensureCoversDir })],
  [DocumentFormat.Pdf, pdfAdapter],
  [DocumentFormat.Txt, txtAdapter],
  [DocumentFormat.Md, mdAdapter],
  [DocumentFormat.Mp3, createMp3Adapter({ coversDir: ensureCoversDir })],
])

/**
 * Resolve the DocumentImporter for a supported format (T2.9 complete).
 * EPUB: real OPF metadata; PDF/TXT/MD: filename stubs until G6.
 */
export function getDocumentImporter(format: DocumentFormat): DocumentImporter {
  const importer = REGISTRY.get(format)
  if (!importer) {
    throw new Error(`No DocumentImporter registered for format: ${format}`)
  }
  return importer
}
