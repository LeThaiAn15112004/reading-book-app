/**
 * Deterministic Typewriter layout shared by the editor, the Notes preview and the PDF writer
 * (research D3). Wrap at spaces, over-long words break between characters, kerning/ligatures off,
 * line height = 1.2 × the tallest font size on the line, justify stretches the spaces of every line
 * except the last of a paragraph.
 *
 * Units: `boxWidth` and `pageWidth` share one unit (points for the writer, CSS px for the editor);
 * font sizes are fractions of `pageWidth`, so every output length is in that same unit.
 */

import { alignAt, effectiveStyle, type PdfTypewriterDoc, type TypewriterAlign } from './typewriter-doc.js'
import { faceFor, TYPEWRITER_DEFAULT_FAMILY, type EmbeddedFontFaceInfo } from './typewriter-fonts.js'

export const TYPEWRITER_LINE_HEIGHT = 1.2

export interface FontMetrics {
  /** Advance in font units, `undefined` when the face has no glyph for the code point. */
  advance(face: EmbeddedFontFaceInfo, codePoint: number): number | undefined
  /** Ascent (positive) / descent (positive magnitude) in font units. */
  ascent(face: EmbeddedFontFaceInfo): number
  descent(face: EmbeddedFontFaceInfo): number
  unitsPerEm(face: EmbeddedFontFaceInfo): number
}

export interface LaidOutSegment {
  /** UTF-16 range in the note text. */
  start: number
  end: number
  text: string
  face: EmbeddedFontFaceInfo
  /** True when the default family's face was used because the chosen one lacks a glyph. */
  fallback: boolean
  size: number
  color: string
  underline: boolean
  strike: boolean
  x: number
  width: number
}

export interface LaidOutLine {
  start: number
  end: number
  top: number
  height: number
  baseline: number
  /** Width of the visible content (trailing spaces excluded). */
  width: number
  align: TypewriterAlign
  /** True when the spaces were stretched; segments are then one word each and spaces are gaps. */
  justified: boolean
  segments: LaidOutSegment[]
}

export interface TypewriterLayout {
  lines: LaidOutLine[]
  height: number
  /** Code points no shipped face draws (drawn with an advance of half an em, no glyph). */
  unsupported: number[]
}

interface Cell {
  cp: number
  start: number
  end: number
  face: EmbeddedFontFaceInfo
  fallback: boolean
  size: number
  color: string
  underline: boolean
  strike: boolean
  width: number
  space: boolean
  mark: boolean
}

const isMark = (cp: number) => cp >= 0x300 && cp <= 0x36f

export function layoutTypewriter(
  doc: PdfTypewriterDoc,
  text: string,
  boxWidth: number,
  pageWidth: number,
  metrics: FontMetrics,
): TypewriterLayout {
  const unsupported = new Set<number>()
  const cells: Cell[] = []
  let runIdx = 0
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!
    const len = cp > 0xffff ? 2 : 1
    if (cp !== 0x0a) {
      while (runIdx < doc.runs.length && doc.runs[runIdx]!.end <= i) runIdx++
      const run = doc.runs[runIdx]
      const style = run && run.start <= i ? { ...doc.base, ...run.style } : doc.base
      const size = style.size * pageWidth
      let face = faceFor(style.family, style.bold, style.italic)
      let fallback = false
      let adv = metrics.advance(face, cp)
      if (adv === undefined && style.family !== TYPEWRITER_DEFAULT_FAMILY) {
        const alt = faceFor(TYPEWRITER_DEFAULT_FAMILY, style.bold, style.italic)
        adv = metrics.advance(alt, cp)
        if (adv !== undefined) {
          face = alt
          fallback = true
        }
      }
      let width: number
      if (adv === undefined) {
        unsupported.add(cp)
        width = size * 0.5
      } else {
        width = (adv / metrics.unitsPerEm(face)) * size
      }
      cells.push({
        cp,
        start: i,
        end: i + len,
        face,
        fallback,
        size,
        color: style.color,
        underline: style.underline,
        strike: style.strike,
        width,
        space: cp === 0x20,
        mark: isMark(cp),
      })
    }
    i += len
  }

  const lines: LaidOutLine[] = []
  let top = 0
  let cellIdx = 0
  let pStart = 0
  for (;;) {
    const nl = text.indexOf('\n', pStart)
    const pEnd = nl === -1 ? text.length : nl
    const pCells: Cell[] = []
    while (cellIdx < cells.length && cells[cellIdx]!.start < pEnd) pCells.push(cells[cellIdx++]!)
    const align = alignAt(doc, text, pStart)
    const ranges = breakParagraph(pCells, boxWidth)
    if (ranges.length === 0) ranges.push({ from: 0, to: 0, contentTo: 0 })
    ranges.forEach((r, n) => {
      const slice = pCells.slice(r.from, r.contentTo)
      const last = n === ranges.length - 1
      const line = buildLine(slice, align, !last, boxWidth, top, pStart, doc, metrics, pageWidth, text)
      line.start = slice.length > 0 ? slice[0]!.start : pStart
      line.end = slice.length > 0 ? slice[slice.length - 1]!.end : pStart
      lines.push(line)
      top += line.height
    })
    if (nl === -1) break
    pStart = nl + 1
  }
  return { lines, height: top, unsupported: [...unsupported] }
}

interface Range {
  from: number
  to: number
  contentTo: number
}

/** Greedy line breaking over the cells of one paragraph. `to` includes hanging spaces, `contentTo` does not. */
function breakParagraph(cells: Cell[], boxWidth: number): Range[] {
  const out: Range[] = []
  let from = 0
  let contentW = 0
  let trailing = 0
  let contentTo = 0
  let sawWord = false
  const eps = 1e-6
  const flush = (to: number) => {
    out.push({ from, to, contentTo: Math.max(contentTo, from) })
    from = to
    contentW = 0
    trailing = 0
    contentTo = to
    sawWord = false
  }
  let i = 0
  while (i < cells.length) {
    const c = cells[i]!
    if (c.space) {
      if (sawWord) trailing += c.width
      else {
        contentW += c.width
        contentTo = i + 1
      }
      i++
      continue
    }
    let j = i
    let ww = 0
    while (j < cells.length && !cells[j]!.space) ww += cells[j++]!.width
    if (sawWord && contentW + trailing + ww > boxWidth + eps) flush(i)
    if (contentW + trailing + ww <= boxWidth + eps) {
      contentW += trailing + ww
      trailing = 0
      contentTo = j
      sawWord = true
      i = j
      continue
    }
    // Word wider than the room on an empty line: break between characters (marks stay with their base).
    let k = i
    while (k < j) {
      let u = k + 1
      let uw = cells[k]!.width
      while (u < j && cells[u]!.mark) uw += cells[u++]!.width
      if (contentW + uw > boxWidth + eps && sawWord) flush(k)
      contentW += uw
      contentTo = u
      sawWord = true
      k = u
    }
    i = j
  }
  if (from < cells.length || out.length === 0) flush(cells.length)
  return out
}

function buildLine(
  cells: Cell[],
  align: TypewriterAlign,
  notLast: boolean,
  boxWidth: number,
  top: number,
  pStart: number,
  doc: PdfTypewriterDoc,
  metrics: FontMetrics,
  pageWidth: number,
  text: string,
): LaidOutLine {
  let width = 0
  for (const c of cells) width += c.width

  let maxSize = 0
  let ascent = 0
  let descent = 0
  for (const c of cells) {
    maxSize = Math.max(maxSize, c.size)
    const upm = metrics.unitsPerEm(c.face)
    ascent = Math.max(ascent, (metrics.ascent(c.face) / upm) * c.size)
    descent = Math.max(descent, (Math.abs(metrics.descent(c.face)) / upm) * c.size)
  }
  if (cells.length === 0) {
    const st = effectiveStyle(doc, Math.min(pStart, Math.max(0, text.length - 1)))
    const f = faceFor(st.family, st.bold, st.italic)
    maxSize = st.size * pageWidth
    const upm = metrics.unitsPerEm(f)
    ascent = (metrics.ascent(f) / upm) * maxSize
    descent = (Math.abs(metrics.descent(f)) / upm) * maxSize
  }
  const height = maxSize * TYPEWRITER_LINE_HEIGHT
  const baseline = top + (height - (ascent + descent)) / 2 + ascent

  let firstWord = cells.findIndex((c) => !c.space)
  if (firstWord === -1) firstWord = cells.length
  let gaps = 0
  for (let i = firstWord; i < cells.length; i++) if (cells[i]!.space) gaps++
  const justified = align === 'justify' && notLast && gaps > 0 && width < boxWidth

  const segments: LaidOutSegment[] = []
  const key = (c: Cell) => `${c.face.id}|${c.size}|${c.color}|${c.underline}|${c.strike}`
  const extra = justified ? (boxWidth - width) / gaps : 0
  let x = justified || align === 'left' || align === 'justify' ? 0 : align === 'center' ? (boxWidth - width) / 2 : boxWidth - width
  let cur: LaidOutSegment | undefined
  let curKey = ''
  cells.forEach((c, i) => {
    if (justified && c.space && i >= firstWord) {
      cur = undefined
      x += c.width + extra
      return
    }
    const k = key(c)
    if (!cur || k !== curKey) {
      cur = {
        start: c.start,
        end: c.end,
        text: '',
        face: c.face,
        fallback: c.fallback,
        size: c.size,
        color: c.color,
        underline: c.underline,
        strike: c.strike,
        x,
        width: 0,
      }
      curKey = k
      segments.push(cur)
    }
    cur.end = c.end
    cur.width += c.width
    cur.text += String.fromCodePoint(c.cp)
    x += c.width
  })
  return { start: 0, end: 0, top, height, baseline, width, align, justified, segments }
}
