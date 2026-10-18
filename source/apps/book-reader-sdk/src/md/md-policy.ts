/**
 * Markdown reader policies — pure decisions the Main process and the renderer both apply, so they
 * cannot drift apart. Read-only reader: the .md file is never written (docs/implementation_plan/
 * markdown_reader.md). Nothing here parses Markdown; that stays in the renderer (react-markdown).
 */

/** Largest .md file the reader opens. Checked in Main before the bytes cross IPC. */
export const MD_MAX_FILE_BYTES = 5 * 1024 * 1024
/** Largest single image the asset protocol serves. */
export const MD_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export type MdSizeVerdict = { ok: true } | { ok: false; reason: 'too_large' }

export function checkMdFileSize(byteLength: number): MdSizeVerdict {
  return byteLength > MD_MAX_FILE_BYTES ? { ok: false, reason: 'too_large' } : { ok: true }
}

export function describeMdTooLarge(): string {
  const mb = MD_MAX_FILE_BYTES / (1024 * 1024)
  return `This Markdown file is larger than ${mb} MB, so Readmate does not open it.`
}

export type MdLinkKind =
  /** `#heading` — scroll inside the document. */
  | { kind: 'anchor'; id: string }
  /** http(s) / mailto — handed to the OS through Main, never navigated to in the app window. */
  | { kind: 'external'; url: string }
  /** Anything else (javascript:, file:, data:, relative paths, …): rendered as plain text. */
  | { kind: 'blocked' }

export const MD_EXTERNAL_URL_MAX_LENGTH = 2048
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function schemeOf(value: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(value)
  return match ? `${match[1]!.toLowerCase()}:` : null
}

/** True only for a URL Main may pass to the OS: http(s)/mailto, bounded, no control characters. */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MD_EXTERNAL_URL_MAX_LENGTH) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return false
  const scheme = schemeOf(value)
  if (!scheme || !EXTERNAL_SCHEMES.has(scheme)) return false
  if (scheme === 'mailto:') return value.length > 'mailto:'.length
  return /^https?:\/\/[^/?#]+/i.test(value)
}

export function classifyMdLink(href: string | undefined | null): MdLinkKind {
  const value = (href ?? '').trim()
  if (value.startsWith('#')) {
    return value.length > 1 ? { kind: 'anchor', id: value.slice(1) } : { kind: 'blocked' }
  }
  return isSafeExternalUrl(value) ? { kind: 'external', url: value } : { kind: 'blocked' }
}

export const MD_IMAGE_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
]

export type MdImageRef =
  /** `path` uses `/`, has no `.`/`..`/empty segments and an allowed image extension. */
  | { kind: 'relative'; path: string }
  | { kind: 'blocked'; reason: 'remote' | 'absolute' | 'traversal' | 'unsupported' | 'invalid' }

/**
 * Lexical check of an image `src` from a Markdown file. Only a relative path inside the document's
 * own folder is ever resolved (by Main, which also checks the real path). Remote URLs, `file:`,
 * `data:`, absolute and drive-letter paths and `..` are all refused.
 */
export function classifyMdImageSrc(src: string | undefined | null): MdImageRef {
  let value = (src ?? '').trim()
  if (!value) return { kind: 'blocked', reason: 'invalid' }
  if (value.startsWith('//')) return { kind: 'blocked', reason: 'remote' }
  const scheme = schemeOf(value)
  // `C:\x` / `C:/x` look like a scheme; a single letter is a drive.
  if (scheme && scheme.length > 2) {
    return {
      kind: 'blocked',
      reason: scheme === 'http:' || scheme === 'https:' || scheme === 'ftp:' ? 'remote' : 'unsupported',
    }
  }
  if (scheme) return { kind: 'blocked', reason: 'absolute' }

  value = value.replace(/[?#].*$/, '')
  try {
    value = decodeURIComponent(value)
  } catch {
    return { kind: 'blocked', reason: 'invalid' }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value) || value.includes(':')) {
    return { kind: 'blocked', reason: 'invalid' }
  }
  value = value.replace(/\\/g, '/')
  if (value.startsWith('/')) return { kind: 'blocked', reason: 'absolute' }

  const segments: string[] = []
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return { kind: 'blocked', reason: 'traversal' }
    segments.push(segment)
  }
  if (segments.length === 0) return { kind: 'blocked', reason: 'invalid' }
  const last = segments[segments.length - 1]!.toLowerCase()
  const dot = last.lastIndexOf('.')
  if (dot < 0 || !MD_IMAGE_EXTENSIONS.includes(last.slice(dot))) {
    return { kind: 'blocked', reason: 'unsupported' }
  }
  return { kind: 'relative', path: segments.join('/') }
}

/** GitHub-style heading slug: lower-case, punctuation dropped, spaces → `-`. Unicode letters stay. */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/gu, '-')
}

/**
 * Index of the heading an in-document link `#id` points to, given every heading's text in document
 * order. Repeated headings get `-1`, `-2` … like GitHub. -1 when nothing matches.
 */
export function findHeadingForAnchor(headingTexts: readonly string[], anchor: string): number {
  let wanted = anchor
  try {
    wanted = decodeURIComponent(anchor)
  } catch {
    // keep the raw anchor
  }
  wanted = wanted.toLowerCase()
  const seen = new Map<string, number>()
  for (let i = 0; i < headingTexts.length; i += 1) {
    const base = slugifyHeading(headingTexts[i]!)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const slug = count === 0 ? base : `${base}-${count}`
    if (slug === wanted) return i
  }
  return -1
}
