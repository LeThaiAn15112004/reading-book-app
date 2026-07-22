import path from 'node:path'

/**
 * Derive a display title from the file basename (SRS: missing metadata → use filename).
 * Strips the last extension only (e.g. `My Book.epub` → `My Book`).
 */
export function titleFromFilename(filePath: string): string {
  const base = path.basename(filePath)
  const ext = path.extname(base)
  const name = ext ? base.slice(0, -ext.length) : base
  const trimmed = name.trim()
  return trimmed || base || 'Untitled'
}

/** Directory that holds a sandboxed book file (`…/books/{uuid}/`). */
export function coverDirForBook(sandboxFilePath: string): string {
  return path.dirname(path.resolve(sandboxFilePath))
}
