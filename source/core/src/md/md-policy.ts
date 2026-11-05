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
 * Comparison key for anchors written by tools whose rules differ from GitHub's: Latin diacritics
 * are dropped (`ổ` → `o`, `đ` → `d`; other scripts keep their marks, so Japanese `が` stays distinct
 * from `か`), the text is lower-cased and everything that is not a letter or a digit is removed
 * (so `6.3 … (31–60)` and `63-…-31-60` meet).
 */
export function looseAnchorKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .replace(/[đĐ]/gu, 'd')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '')
}

/**
 * Index of the heading an in-document link `#id` points to, given every heading's text in document
 * order; -1 when nothing matches. Two passes, strictest first:
 *  1. GitHub's slug (`slugifyHeading`; repeated headings get `-1`, `-2` …) — what GitHub, VS Code
 *     and most renderers write;
 *  2. `looseAnchorKey`, for documents whose anchors were generated by another tool (ASCII slugs of
 *     Vietnamese headings, punctuation turned into hyphens…). Repeats are numbered the same way.
 */
export function findHeadingForAnchor(headingTexts: readonly string[], anchor: string): number {
  let wanted = anchor
  try {
    wanted = decodeURIComponent(anchor)
  } catch {
    // keep the raw anchor
  }
  const exact = wanted.toLowerCase()
  const loose = looseAnchorKey(wanted)
  if (!exact || !loose) return -1

  const seen = new Map<string, number>()
  for (let i = 0; i < headingTexts.length; i += 1) {
    const base = slugifyHeading(headingTexts[i]!)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    if ((count === 0 ? base : `${base}-${count}`) === exact) return i
  }

  const seenLoose = new Map<string, number>()
  for (let i = 0; i < headingTexts.length; i += 1) {
    const base = looseAnchorKey(headingTexts[i]!)
    if (!base) continue
    const count = seenLoose.get(base) ?? 0
    seenLoose.set(base, count + 1)
    if ((count === 0 ? base : `${base}${count}`) === loose) return i
  }
  return -1
}

/** Documents up to this many characters are rendered as ONE piece (exactly as written). */
export const MD_SEGMENT_MIN_DOCUMENT_CHARS = 60_000
/** Target size of a piece when a long document is split (docs/implementation_plan/markdown_reader.md §4). */
export const MD_SEGMENT_TARGET_CHARS = 40_000

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const PARAGRAPH_START = /^[\p{L}"'“‘(]/u
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S/

/**
 * Split a long document into pieces that can be parsed and mounted one at a time (parsing time
 * grows faster than linearly with size, so one 5 MB parse would freeze the window). Cuts happen
 * ONLY where the Markdown meaning of both sides is unchanged: after a blank line, outside a fenced
 * code block, before an ATX heading or a plain paragraph start at column 0 (never inside a list,
 * quote, table, indented code or HTML block). `pieces.join('') === text`. A document that is short,
 * or has no safe cut, stays whole.
 */
export function splitMdSource(
  text: string,
  targetChars: number = MD_SEGMENT_TARGET_CHARS,
  minDocumentChars: number = MD_SEGMENT_MIN_DOCUMENT_CHARS,
): string[] {
  if (text.length <= minDocumentChars) return [text]
  const pieces: string[] = []
  let pieceStart = 0
  let fence: { char: string; length: number } | null = null
  let previousBlank = false
  let pos = 0
  while (pos < text.length) {
    const newline = text.indexOf('\n', pos)
    const end = newline === -1 ? text.length : newline + 1
    const line = text.slice(pos, newline === -1 ? text.length : newline)
    const blank = line.trim() === ''

    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null
    } else {
      if (
        previousBlank &&
        !blank &&
        pos - pieceStart >= targetChars &&
        (ATX_HEADING.test(line) || PARAGRAPH_START.test(line))
      ) {
        pieces.push(text.slice(pieceStart, pos))
        pieceStart = pos
      }
      const open = FENCE_OPEN.exec(line)
      if (open) fence = { char: open[1]![0]!, length: open[1]!.length }
    }
    previousBlank = blank
    pos = end
  }
  pieces.push(text.slice(pieceStart))
  return pieces
}

/**
 * Link reference definitions (`[id]: url`) of the whole document. Each piece gets them appended so
 * `[text][id]` keeps working when the definition sits in another piece. Bounded.
 */
export function collectMdReferenceDefinitions(text: string, maxLines = 300): string {
  const found: string[] = []
  for (const line of text.split('\n')) {
    if (REFERENCE_DEFINITION.test(line)) {
      found.push(line.slice(0, 2000))
      if (found.length >= maxLines) break
    }
  }
  return found.join('\n')
}

export type MdHeadingInfo = { level: number; text: string }

export type MdOutlineNode = {
  /** Position of the heading among ALL headings of the document, in reading order. */
  index: number
  label: string
  /** Nesting depth (0 = top), not the raw `#` count: a skipped level does not leave a gap. */
  level: number
  children: MdOutlineNode[]
}

export const MD_OUTLINE_LABEL_MAX_CHARS = 200

/**
 * Nested outline (table of contents) from the headings of a rendered document. Headings with no
 * text are left out of the outline but still count in `index`, so `index` always addresses the
 * N-th heading element of the page.
 */
export function buildMdOutline(headings: readonly MdHeadingInfo[]): MdOutlineNode[] {
  const roots: MdOutlineNode[] = []
  const stack: { level: number; node: MdOutlineNode }[] = []
  headings.forEach((heading, index) => {
    const label = heading.text.replace(/\s+/g, ' ').trim().slice(0, MD_OUTLINE_LABEL_MAX_CHARS)
    if (!label) return
    const rank = Math.min(6, Math.max(1, Math.trunc(heading.level) || 1))
    while (stack.length > 0 && stack[stack.length - 1]!.level >= rank) stack.pop()
    const parent = stack[stack.length - 1]?.node
    const node: MdOutlineNode = { index, label, level: parent ? parent.level + 1 : 0, children: [] }
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push({ level: rank, node })
  })
  return roots
}
