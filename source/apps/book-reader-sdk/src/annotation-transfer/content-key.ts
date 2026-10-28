/**
 * Content key of an annotation: what makes it "the same annotation" in a book, independent of SQLite ids,
 * colour and times (specs/006-annotation-import-export/data-model.md "Identity and duplicates").
 * type + normalised locator + quote + comment + format geometry (PDF rects rounded to 4 decimals, TXT offsets, Markdown anchor).
 */
import type { TransferAnnotation } from './file-format.js'

const DECIMALS = 4

/** JSON with sorted keys and non-integer numbers rounded, so equal content gives equal text. */
function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(DECIMALS)))
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`)
      .join(',')}}`
  }
  return 'null'
}

type KeyInput = Pick<TransferAnnotation, 'type' | 'locator' | 'selectionText' | 'note' | 'pdfAnnotation' | 'txtAnnotation' | 'mdAnnotation'>

export function contentKeyOf(a: KeyInput): string {
  // `chapterIndex` and a PDF locator's `rect` are derived from the geometry below, so they are left out.
  const loc = a.locator
  const place =
    loc.kind === 'cfi' ? { kind: loc.kind, cfi: loc.cfi } : loc.kind === 'page-rect' ? { kind: loc.kind, page: loc.page } : { kind: loc.kind, offset: loc.offset, blockId: loc.blockId ?? null }
  return stable({
    t: a.type,
    l: place,
    q: a.selectionText?.highlight ?? '',
    n: a.note ?? '',
    p: a.pdfAnnotation ?? null,
    x: a.txtAnnotation ?? null,
    m: a.mdAnnotation ?? null,
  })
}
