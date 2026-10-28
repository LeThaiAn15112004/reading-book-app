/**
 * TrueType reader + glyph-ID-preserving subsetter + Type0/CIDFontType2 builder for Typewriter notes.
 * specs/005-typewriter-note/ (research D5, contracts §2).
 *
 * Pure bytes in, bytes out: no `fs`, no Node `Buffer`, no zlib — so the Main writer and the renderer
 * (metrics) can share it. Only what the shipped Noto faces need is supported: glyf outlines (incl. composite
 * glyphs), cmap formats 4 and 12, hmtx. CFF/OpenType-CFF, TTC and variable fonts are refused.
 */

import type { EmbeddedFontFaceInfo, FontMetrics } from '@reading-book/book-reader-sdk'

export interface TtfFace {
  readonly bytes: Uint8Array
  readonly unitsPerEm: number
  /** hhea ascender / descender (descender is negative), font units. */
  readonly ascent: number
  readonly descent: number
  readonly capHeight: number
  readonly italicAngle: number
  readonly bbox: readonly [number, number, number, number]
  readonly numGlyphs: number
  /** OS/2 fsType; embedding is allowed when bit 1 (restricted licence) is NOT the only/any restriction. */
  readonly fsType: number
  readonly weightClass: number
  readonly isMonospaced: boolean
  /** Glyph id for a code point, 0 when the face has no glyph. */
  glyphId(codePoint: number): number
  /** Advance width of a glyph id, font units. */
  glyphAdvance(gid: number): number
  /** Advance of a code point in font units, `undefined` when the face has no glyph for it. */
  advance(codePoint: number): number | undefined
  hasGlyph(codePoint: number): boolean
  /** Every mapped code point (ascending). */
  codePoints(): number[]
}

export interface EmbeddedFont {
  /** Objects to write, numbered from `firstObjNum`; `fontRef` is the Type0 font object number. */
  objects: PdfFontObject[]
  fontRef: number
  /** Glyph ids in the subset (always contains 0). */
  glyphIds: number[]
  subsetBytes: number
}

export interface PdfFontObject {
  num: number
  /** Dictionary text WITHOUT `<<`/`>>`-less wrapper: a complete `<< … >>` (a `/Length` is added for streams). */
  dict: string
  stream?: Uint8Array
}

const TAG = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0

function tagString(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 255, (tag >>> 16) & 255, (tag >>> 8) & 255, tag & 255)
}

export function parseTrueType(bytes: Uint8Array): TtfFace {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sfnt = view.getUint32(0)
  if (sfnt === TAG('OTTO')) throw new Error('CFF-flavoured OpenType is not supported')
  if (sfnt === TAG('ttcf')) throw new Error('TrueType collections are not supported')
  if (sfnt !== 0x00010000 && sfnt !== TAG('true')) throw new Error('Not a TrueType font')
  const numTables = view.getUint16(4)
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16
    tables.set(tagString(view.getUint32(p)), { offset: view.getUint32(p + 8), length: view.getUint32(p + 12) })
  }
  const need = (name: string) => {
    const t = tables.get(name)
    if (!t) throw new Error(`Missing ${name} table`)
    return t
  }
  if (tables.has('fvar')) throw new Error('Variable fonts are not supported')

  const head = need('head')
  const unitsPerEm = view.getUint16(head.offset + 18)
  const bbox: [number, number, number, number] = [
    view.getInt16(head.offset + 36),
    view.getInt16(head.offset + 38),
    view.getInt16(head.offset + 40),
    view.getInt16(head.offset + 42),
  ]
  const locaFormat = view.getInt16(head.offset + 50)
  const hhea = need('hhea')
  const ascent = view.getInt16(hhea.offset + 4)
  const descent = view.getInt16(hhea.offset + 6)
  const numberOfHMetrics = view.getUint16(hhea.offset + 34)
  const numGlyphs = view.getUint16(need('maxp').offset + 4)
  const hmtx = need('hmtx')
  const post = tables.get('post')
  const italicAngle = post ? view.getInt32(post.offset + 4) / 65536 : 0
  const isMonospaced = post ? view.getUint32(post.offset + 12) !== 0 : false

  let fsType = 0
  let weightClass = 400
  let capHeight = Math.round(ascent * 0.7)
  const os2 = tables.get('OS/2')
  if (os2) {
    weightClass = view.getUint16(os2.offset + 4)
    fsType = view.getUint16(os2.offset + 8)
    const version = view.getUint16(os2.offset)
    if (version >= 2 && os2.length >= 90) capHeight = view.getInt16(os2.offset + 88) || capHeight
  }

  const cmap = parseCmap(view, need('cmap'))
  const advanceOf = (gid: number): number => {
    if (gid < 0 || gid >= numGlyphs) return 0
    const idx = gid < numberOfHMetrics ? gid : numberOfHMetrics - 1
    return view.getUint16(hmtx.offset + idx * 4)
  }

  return {
    bytes,
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    italicAngle,
    bbox,
    numGlyphs,
    fsType,
    weightClass,
    isMonospaced,
    glyphId: (cp) => cmap.lookup(cp),
    glyphAdvance: advanceOf,
    advance: (cp) => {
      const gid = cmap.lookup(cp)
      return gid === 0 ? undefined : advanceOf(gid)
    },
    hasGlyph: (cp) => cmap.lookup(cp) !== 0,
    codePoints: () => cmap.all(),
    // exposed for the subsetter through a symbol-free side channel
    ...({ _tables: tables, _locaFormat: locaFormat } as object),
  } as TtfFace
}

interface CmapReader {
  lookup(cp: number): number
  all(): number[]
}

function parseCmap(view: DataView, table: { offset: number; length: number }): CmapReader {
  const count = view.getUint16(table.offset + 2)
  let best: { offset: number; format: number; rank: number } | undefined
  for (let i = 0; i < count; i++) {
    const platform = view.getUint16(table.offset + 4 + i * 8)
    const encoding = view.getUint16(table.offset + 6 + i * 8)
    const offset = table.offset + view.getUint32(table.offset + 8 + i * 8)
    const format = view.getUint16(offset)
    let rank = -1
    if (platform === 3 && encoding === 10 && format === 12) rank = 4
    else if (platform === 0 && format === 12) rank = 3
    else if (platform === 3 && encoding === 1 && format === 4) rank = 2
    else if (platform === 0 && format === 4) rank = 1
    if (rank > (best?.rank ?? -1)) best = { offset, format, rank }
  }
  if (!best) throw new Error('No usable Unicode cmap (format 4 or 12)')
  return best.format === 12 ? cmap12(view, best.offset) : cmap4(view, best.offset)
}

function cmap12(view: DataView, o: number): CmapReader {
  const n = view.getUint32(o + 12)
  const groups: Array<[number, number, number]> = []
  for (let i = 0; i < n; i++) {
    const p = o + 16 + i * 12
    groups.push([view.getUint32(p), view.getUint32(p + 4), view.getUint32(p + 8)])
  }
  return {
    lookup(cp) {
      let lo = 0
      let hi = groups.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const [s, e, g] = groups[mid]!
        if (cp < s) hi = mid - 1
        else if (cp > e) lo = mid + 1
        else return g + (cp - s)
      }
      return 0
    },
    all() {
      const out: number[] = []
      for (const [s, e, g] of groups) for (let c = s; c <= e; c++) if (g + (c - s) !== 0) out.push(c)
      return out
    },
  }
}

function cmap4(view: DataView, o: number): CmapReader {
  const segX2 = view.getUint16(o + 6)
  const seg = segX2 / 2
  const endO = o + 14
  const startO = endO + segX2 + 2
  const deltaO = startO + segX2
  const rangeO = deltaO + segX2
  const lookup = (cp: number): number => {
    if (cp > 0xffff) return 0
    for (let i = 0; i < seg; i++) {
      const end = view.getUint16(endO + i * 2)
      if (cp > end) continue
      const start = view.getUint16(startO + i * 2)
      if (cp < start) return 0
      const delta = view.getInt16(deltaO + i * 2)
      const ro = view.getUint16(rangeO + i * 2)
      if (ro === 0) return (cp + delta) & 0xffff
      const g = view.getUint16(rangeO + i * 2 + ro + (cp - start) * 2)
      return g === 0 ? 0 : (g + delta) & 0xffff
    }
    return 0
  }
  return {
    lookup,
    all() {
      const out: number[] = []
      for (let i = 0; i < seg; i++) {
        const end = view.getUint16(endO + i * 2)
        const start = view.getUint16(startO + i * 2)
        for (let c = start; c <= end && c < 0xffff; c++) if (lookup(c) !== 0) out.push(c)
      }
      return out
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Subsetting (glyph ids preserved, so /CIDToGIDMap /Identity stays trivial)

interface Internals {
  _tables: Map<string, { offset: number; length: number }>
  _locaFormat: number
}

function checksum(data: Uint8Array): number {
  let sum = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const whole = data.byteLength & ~3
  for (let i = 0; i < whole; i += 4) sum = (sum + view.getUint32(i)) >>> 0
  if (data.byteLength !== whole) {
    let tail = 0
    for (let i = whole; i < data.byteLength; i++) tail |= data[i]! << (24 - 8 * (i - whole))
    sum = (sum + (tail >>> 0)) >>> 0
  }
  return sum
}

function glyphRanges(face: TtfFace): { loca: number[]; glyfOffset: number } {
  const { _tables: tables, _locaFormat: fmt } = face as unknown as Internals
  const view = new DataView(face.bytes.buffer, face.bytes.byteOffset, face.bytes.byteLength)
  const loca = tables.get('loca')
  const glyf = tables.get('glyf')
  if (!loca || !glyf) throw new Error('Missing loca/glyf (not a TrueType-outline font)')
  const out: number[] = []
  for (let i = 0; i <= face.numGlyphs; i++) {
    out.push(fmt === 0 ? view.getUint16(loca.offset + i * 2) * 2 : view.getUint32(loca.offset + i * 4))
  }
  return { loca: out, glyfOffset: glyf.offset }
}

/** Glyph ids needed to draw `codePoints`, closed over composite-glyph components. Always includes 0. */
export function collectGlyphIds(face: TtfFace, codePoints: Iterable<number>): number[] {
  const { loca, glyfOffset } = glyphRanges(face)
  const view = new DataView(face.bytes.buffer, face.bytes.byteOffset, face.bytes.byteLength)
  const seen = new Set<number>([0])
  const queue: number[] = [0]
  for (const cp of codePoints) {
    const gid = face.glyphId(cp)
    if (gid !== 0 && !seen.has(gid)) {
      seen.add(gid)
      queue.push(gid)
    }
  }
  while (queue.length > 0) {
    const gid = queue.pop()!
    const start = loca[gid]!
    const end = loca[gid + 1]!
    if (end - start < 10) continue
    const base = glyfOffset + start
    if (view.getInt16(base) >= 0) continue
    let p = base + 10
    for (;;) {
      const flags = view.getUint16(p)
      const comp = view.getUint16(p + 2)
      if (!seen.has(comp)) {
        seen.add(comp)
        queue.push(comp)
      }
      p += 4 + (flags & 0x1 ? 4 : 2)
      if (flags & 0x8) p += 2
      else if (flags & 0x40) p += 4
      else if (flags & 0x80) p += 8
      if (!(flags & 0x20)) break
    }
  }
  return [...seen].sort((a, b) => a - b)
}

/** A valid TrueType file that keeps every glyph id but only the outlines of `glyphIds`. */
export function subsetFace(face: TtfFace, glyphIds: readonly number[]): Uint8Array {
  const { _tables: tables } = face as unknown as Internals
  const { loca, glyfOffset } = glyphRanges(face)
  const keep = new Set(glyphIds)
  keep.add(0)

  const pieces: Uint8Array[] = []
  const newLoca = new Uint8Array((face.numGlyphs + 1) * 4)
  const locaView = new DataView(newLoca.buffer)
  let offset = 0
  for (let gid = 0; gid < face.numGlyphs; gid++) {
    locaView.setUint32(gid * 4, offset)
    if (!keep.has(gid)) continue
    const start = loca[gid]!
    const end = loca[gid + 1]!
    if (end <= start) continue
    const len = end - start
    const padded = (len + 3) & ~3
    const piece = new Uint8Array(padded)
    piece.set(face.bytes.subarray(glyfOffset + start, glyfOffset + end))
    pieces.push(piece)
    offset += padded
  }
  locaView.setUint32(face.numGlyphs * 4, offset)
  const glyf = new Uint8Array(offset)
  let w = 0
  for (const piece of pieces) {
    glyf.set(piece, w)
    w += piece.length
  }

  const copy = (name: string): Uint8Array | undefined => {
    const t = tables.get(name)
    return t ? face.bytes.slice(t.offset, t.offset + t.length) : undefined
  }
  const head = copy('head')!
  new DataView(head.buffer).setInt16(50, 1) // long loca
  new DataView(head.buffer).setUint32(8, 0) // checkSumAdjustment, set below

  const out: Array<[string, Uint8Array]> = [['glyf', glyf], ['head', head], ['loca', newLoca]]
  for (const name of ['hhea', 'hmtx', 'maxp', 'cvt ', 'fpgm', 'prep']) {
    const t = copy(name)
    if (t) out.push([name, t])
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1))

  const n = out.length
  let searchRange = 1
  let entrySelector = 0
  while (searchRange * 2 <= n) {
    searchRange *= 2
    entrySelector++
  }
  const headerLen = 12 + n * 16
  let total = headerLen
  for (const [, data] of out) total += (data.length + 3) & ~3
  const file = new Uint8Array(total)
  const fv = new DataView(file.buffer)
  fv.setUint32(0, 0x00010000)
  fv.setUint16(4, n)
  fv.setUint16(6, searchRange * 16)
  fv.setUint16(8, entrySelector)
  fv.setUint16(10, n * 16 - searchRange * 16)
  let dataOffset = headerLen
  let headOffset = 0
  out.forEach(([name, data], i) => {
    const p = 12 + i * 16
    fv.setUint32(p, TAG(name))
    fv.setUint32(p + 4, checksum(data))
    fv.setUint32(p + 8, dataOffset)
    fv.setUint32(p + 12, data.length)
    file.set(data, dataOffset)
    if (name === 'head') headOffset = dataOffset
    dataOffset += (data.length + 3) & ~3
  })
  fv.setUint32(headOffset + 8, (0xb1b0afba - checksum(file)) >>> 0)
  return file
}

// ---------------------------------------------------------------------------------------------------------------
// Type0 / CIDFontType2 objects

/** Deterministic six-letter subset tag from the glyph set + font name. */
export function subsetTag(name: string, glyphIds: readonly number[]): string {
  let h = 2166136261
  const feed = (n: number) => {
    h ^= n & 0xffff
    h = Math.imul(h, 16777619) >>> 0
  }
  for (let i = 0; i < name.length; i++) feed(name.charCodeAt(i))
  for (const g of glyphIds) feed(g)
  let tag = ''
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26))
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0
  }
  return tag
}

function pdfName(s: string): string {
  return '/' + s.replace(/[^A-Za-z0-9_+.-]/g, '')
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0')
}

function utf16Hex(cp: number): string {
  if (cp < 0x10000) return hex4(cp)
  const v = cp - 0x10000
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff))
}

export function buildToUnicode(pairs: ReadonlyArray<readonly [gid: number, codePoint: number]>): string {
  const lines: string[] = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
  ]
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100)
    lines.push(`${chunk.length} beginbfchar`)
    for (const [gid, cp] of chunk) lines.push(`<${hex4(gid)}> <${utf16Hex(cp)}>`)
    lines.push('endbfchar')
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end')
  return lines.join('\n')
}

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255)

/**
 * Objects of one embedded font, numbered `firstObjNum…firstObjNum+4`:
 * +0 Type0, +1 CIDFontType2, +2 FontDescriptor, +3 FontFile2, +4 ToUnicode.
 * `deflate` (optional) compresses the two streams and adds `/Filter /FlateDecode`.
 */
export function buildEmbeddedFont(
  face: TtfFace,
  codePoints: Iterable<number>,
  firstObjNum: number,
  psName: string,
  deflate?: (data: Uint8Array) => Uint8Array,
): EmbeddedFont {
  const cps = [...new Set(codePoints)].filter((cp) => face.hasGlyph(cp)).sort((a, b) => a - b)
  const glyphIds = collectGlyphIds(face, cps)
  const subset = subsetFace(face, glyphIds)
  const tag = subsetTag(psName, glyphIds)
  const baseFont = pdfName(`${tag}+${psName}`)
  const scale = 1000 / face.unitsPerEm
  const k = (v: number) => Math.round(v * scale)

  const [type0, cid, desc, file, toUni] = [0, 1, 2, 3, 4].map((i) => firstObjNum + i) as [number, number, number, number, number]

  const gidToCp = new Map<number, number>()
  for (const cp of cps) {
    const g = face.glyphId(cp)
    if (!gidToCp.has(g)) gidToCp.set(g, cp)
  }
  const pairs = [...gidToCp.entries()].sort((a, b) => a[0] - b[0])
  const widths = glyphIds
    .filter((g) => g !== 0)
    .map((g) => `${g} [${k(face.glyphAdvance(g))}]`)
    .join(' ')

  const flags = (face.isMonospaced ? 1 : 0) | 4 | (face.italicAngle !== 0 ? 64 : 0)
  const stemV = Math.round(50 + ((face.weightClass - 400) / 100) * 40 + 40)
  const [x0, y0, x1, y1] = face.bbox
  const pack = (data: Uint8Array) => (deflate ? deflate(data) : data)
  const filter = deflate ? ' /Filter /FlateDecode' : ''

  const objects: PdfFontObject[] = [
    {
      num: type0,
      dict: `<< /Type /Font /Subtype /Type0 /BaseFont ${baseFont} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`,
    },
    {
      num: cid,
      dict:
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${baseFont} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`,
    },
    {
      num: desc,
      dict:
        `<< /Type /FontDescriptor /FontName ${baseFont} /Flags ${flags} /FontBBox [${k(x0)} ${k(y0)} ${k(x1)} ${k(y1)}] ` +
        `/ItalicAngle ${Math.round(face.italicAngle)} /Ascent ${k(face.ascent)} /Descent ${k(face.descent)} ` +
        `/CapHeight ${k(face.capHeight)} /StemV ${stemV} /FontFile2 ${file} 0 R >>`,
    },
    { num: file, dict: `<< /Length1 ${subset.length}${filter} >>`, stream: pack(subset) },
    { num: toUni, dict: `<<${filter} >>`, stream: pack(latin1(buildToUnicode(pairs.map(([g, c]) => [g, c] as const)))) },
  ]
  return { objects, fontRef: type0, glyphIds, subsetBytes: subset.length }
}

/** `FontMetrics` over parsed faces (Main and renderer build the same metrics from the same files). */
export function ttfFontMetrics(getFace: (face: EmbeddedFontFaceInfo) => TtfFace): FontMetrics {
  return {
    advance: (face, cp) => getFace(face).advance(cp),
    ascent: (face) => getFace(face).ascent,
    descent: (face) => getFace(face).descent,
    unitsPerEm: (face) => getFace(face).unitsPerEm,
  }
}
