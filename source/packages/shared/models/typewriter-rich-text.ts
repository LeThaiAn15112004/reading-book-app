/**
 * Lightweight rich-text helpers for typewriter (`textbox`) annotations.
 * Formatted body is stored as sanitized HTML in `annotations.content`;
 * box-level defaults live in `style_properties` (`colorHex`, `fontSize`, `fontFamily`).
 */

export const TYPEWRITER_DEFAULT_FONT_SIZE = 13
export const TYPEWRITER_DEFAULT_COLOR_HEX = '#f59e0b'

export const TYPEWRITER_FONT_SIZES = [11, 12, 13, 14, 16, 18, 20, 24] as const

export const TYPEWRITER_TEXT_COLORS = [
  '#0f172a',
  '#e2e8f0',
  '#f59e0b',
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
] as const

const ALLOWED_TAGS = new Set([
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'BR',
  'DIV',
  'P',
  'SPAN',
])

const COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function looksLikeHtml(raw: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(raw)
}

/** Normalize `#rgb` / `#rrggbb` for textbox defaults; returns null if invalid. */
export function normalizeTypewriterColorHex(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const value = raw.trim()
  if (!COLOR_RE.test(value)) return null
  const lower = value.toLowerCase()
  if (lower.length === 4) {
    const r = lower[1]
    const g = lower[2]
    const b = lower[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return lower
}

function extractColorFromStyle(style: string): string | null {
  const match = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)
  if (!match) return null
  const value = match[1]?.trim() ?? ''
  if (COLOR_RE.test(value)) return normalizeTypewriterColorHex(value)
  // Allow a few named colors browsers may emit from execCommand.
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
    yellow: '#ffff00',
    orange: '#ffa500',
    purple: '#800080',
  }
  return named[value.toLowerCase()] ?? null
}

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? '')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const el = node as HTMLElement
  const tag = el.tagName.toUpperCase()

  // Convert legacy <font color="..."> from execCommand to <span style="color:...">.
  if (tag === 'FONT') {
    const color =
      normalizeTypewriterColorHex(el.getAttribute('color') ?? undefined) ??
      extractColorFromStyle(el.getAttribute('style') ?? '')
    const span = doc.createElement('span')
    if (color) span.style.color = color
    for (const child of Array.from(el.childNodes)) {
      const kept = sanitizeNode(child, doc)
      if (kept) span.appendChild(kept)
    }
    return span.childNodes.length || color ? span : null
  }

  if (!ALLOWED_TAGS.has(tag)) {
    const frag = doc.createDocumentFragment()
    for (const child of Array.from(el.childNodes)) {
      const kept = sanitizeNode(child, doc)
      if (kept) frag.appendChild(kept)
    }
    return frag.childNodes.length ? frag : null
  }

  const out = doc.createElement(tag === 'STRONG' ? 'b' : tag === 'EM' ? 'i' : tag.toLowerCase())
  if (tag === 'SPAN') {
    const color = extractColorFromStyle(el.getAttribute('style') ?? '')
    if (color) out.style.color = color
  }

  for (const child of Array.from(el.childNodes)) {
    const kept = sanitizeNode(child, doc)
    if (kept) out.appendChild(kept)
  }

  // Drop empty decorative spans.
  if (tag === 'SPAN' && !out.getAttribute('style') && !out.textContent?.trim()) {
    return null
  }

  return out
}

/** Allow only inline formatting tags; strips scripts/styles/attrs. */
export function sanitizeTypewriterHtml(raw: string | undefined | null): string {
  const input = raw ?? ''
  if (!input.trim()) return ''

  if (typeof document === 'undefined') {
    // Main-process / non-DOM fallback: strip clearly dangerous tags only.
    return input
      .replace(/<\/?(script|style|iframe|object|embed|link|meta|img|svg|math)[^>]*>/gi, '')
      .trim()
  }

  const template = document.createElement('template')
  template.innerHTML = input
  const doc = document
  const frag = doc.createDocumentFragment()
  for (const child of Array.from(template.content.childNodes)) {
    const kept = sanitizeNode(child, doc)
    if (kept) frag.appendChild(kept)
  }
  const holder = doc.createElement('div')
  holder.appendChild(frag)
  return holder.innerHTML
}

/**
 * Normalize stored/editor content to sanitized HTML.
 * Legacy plain-text notes are escaped and newlines become `<br>`.
 */
export function normalizeTypewriterContent(raw: string | undefined | null): string {
  const input = raw ?? ''
  if (!input.trim()) return ''
  if (!looksLikeHtml(input)) {
    return escapeHtml(input).replace(/\r\n|\r|\n/g, '<br>')
  }
  return sanitizeTypewriterHtml(input)
}

/** Plain text for empty checks, sidebar previews, and search. */
export function typewriterPlainText(raw: string | undefined | null): string {
  const html = normalizeTypewriterContent(raw)
  if (!html) return ''

  if (typeof document !== 'undefined') {
    const div = document.createElement('div')
    div.innerHTML = html
    return (div.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  }

  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(div|p)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

export function typewriterContentIsEmpty(raw: string | undefined | null): boolean {
  return !typewriterPlainText(raw)
}

/** Serialize a contenteditable element's current HTML for persistence. */
export function serializeTypewriterEditorHtml(el: HTMLElement): string {
  return sanitizeTypewriterHtml(el.innerHTML)
}

export type TypewriterBoxStyle = {
  colorHex?: string
  fontSize?: number
  fontFamily?: string
}

export function clampTypewriterFontSize(size: number | undefined): number {
  if (size == null || !Number.isFinite(size)) return TYPEWRITER_DEFAULT_FONT_SIZE
  const rounded = Math.round(size)
  if ((TYPEWRITER_FONT_SIZES as readonly number[]).includes(rounded)) return rounded
  return Math.min(24, Math.max(11, rounded))
}
