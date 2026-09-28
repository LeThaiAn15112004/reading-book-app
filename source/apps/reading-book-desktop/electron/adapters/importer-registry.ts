import { DocumentFormat, type DocumentImporter } from '@reading-book/book-reader-sdk'
import { docAdapter } from './doc.adapter'
import { docxAdapter } from './docx.adapter'
import { createEpubAdapter } from './epub.adapter'
import { mdAdapter } from './md.adapter'
import { pdfAdapter } from './pdf.adapter'
import { txtAdapter } from './txt.adapter'
import { ensureCoversDir } from '../files/sandbox'

const REGISTRY: ReadonlyMap<DocumentFormat, DocumentImporter> = new Map([
  [DocumentFormat.Epub, createEpubAdapter({ coversDir: ensureCoversDir })],
  [DocumentFormat.Pdf, pdfAdapter],
  [DocumentFormat.Txt, txtAdapter],
  [DocumentFormat.Md, mdAdapter],
  [DocumentFormat.Docx, docxAdapter],
  [DocumentFormat.Doc, docAdapter],
])

/**
 * Resolve the DocumentImporter for a supported format (T2.9 complete).
 * EPUB: real OPF metadata; PDF/TXT/MD/DOCX/DOC: filename stubs until G6.
 */
export function getDocumentImporter(format: DocumentFormat): DocumentImporter {
  const importer = REGISTRY.get(format)
  if (!importer) {
    throw new Error(`No DocumentImporter registered for format: ${format}`)
  }
  return importer
}
