/**
 * The readable copy of a book's annotations (specs/006-annotation-import-export, FR-014 / FR-023): a Markdown document of
 * quotes and comments in reading order, for people and other tools. It is not importable. Pure; layout in
 * contracts/readable-markdown.md. Its words follow the interface language (`lang`, spec 012 FR-012); English by default.
 */
import { HIGHLIGHT_COLOR_PRESETS } from '../app-models/highlight-colors.js'
import { formatAttachmentSize } from '../attachments/pdf-attachment-annotation.js'
import { formatBytes } from '../i18n/format.js'
import { translate, type AnyMessageKey, type MessageKey } from '../i18n/translate.js'
import type { Params, UiLanguage } from '../i18n/types.js'
import type { ReadableAttachment } from './export-build.js'
import type { AnnotationFile, TransferAnnotation, TransferAnnotationType } from './file-format.js'

/** TXT: annotations are grouped into sections of this many characters (the text has no chapters). */
export const TXT_SECTION_CHARS = 5000

export interface ReadableMarkdownOptions {
  /**
   * Heading of the section an annotation belongs to (EPUB chapter titles come from the caller when it has them).
   * Return undefined to use the default: `Chapter N` (EPUB), `Page N` (PDF), `Section N` (TXT, Markdown).
   */
  headingOf?: (annotation: TransferAnnotation) => string | undefined
  /** Time zone offset (minutes east of UTC) used for the printed times; the machine's own when omitted. */
  utcOffsetMinutes?: number
  /**
   * PDF file attachments (`buildAnnotationFile(...).attachments`), listed under their page as
   * `📎 name (size), page n` after that page's annotations (specs/007-pdf-file-attachment research R14).
   */
  attachments?: readonly ReadableAttachment[]
  /** Language of the document's own words (headings, labels, counts); `en` when omitted. */
  lang?: UiLanguage
}

type T = (key: AnyMessageKey, params?: Params) => string

const KIND_LABEL: Record<TransferAnnotationType, MessageKey> = {
  highlight: 'exports.kinds.highlight',
  underline: 'exports.kinds.underline',
  squiggly: 'exports.kinds.squiggly',
  strikethrough: 'exports.kinds.strikethrough',
  replace: 'exports.kinds.replace',
  insert: 'exports.kinds.insert',
  textbox: 'exports.kinds.textbox',
  rectangle: 'exports.kinds.rectangle',
  ellipse: 'exports.kinds.ellipse',
  line: 'exports.kinds.line',
  arrow: 'exports.kinds.arrow',
  typewriter: 'exports.kinds.typewriter',
}

const COLOUR_KEYS: Readonly<Record<string, MessageKey>> = {
  yellow: 'reader.annotations.colors.yellow',
  blue: 'reader.annotations.colors.blue',
  green: 'reader.annotations.colors.green',
  pink: 'reader.annotations.colors.pink',
  purple: 'reader.annotations.colors.purple',
}

const SHAPES: readonly TransferAnnotationType[] = ['rectangle', 'ellipse', 'line', 'arrow']

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD HH:mm` of an ISO time, in the requested offset (or the machine's local time). */
function formatDateTime(iso: string, utcOffsetMinutes?: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  if (utcOffsetMinutes === undefined) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const s = new Date(d.getTime() + utcOffsetMinutes * 60_000)
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`
}

function formatDate(iso: string, utcOffsetMinutes?: number): string {
  return formatDateTime(iso, utcOffsetMinutes).slice(0, 10)
}

/** A preset's name when the colour is one of the picker's presets; the hex otherwise (alpha dropped for the lookup). */
function colourName(t: T, colorHex: string): string {
  const hex6 = colorHex.slice(0, 7).toUpperCase()
  const preset = HIGHLIGHT_COLOR_PRESETS.find((p) => p.hex.toUpperCase() === hex6)
  if (!preset) return colorHex
  const key = COLOUR_KEYS[preset.id]
  return key ? t(key) : preset.label
}

function chapterIndexOf(a: TransferAnnotation): number | undefined {
  const index = (a.locator as { chapterIndex?: number }).chapterIndex
  return typeof index === 'number' ? index : undefined
}

function defaultHeading(t: T, file: AnnotationFile, a: TransferAnnotation): string {
  const loc = a.locator
  if (file.book.format === 'pdf' && loc.kind === 'page-rect') return t('exports.headings.page', { n: loc.page })
  if (file.book.format === 'epub') {
    const chapter = chapterIndexOf(a)
    return chapter !== undefined ? t('exports.headings.chapter', { n: chapter + 1 }) : t('exports.headings.annotations')
  }
  if (file.book.format === 'md') {
    const md = a.mdAnnotation as { startSegment?: number } | undefined
    return typeof md?.startSegment === 'number' ? t('exports.headings.section', { n: md.startSegment + 1 }) : t('exports.headings.annotations')
  }
  if (loc.kind === 'text-offset') return t('exports.headings.section', { n: Math.floor(loc.offset / TXT_SECTION_CHARS) + 1 })
  return t('exports.headings.annotations')
}

/** Where the annotation is, for a shape or a mark with no text: "on page 3", "in chapter 7", ... */
function placeText(t: T, file: AnnotationFile, a: TransferAnnotation): string {
  const loc = a.locator
  if (loc.kind === 'page-rect') return t('exports.place.onPage', { n: loc.page })
  if (file.book.format === 'epub') {
    const chapter = chapterIndexOf(a)
    return chapter !== undefined ? t('exports.place.inChapter', { n: chapter + 1 }) : ''
  }
  return ''
}

/** A block quote of text that may span lines; `wrap` decorates each line (strikethrough). */
function blockQuote(text: string, wrap: (line: string) => string = (l) => l): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${wrap(line)}`))
    .join('\n')
}

function renderAnnotation(t: T, file: AnnotationFile, a: TransferAnnotation, utcOffsetMinutes?: number): string {
  const lines: string[] = []
  const quote = a.selectionText?.highlight
  const kind = t(KIND_LABEL[a.type])
  if (a.type === 'typewriter') {
    // The note IS the document: it is the quote, and there is no separate comment.
    lines.push(a.note ? blockQuote(a.note) : `> [${kind}${placeText(t, file, a)}]`)
  } else if (SHAPES.includes(a.type)) {
    lines.push(`> [${kind}${placeText(t, file, a)}]`)
  } else if (quote) {
    lines.push(blockQuote(quote, a.type === 'strikethrough' ? (l) => `~~${l}~~` : undefined))
  } else {
    lines.push(`> [${kind}${placeText(t, file, a)}]`)
  }
  lines.push('')
  lines.push(`**${kind}** · ${colourName(t, a.colorHex)} · ${formatDateTime(a.createdAt, utcOffsetMinutes)}`)
  if (a.type !== 'typewriter' && a.note && a.note.trim() !== '') {
    // Hard line breaks keep a multi-line comment together as one paragraph.
    lines.push(t('exports.note', { text: a.note.replace(/\r\n?/g, '\n').split('\n').join('  \n') }))
  }
  return lines.join('\n')
}

function renderAttachment(t: T, lang: UiLanguage, a: ReadableAttachment): string {
  const size = lang === 'en' ? formatAttachmentSize(a.sizeBytes) : formatBytes(lang, a.sizeBytes)
  return t('exports.attachment', { name: a.name, size, page: a.page })
}

/** The page an annotation is on (PDF), for placing attachments between pages; Infinity elsewhere. */
function pageOf(a: TransferAnnotation): number {
  return a.locator.kind === 'page-rect' ? a.locator.page : Number.POSITIVE_INFINITY
}

export function renderReadableMarkdown(file: AnnotationFile, options: ReadableMarkdownOptions = {}): string {
  const lang = options.lang ?? 'en'
  const t: T = (key, params) => translate(lang, key, params)
  const { book } = file
  const attachments = options.attachments ?? []
  const out: string[] = []
  out.push(`# ${book.title}${book.author ? ` — ${book.author}` : ''}`)
  const n = file.annotations.length
  const m = attachments.length
  out.push(
    t('exports.exported', { date: formatDate(file.exportedAt, options.utcOffsetMinutes) }) +
      t('exports.annotationCount', { count: n }) +
      (m > 0 ? t('exports.attachmentCount', { count: m }) : ''),
  )

  let heading: string | null = null
  const section = (h: string) => {
    if (h === heading) return
    heading = h
    out.push('', `## ${h}`)
  }
  // Attachments of a page follow that page's annotations; both lists are already in page order.
  let next = 0
  const attachmentsBefore = (page: number) => {
    while (next < m && attachments[next]!.page < page) {
      const a = attachments[next++]!
      section(t('exports.headings.page', { n: a.page }))
      out.push('', renderAttachment(t, lang, a))
    }
  }
  for (const a of file.annotations) {
    attachmentsBefore(pageOf(a))
    section(options.headingOf?.(a) ?? defaultHeading(t, file, a))
    out.push('', renderAnnotation(t, file, a, options.utcOffsetMinutes))
  }
  attachmentsBefore(Number.POSITIVE_INFINITY)
  return `${out.join('\n')}\n`
}
