/**
 * Typewriter note: pure edit operations over `PdfTypewriterDoc` (style, alignment, text edits).
 * Every function returns a new doc; none validates the 500-run / 200-span limits — callers run
 * `parseTypewriterDoc` before saving (Main re-validates anyway).
 */

import {
  clampTypewriterSize,
  normalizeTypewriterText,
  STYLE_KEYS,
  TYPEWRITER_MAX_CHARS,
  styleEquals,
  type PdfTypewriterDoc,
  type TypewriterAlign,
  type TypewriterAlignSpan,
  type TypewriterStyleKey,
  type TypewriterStyleRun,
  type TypewriterTextStyle,
} from './typewriter-doc.js'

export interface TypewriterRange {
  start: number
  end: number
}

type Override = Partial<TypewriterTextStyle> | undefined

function toPerChar(doc: PdfTypewriterDoc, length: number): Override[] {
  const out: Override[] = new Array<Override>(length).fill(undefined)
  for (const run of doc.runs) for (let i = run.start; i < Math.min(run.end, length); i++) out[i] = { ...run.style }
  return out
}

function fromPerChar(per: readonly Override[], base: TypewriterTextStyle): TypewriterStyleRun[] {
  const runs: TypewriterStyleRun[] = []
  for (let i = 0; i < per.length; i++) {
    const raw = per[i]
    if (!raw) continue
    const style: Partial<TypewriterTextStyle> = {}
    for (const k of STYLE_KEYS) {
      const v = raw[k]
      if (v !== undefined && v !== base[k]) (style as Record<string, unknown>)[k] = v
    }
    if (Object.keys(style).length === 0) continue
    const prev = runs[runs.length - 1]
    if (prev && prev.end === i && styleEquals(prev.style, style)) prev.end = i + 1
    else runs.push({ start: i, end: i + 1, style })
  }
  return runs
}

function cleanPatch(patch: Partial<TypewriterTextStyle>): Partial<TypewriterTextStyle> {
  const out: Partial<TypewriterTextStyle> = {}
  for (const k of STYLE_KEYS) {
    const v = patch[k]
    if (v === undefined) continue
    ;(out as Record<string, unknown>)[k] = k === 'size' ? clampTypewriterSize(v as number) : k === 'color' ? (v as string).toUpperCase() : v
  }
  return out
}

/** Offset of the first character after any surrogate-pair split, so a range never cuts a pair. */
function snap(text: string, offset: number): number {
  if (offset > 0 && offset < text.length) {
    const a = text.charCodeAt(offset - 1)
    const b = text.charCodeAt(offset)
    if (a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff) return offset - 1
  }
  return offset
}

/**
 * `range` → per-character overrides over that range; `null` → whole box: `base` takes the patch and the
 * overrides of the touched keys are cleared everywhere.
 */
export function applyStyle(doc: PdfTypewriterDoc, text: string, range: TypewriterRange | null, patch: Partial<TypewriterTextStyle>): PdfTypewriterDoc {
  const p = cleanPatch(patch)
  const keys = Object.keys(p) as TypewriterStyleKey[]
  if (keys.length === 0) return doc
  if (range === null) {
    const base = { ...doc.base, ...p }
    const per = toPerChar(doc, text.length).map((o) => {
      if (!o) return o
      const copy = { ...o }
      for (const k of keys) delete copy[k]
      return copy
    })
    return { ...doc, base, runs: fromPerChar(per, base) }
  }
  const start = Math.max(0, snap(text, Math.min(range.start, range.end)))
  const end = Math.min(text.length, snap(text, Math.max(range.start, range.end)))
  if (start >= end) return doc
  const per = toPerChar(doc, text.length)
  for (let i = start; i < end; i++) per[i] = { ...(per[i] ?? {}), ...p }
  return { ...doc, runs: fromPerChar(per, doc.base) }
}

/** Value of a boolean style key for every character of the range: `true`, `false` or `'mixed'`. */
export function rangeFlag(doc: PdfTypewriterDoc, text: string, range: TypewriterRange, key: 'bold' | 'italic' | 'underline' | 'strike'): boolean | 'mixed' {
  const per = toPerChar(doc, text.length)
  let seen: boolean | undefined
  for (let i = Math.min(range.start, range.end); i < Math.min(text.length, Math.max(range.start, range.end)); i++) {
    const v = per[i]?.[key] ?? doc.base[key]
    if (seen === undefined) seen = v
    else if (seen !== v) return 'mixed'
  }
  return seen ?? doc.base[key]
}

/** Toggle: if every character already has the flag it is cleared, otherwise it is set on all of them. */
export function toggleStyle(doc: PdfTypewriterDoc, text: string, range: TypewriterRange | null, key: 'bold' | 'italic' | 'underline' | 'strike'): PdfTypewriterDoc {
  const current = range ? rangeFlag(doc, text, range, key) : doc.base[key]
  return applyStyle(doc, text, range, { [key]: current !== true })
}

/** Style typed text takes at a collapsed caret: the style before the caret, overlaid with any pending patch. */
export function typingStyle(doc: PdfTypewriterDoc, text: string, caret: number, pending?: Partial<TypewriterTextStyle>): TypewriterTextStyle {
  const per = toPerChar(doc, text.length)
  const before = caret > 0 ? per[caret - 1] : undefined
  return { ...doc.base, ...(before ?? {}), ...(pending ? cleanPatch(pending) : {}) }
}

/** Alignment of the paragraphs touched by `range` (`null` = every paragraph). */
export function applyAlign(doc: PdfTypewriterDoc, text: string, range: TypewriterRange | null, align: TypewriterAlign): PdfTypewriterDoc {
  const starts: number[] = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) if (i + 1 < text.length) starts.push(i + 1)
  const lo = range ? Math.min(range.start, range.end) : 0
  const hi = range ? Math.max(range.start, range.end) : text.length
  const map = new Map(doc.align.map((s) => [s.start, s.align] as const))
  starts.forEach((s, n) => {
    const e = n + 1 < starts.length ? starts[n + 1]! - 1 : text.length
    const touched = range === null || (lo === hi ? s <= lo && lo <= e : s < hi && e >= lo)
    if (touched) map.set(s, align)
  })
  return { ...doc, align: [...map.entries()].filter(([, a]) => a !== 'left').sort((x, y) => x[0] - y[0]).map(([start, a]) => ({ start, align: a })) }
}

export interface TextChange {
  /** Replace `[start, end)` with `insert`. */
  start: number
  end: number
  insert: string
  /** Style patch pending at the caret (applies to the inserted text only). */
  pending?: Partial<TypewriterTextStyle>
}

export interface EditResult {
  doc: PdfTypewriterDoc
  text: string
  /** True when the insertion was cut to respect the 10 000-character cap. */
  truncated: boolean
}

/** Replace a range of text, mapping runs and paragraph alignment (data-model §2.6). */
export function editText(doc: PdfTypewriterDoc, text: string, change: TextChange): EditResult {
  const start = Math.max(0, Math.min(snap(text, change.start), text.length))
  const end = Math.max(start, Math.min(snap(text, change.end), text.length))
  let insert = normalizeTypewriterText(change.insert)
  const room = TYPEWRITER_MAX_CHARS - (text.length - (end - start))
  let truncated = false
  if (insert.length > room) {
    truncated = true
    insert = insert.slice(0, Math.max(0, room))
    const last = insert.charCodeAt(insert.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) insert = insert.slice(0, -1)
  }

  const per = toPerChar(doc, text.length)
  const inherited: Override = start > 0 ? per[start - 1] : undefined
  const typed: Override = { ...(inherited ?? {}), ...(change.pending ? cleanPatch(change.pending) : {}) }
  const insertedOverride: Override = Object.keys(typed).length > 0 ? typed : undefined
  const nextPer = [...per.slice(0, start), ...new Array<Override>(insert.length).fill(insertedOverride), ...per.slice(end)]
  const nextText = text.slice(0, start) + insert + text.slice(end)

  const delta = insert.length - (end - start)
  const paragraphAlign = (offset: number): TypewriterAlign => {
    const s = offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
    return doc.align.find((a) => a.start === s)?.align ?? 'left'
  }
  const spans = new Map<number, TypewriterAlign>()
  for (const span of doc.align) {
    if (span.start <= start) spans.set(span.start, span.align)
    else if (span.start > end) spans.set(span.start + delta, span.align)
  }
  const inheritedAlign = paragraphAlign(start)
  if (inheritedAlign !== 'left') {
    for (let i = insert.indexOf('\n'); i !== -1; i = insert.indexOf('\n', i + 1)) spans.set(start + i + 1, inheritedAlign)
  }
  const align: TypewriterAlignSpan[] = [...spans.entries()]
    .filter(([s, a]) => a !== 'left' && s < nextText.length && (s === 0 || nextText[s - 1] === '\n'))
    .sort((x, y) => x[0] - y[0])
    .map(([s, a]) => ({ start: s, align: a }))

  return { doc: { ...doc, runs: fromPerChar(nextPer, doc.base), align }, text: nextText, truncated }
}
