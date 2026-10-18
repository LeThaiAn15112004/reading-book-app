import fsp from 'node:fs/promises'
import type { DocumentFormatDto } from '../ipc/api-types'
import { readEpubSpineDocuments } from '../adapters/epub.adapter'
import { htmlToParagraphs, type TextParagraph } from '@reading-book/book-reader-sdk'
import { pdfParagraphs } from './pdf-text'
import { decodeTxtBytes } from '../txt/txt-codec'

/**
 * Formats whose text we can pull out today. DOCX / DOC need a parser that is not a dependency yet
 * (G6), so they are reported as unsupported instead of failing every open. PDF uses its text layer
 * (pdf.js); scanned PDFs have none and end up with zero chunks ("no text"), not "unsupported".
 */
const CHUNKABLE_FORMATS: ReadonlySet<DocumentFormatDto> = new Set(['epub', 'txt', 'md', 'pdf'])

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

export function isChunkableFormat(format: string): format is DocumentFormatDto {
  return CHUNKABLE_FORMATS.has(format as DocumentFormatDto)
}

/** Split plain text on blank lines, tracking each paragraph's char offset. */
function* plainTextParagraphs(text: string): Generator<TextParagraph> {
  const withoutBom = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text
  const normalised = withoutBom.replace(/\r\n?/g, '\n')
  // No blank-line structure (hard-wrapped or single block) → fall back to single newlines.
  const separator = /\n[ \t]*\n/.test(normalised) ? /\n[ \t]*\n+/g : /\n+/g

  let cursor = 0
  for (const match of normalised.matchAll(separator)) {
    const end = match.index ?? 0
    const slice = normalised.slice(cursor, end)
    if (slice.trim()) yield { chapterIndex: 0, offset: cursor, text: slice }
    cursor = end + match[0].length
  }
  const tail = normalised.slice(cursor)
  if (tail.trim()) yield { chapterIndex: 0, offset: cursor, text: tail }
}

async function* epubParagraphs(filePath: string): AsyncGenerator<TextParagraph> {
  for await (const doc of readEpubSpineDocuments(filePath)) {
    let offset = 0
    for (const text of htmlToParagraphs(doc.html)) {
      yield { chapterIndex: doc.index, offset, text }
      offset += text.length + 2 // paragraphs are joined by a blank line in the chapter text
    }
  }
}

/** Stream a book's readable paragraphs in reading order. Throws for unsupported formats. */
export async function* extractBookParagraphs(
  filePath: string,
  format: DocumentFormatDto,
): AsyncGenerator<TextParagraph> {
  switch (format) {
    case 'epub':
      yield* epubParagraphs(filePath)
      return
    case 'txt':
      // The same decoder the reader opens the book with, so a chunk's `offset` is an offset into
      // the text on screen (BOM / UTF-16 / legacy encodings included).
      yield* plainTextParagraphs(decodeTxtBytes(await fsp.readFile(filePath)).text)
      return
    case 'md':
      yield* plainTextParagraphs(await fsp.readFile(filePath, 'utf8'))
      return
    case 'pdf':
      yield* pdfParagraphs(filePath)
      return
    default:
      throw new Error(`Text extraction is not supported for format: ${format}`)
  }
}
