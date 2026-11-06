/**
 * Typewriter note → PDF objects (contracts §2): one `/FreeText` annotation whose appearance stream holds the
 * laid-out rich text, drawn with embedded subset fonts (Type0 / CIDFontType2, Identity-H).
 * Pure Node. Used by `pdf-incremental-writer.ts`; the layout and the font metrics are the SAME ones the
 * renderer uses, so the file shows what the app shows.
 */
import {
  checkCoverage,
  layoutTypewriter,
  type EmbeddedFontFaceInfo,
  type PdfWriteAnnotation,
} from '@reading-book/book-reader-sdk'
import { deflateSync } from 'node:zlib'
import { buildEmbeddedFont, type PdfFontObject } from './pdf-font-embed'
import { loadTypewriterFace, typewriterFontMetrics } from './typewriter-font-files'
import type { PageGeometry, RawObjectWrite } from './pdf-incremental-writer'
import { num, refText, textString, type PdfRef } from './pdf-syntax'

export type TypewriterWriteFailure = 'unsupported_characters' | 'font_unavailable' | 'does_not_fit'

export class TypewriterWriteError extends Error {
  constructor(
    readonly code: TypewriterWriteFailure,
    message: string,
    readonly characters?: string[],
    /** `/NM` of the note that failed — set by `buildTypewriterObjects`, so a caller can leave just that note out. */
    public nm?: string,
  ) {
    super(message)
  }
}

type Point = [number, number]

function inverse(m: readonly number[]): (x: number, y: number) => Point {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number]
  const det = a * d - b * c
  if (!det) throw new TypewriterWriteError('does_not_fit', 'degenerate page transform')
  return (X, Y) => [(d * (X - e) - c * (Y - f)) / det, (-b * (X - e) + a * (Y - f)) / det]
}

const binary = (data: Uint8Array) => Buffer.from(data).toString('latin1')

function streamBody(dict: string, data: Uint8Array): string {
  const raw = binary(data)
  return `<< ${dict.replace(/^<<\s*|\s*>>$/g, '')} /Length ${raw.length} >>\nstream\n${raw}\nendstream`
}

function hexGlyphs(gids: number[]): string {
  return `<${gids.map((g) => g.toString(16).padStart(4, '0')).join('')}>`
}

function rgb(hex: string): string {
  const v = (i: number) => num(Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 1000) / 1000)
  return `${v(1)} ${v(3)} ${v(5)}`
}

export interface TypewriterObjects {
  /** The annotation object (its number is `target` when rewriting, else freshly allocated). */
  ref: PdfRef
  objects: RawObjectWrite[]
}

/**
 * Builds the annotation, its appearance stream and the font objects. Throws `TypewriterWriteError`
 * (`unsupported_characters`, `font_unavailable`, `does_not_fit`) — nothing is written then.
 */
export function buildTypewriterObjects(...args: Parameters<typeof build>): TypewriterObjects {
  try {
    return build(...args)
  } catch (err) {
    if (err instanceof TypewriterWriteError) err.nm ??= args[0].nm
    throw err
  }
}

function build(
  annotation: PdfWriteAnnotation,
  page: PageGeometry,
  allocate: () => PdfRef,
  target: PdfRef | null,
  created: string,
  modified: string,
  keep: Record<string, string>,
): TypewriterObjects {
  const tw = annotation.typewriter
  const box = annotation.rects[0]
  if (!tw || !box) throw new TypewriterWriteError('does_not_fit', 'a Typewriter note without text or box')
  const { doc, text } = tw

  const coverage = checkCoverage(text, doc)
  if (!coverage.ok) {
    throw new TypewriterWriteError('unsupported_characters', `No shipped font draws: ${coverage.characters.join(' ')}`, coverage.characters)
  }

  const W = box.width * page.width
  const H = box.height * page.height
  let metrics
  try {
    metrics = typewriterFontMetrics()
  } catch (err) {
    throw new TypewriterWriteError('font_unavailable', err instanceof Error ? err.message : String(err))
  }
  let layout
  try {
    layout = layoutTypewriter(doc, text, W, page.width, metrics)
  } catch (err) {
    throw new TypewriterWriteError('font_unavailable', err instanceof Error ? err.message : String(err))
  }
  if (layout.unsupported.length > 0) {
    throw new TypewriterWriteError('unsupported_characters', 'No shipped font draws some characters', layout.unsupported.map((cp) => String.fromCodePoint(cp)))
  }
  if (layout.height > H + 0.01) throw new TypewriterWriteError('does_not_fit', 'The box is shorter than the text')

  // Code points per face, in the order faces first appear (stable resource names /F0, /F1, …).
  const used = new Map<string, { face: EmbeddedFontFaceInfo; cps: Set<number> }>()
  for (const line of layout.lines) {
    for (const seg of line.segments) {
      let entry = used.get(seg.face.id)
      if (!entry) used.set(seg.face.id, (entry = { face: seg.face, cps: new Set() }))
      for (const ch of seg.text) entry.cps.add(ch.codePointAt(0)!)
    }
  }

  const objects: RawObjectWrite[] = []
  const fontNames = new Map<string, string>()
  const fontRefs: string[] = []
  const faces = new Map<string, ReturnType<typeof loadTypewriterFace>>()
  try {
    for (const [id, { face, cps }] of used) {
      const parsed = loadTypewriterFace(face)
      faces.set(id, parsed)
      const refs = [0, 1, 2, 3, 4].map(() => allocate())
      const embedded = buildEmbeddedFont(parsed, cps, refs[0]!.num, face.psName, (d) => new Uint8Array(deflateSync(d)))
      embedded.objects.forEach((o: PdfFontObject, i) => {
        // allocate() hands out increasing numbers, so refs[i].num === first + i
        objects.push({ num: refs[i]!.num, gen: 0, body: o.stream ? streamBody(o.dict, o.stream) : o.dict })
      })
      const name = `F${fontNames.size}`
      fontNames.set(id, name)
      fontRefs.push(`/${name} ${refText(refs[0]!)}`)
    }
  } catch (err) {
    if (err instanceof TypewriterWriteError) throw err
    throw new TypewriterWriteError('font_unavailable', err instanceof Error ? err.message : String(err))
  }

  // Appearance content in a local y-up space whose origin is the box's bottom-left corner.
  const ops: string[] = []
  for (const line of layout.lines) {
    const y = H - line.baseline
    for (const seg of line.segments) {
      const parsed = faces.get(seg.face.id)!
      const gids = [...seg.text].map((ch) => parsed.glyphId(ch.codePointAt(0)!))
      ops.push('BT', `/${fontNames.get(seg.face.id)} ${num(seg.size)} Tf`, `${rgb(seg.color)} rg`, `${num(seg.x)} ${num(y)} Td`, `${hexGlyphs(gids)} Tj`, 'ET')
      const thick = Math.max(0.3, seg.size * 0.05)
      if (seg.underline) ops.push(`${rgb(seg.color)} rg ${num(seg.x)} ${num(y - seg.size * 0.12 - thick / 2)} ${num(seg.width)} ${num(thick)} re f`)
      if (seg.strike) ops.push(`${rgb(seg.color)} rg ${num(seg.x)} ${num(y + seg.size * 0.3 - thick / 2)} ${num(seg.width)} ${num(thick)} re f`)
    }
  }
  const content = Buffer.from(ops.join('\n'), 'latin1')

  // Local space → user space through the page transform (rotation / crop need no special case).
  const toUser = inverse(page.transform)
  const left = box.x * page.width
  const top = box.y * page.height
  const origin = toUser(left, top + H)
  const dx = toUser(left + 1, top + H)
  const dy = toUser(left, top + H - 1)
  const matrix = [dx[0] - origin[0], dx[1] - origin[1], dy[0] - origin[0], dy[1] - origin[1], origin[0], origin[1]]
  const corners = [toUser(left, top), toUser(left + W, top), toUser(left, top + H), toUser(left + W, top + H)]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]

  const apRef = allocate()
  objects.push({
    num: apRef.num,
    gen: 0,
    body: streamBody(
      `/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 ${num(W)} ${num(H)}] /Matrix [${matrix.map(num).join(' ')}] /Resources << /Font << ${fontRefs.join(' ')} >> >> /Filter /FlateDecode`,
      new Uint8Array(deflateSync(content)),
    ),
  })

  const first = doc.align.find((a) => a.start === 0)?.align
  const q = first === 'center' ? 1 : first === 'right' ? 2 : 0
  const size = doc.base.size * page.width
  const parts = [
    '/Type /Annot /Subtype /FreeText /IT /FreeTextTypewriter',
    `/Rect [${rect.map(num).join(' ')}]`,
    `/Contents ${textString(text)}`,
    `/DA (${rgb(doc.base.color)} rg /Helv ${num(size)} Tf)`,
    `/Q ${q}`,
    '/BS << /W 0 >>',
    '/F 4',
    `/T ${textString(annotation.author)}`,
    `/NM ${textString(annotation.nm)}`,
    `/M ${textString(modified)}`,
    `/CreationDate ${textString(created)}`,
    `/P ${refText(page.ref)}`,
    `/AP << /N ${refText(apRef)} >>`,
  ]
  for (const [key, value] of Object.entries(keep)) parts.push(`/${key} ${value}`)
  const ref = target ?? allocate()
  objects.push({ num: ref.num, gen: 0, body: `<< ${parts.join(' ')} >>` })
  return { ref, objects }
}
