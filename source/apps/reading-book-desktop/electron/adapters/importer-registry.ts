import { DocumentFormat, type DocumentImporter } from '@reading-book/book-reader-sdk'
import { createEpubAdapter } from './epub.adapter'
import { mdAdapter } from './md.adapter'
import { createAudioAdapter } from './audio.adapter'
import { pdfAdapter } from './pdf.adapter'
import { txtAdapter } from './txt.adapter'
import { ensureCoversDir } from '../files/sandbox'

const REGISTRY: ReadonlyMap<DocumentFormat, DocumentImporter> = new Map([
  [DocumentFormat.Epub, createEpubAdapter({ coversDir: ensureCoversDir })],
  [DocumentFormat.Pdf, pdfAdapter],
  [DocumentFormat.Txt, txtAdapter],
  [DocumentFormat.Md, mdAdapter],
  [DocumentFormat.Mp3, createAudioAdapter(DocumentFormat.Mp3, { coversDir: ensureCoversDir })],
  [DocumentFormat.M4a, createAudioAdapter(DocumentFormat.M4a, { coversDir: ensureCoversDir })],
  [DocumentFormat.M4b, createAudioAdapter(DocumentFormat.M4b, { coversDir: ensureCoversDir })],
  [DocumentFormat.Aac, createAudioAdapter(DocumentFormat.Aac, { coversDir: ensureCoversDir })],
  [DocumentFormat.Wav, createAudioAdapter(DocumentFormat.Wav, { coversDir: ensureCoversDir })],
  [DocumentFormat.Flac, createAudioAdapter(DocumentFormat.Flac, { coversDir: ensureCoversDir })],
  [DocumentFormat.Ogg, createAudioAdapter(DocumentFormat.Ogg, { coversDir: ensureCoversDir })],
  [DocumentFormat.Opus, createAudioAdapter(DocumentFormat.Opus, { coversDir: ensureCoversDir })],
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
