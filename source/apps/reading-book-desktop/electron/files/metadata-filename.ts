import path from 'node:path'

/**
 * Sanitize an arbitrary string (e.g. a cloud catalog entry title) into a safe filename
 * component: strips characters illegal on Windows/macOS/Linux and control characters,
 * collapses whitespace, trims trailing dots/spaces (invalid on Windows), and caps length
 * to avoid ENAMETOOLONG.
 */
export function sanitizeFilename(name: string): string {
  const illegalChars = /[\\/:*?"<>|]/g
  const controlChars = /[\x00-\x1f]/g
  const cleaned = name
    .replace(illegalChars, ' ')
    .replace(controlChars, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 150)
    .trim()
  return cleaned || 'Untitled'
}

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
