import type { DocumentFormat, DocumentImporter, ImportResult } from '@reading-book/domain'
import path from 'node:path'
import { resolveFormatFromExtension } from '@reading-book/config'
import { hashFile } from '../files/file-hash'
import { titleFromFilename } from '../files/metadata-filename'

export interface MetadataExtras {
  title?: string
  authorNames?: string[]
  coverPath?: string
}

/**
 * Build domain ImportResult for a sandboxed file (hash + format + title fallback).
 * Used by T2.9 stub importers and as the final step after EPUB OPF extract.
 */
export async function buildImportResult(
  filePath: string,
  format: DocumentFormat,
  extras: MetadataExtras = {},
): Promise<ImportResult> {
  const { sha256, fileSizeBytes } = await hashFile(filePath)
  const title = extras.title?.trim() || titleFromFilename(filePath)
  const authorNames = extras.authorNames
    ?.map((n) => n.trim())
    .filter((n) => n.length > 0)

  const result: ImportResult = {
    title,
    format,
    filePath,
    sha256,
    fileSizeBytes,
  }

  if (authorNames && authorNames.length > 0) {
    result.authorNames = authorNames
  }
  if (extras.coverPath) {
    result.coverPath = extras.coverPath
  }

  return result
}

/** Filename-only DocumentImporter stub (T2.9); deeper metadata / render → G6. */
export function createFilenameFallbackImporter(format: DocumentFormat): DocumentImporter {
  return {
    canHandle(filePath: string): boolean {
      const ext = path.extname(path.basename(filePath)).toLowerCase()
      return resolveFormatFromExtension(ext) === format
    },
    async import(filePath: string): Promise<ImportResult> {
      return buildImportResult(filePath, format)
    },
  }
}
