import { DocumentFormat, type DocumentImporter } from '@reading-book/domain'
import { docAdapter } from './doc.adapter'
import { docxAdapter } from './docx.adapter'
import { epubAdapter } from './epub.adapter'
import { mdAdapter } from './md.adapter'
import { pdfAdapter } from './pdf.adapter'
import { txtAdapter } from './txt.adapter'

const REGISTRY: ReadonlyMap<DocumentFormat, DocumentImporter> = new Map([
  [DocumentFormat.Epub, epubAdapter],
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
