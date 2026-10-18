/**
 * Readmate annotations → standard PDF annotations, for writing into a PDF (export, phase 2; write-back,
 * phase 3). Pure: Main's writer (`electron/pdf-sync/pdf-incremental-writer.ts`) turns the plan into
 * PDF objects. See docs/implementation_plan/pdf_annotation_export.md.
 *
 * Coordinates stay normalized 0–1 in the displayed page box here (the app's storage space); only the
 * writer, which knows each page's viewport, maps them to PDF user space.
 */

import type { PdfAnnotation } from '../domain/index.js'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlight-colors.js'
import type { HighlightStyleKind } from './highlight-location.js'
import {
  embeddedAnnotationIdentities,
  highlightContentHash,
  type EmbeddedAnnotationLedgerEntry,
  type HighlightContent,
  type ScannedPdfAnnotation,
} from './pdf-embedded-annotations.js'

export type PdfWriteSubtype = 'Highlight' | 'Underline' | 'Squiggly' | 'StrikeOut' | 'Text'

/** One annotation to write on one page. */
export type PdfWriteAnnotation = {
  /** `/NM`. */
  nm: string
  subtype: PdfWriteSubtype
  /** 0-based page. */
  pageIndex: number
  /** Normalized 0–1 rects in the displayed page box, all on `pageIndex`, in reading order. */
  rects: { x: number; y: number; width: number; height: number }[]
  /** `/C`, RGB 0–1. */
  color: [number, number, number]
  /** `/CA`, 0–1. */
  opacity: number
  /** `/Contents`. */
  contents?: string
  /** `/T`. */
  author: string
  /** ISO-8601 → `/CreationDate`, `/M`. */
  createdAt: string
  modifiedAt: string
}

/** A `notes` row as the export needs it (a `HighlightRecord` fits). */
export type ExportableHighlight = HighlightContent & {
  id: string
  createdAt: string
  updatedAt: string
}

export const READMATE_NM_PREFIX = 'readmate:'
export const READMATE_PDF_AUTHOR = 'Readmate'

/**
 * `replace` / `insert` have no faithful single-annotation PDF form (Acrobat uses a StrikeOut + Caret
 * group) and are not written: they stay in SQLite only, so a round trip can never flip them into
 * another style.
 */
const SUBTYPE_FOR_STYLE: Partial<Record<HighlightStyleKind, PdfWriteSubtype>> = {
  highlight: 'Highlight',
  underline: 'Underline',
  squiggly: 'Squiggly',
  strikethrough: 'StrikeOut',
  textbox: 'Text',
}

/** Whether a row of this style can be written into a PDF file. */
export function isPdfWritableStyle(styleKind: HighlightStyleKind): boolean {
  return SUBTYPE_FOR_STYLE[styleKind] !== undefined
}

/** `#RRGGBB` / `#RRGGBBAA` → RGB 0–1 + opacity; the default color for anything else. */
export function pdfColorFromHex(colorHex: string): { color: [number, number, number]; opacity: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(colorHex.trim()) ?? /^#([0-9a-f]{6})$/i.exec(DEFAULT_HIGHLIGHT_COLOR)!
  const rgb = m[1]!
  const channel = (i: number) => Math.round((parseInt(rgb.slice(i, i + 2), 16) / 255) * 1000) / 1000
  const opacity = m[2] ? Math.round((parseInt(m[2], 16) / 255) * 1000) / 1000 : 1
  return { color: [channel(0), channel(2), channel(4)], opacity }
}

/** ISO-8601 → PDF date string `D:YYYYMMDDHHmmSSZ` (UTC). Invalid input → the Unix epoch. */
export function pdfDateString(iso: string): string {
  const d = new Date(iso)
  const t = Number.isNaN(d.getTime()) ? new Date(0) : d
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`
}

/** `/NM` of part `pageIndex` of a Readmate row (first page: `readmate:<id>`; others `…:p<page>`). */
export function readmateAnnotationName(noteId: string, pageIndex: number, firstPageIndex: number): string {
  return pageIndex === firstPageIndex ? `${READMATE_NM_PREFIX}${noteId}` : `${READMATE_NM_PREFIX}${noteId}:p${pageIndex + 1}`
}

/** The row id inside a Readmate `/NM`, or undefined for any other name. */
export function noteIdFromReadmateName(nm: string | undefined): string | undefined {
  if (!nm?.startsWith(READMATE_NM_PREFIX)) return undefined
  const rest = nm.slice(READMATE_NM_PREFIX.length)
  const id = rest.replace(/:p\d+$/, '')
  return id || undefined
}

/**
 * One row → its PDF annotations, one per page it touches (a PDF annotation belongs to one page).
 * `firstName` overrides the first part's `/NM` (an imported annotation keeps its own name).
 * Empty for a row without PDF geometry.
 */
export function pdfWriteAnnotationsFromHighlight(row: ExportableHighlight, firstName?: string): PdfWriteAnnotation[] {
  const annotation: PdfAnnotation | undefined = row.pdfAnnotation
  if (!annotation || annotation.rects.length === 0) return []
  const { color, opacity } = pdfColorFromHex(row.colorHex)
  const subtype = SUBTYPE_FOR_STYLE[row.styleKind]
  if (!subtype) return []
  const byPage = new Map<number, PdfWriteAnnotation['rects']>()
  for (const r of annotation.rects) {
    const page = r.pageIndex ?? annotation.pageIndex
    const list = byPage.get(page) ?? []
    list.push({ x: r.x, y: r.y, width: r.width, height: r.height })
    byPage.set(page, list)
  }
  const first = Math.min(...byPage.keys())
  const pages = [...byPage.keys()].sort((a, b) => a - b)
  // A note is one sticky note, at the end of the selection (its last page).
  const notePages = subtype === 'Text' ? [pages[pages.length - 1]!] : pages
  return notePages.map((pageIndex) => {
    const nm = pageIndex === first && firstName ? firstName : readmateAnnotationName(row.id, pageIndex, subtype === 'Text' ? pageIndex : first)
    const write: PdfWriteAnnotation = {
      nm: subtype === 'Text' && firstName ? firstName : nm,
      subtype,
      pageIndex,
      rects: byPage.get(pageIndex)!,
      color,
      opacity: subtype === 'Text' ? 1 : opacity,
      author: READMATE_PDF_AUTHOR,
      createdAt: row.createdAt,
      modifiedAt: row.updatedAt,
    }
    const note = row.note?.trim()
    if (note) write.contents = note
    return write
  })
}

export type PdfAnnotationWritePlan = {
  /** New annotations (new objects). */
  add: PdfWriteAnnotation[]
  /** Existing annotations rewritten in place (same object number). `objectId` = PDF.js id ("12R"). */
  replace: { objectId: string; annotation: PdfWriteAnnotation }[]
  /** Existing annotations removed from their page's `/Annots` (with their `/Popup`). */
  remove: { objectId: string; pageIndex: number }[]
  /** Embedded annotations left as they are (imported and untouched in Readmate). */
  kept: number
  /** Ledger entries this plan writes for, so a caller can update them afterwards. */
  writtenNoteIds: string[]
}

/**
 * What to write so the file holds Readmate's annotations (pdf_annotation_export.md §4). `scanned` is
 * the file's current embedded annotations (with PDF.js ids and `/NM`s); `ledger` links imported
 * annotations to rows; `rows` are the book's PDF annotation rows.
 */
export function planPdfAnnotationWrite(input: {
  scanned: readonly ScannedPdfAnnotation[]
  ledger: ReadonlyMap<string, EmbeddedAnnotationLedgerEntry>
  rows: readonly ExportableHighlight[]
}): PdfAnnotationWritePlan {
  const plan: PdfAnnotationWritePlan = { add: [], replace: [], remove: [], kept: 0, writtenNoteIds: [] }
  const rowsById = new Map(input.rows.filter((r) => r.pdfAnnotation && isPdfWritableStyle(r.styleKind)).map((r) => [r.id, r]))
  const handledRows = new Set<string>()
  const handledItems = new Set<number>()

  const identities = embeddedAnnotationIdentities(input.scanned)
  const byKey = new Map<string, number>()
  const byLegacy = new Map<string, number>()
  identities.forEach(({ key, legacyKey }, i) => {
    byKey.set(key, i)
    if (!byLegacy.has(legacyKey)) byLegacy.set(legacyKey, i)
  })

  const removal = (index: number) => ({ objectId: input.scanned[index]!.objectId, pageIndex: input.scanned[index]!.pageIndex })

  const writeRow = (row: ExportableHighlight, existing: { index: number; nm?: string }[]) => {
    const keepName = existing.length === 1 && !noteIdFromReadmateName(existing[0]!.nm) ? existing[0]!.nm : undefined
    const parts = pdfWriteAnnotationsFromHighlight(row, keepName)
    const free = [...existing]
    for (const part of parts) {
      let match = free.findIndex((e) => e.nm === part.nm)
      if (match < 0) match = free.findIndex((e) => input.scanned[e.index]!.pageIndex === part.pageIndex)
      if (match >= 0) {
        const [e] = free.splice(match, 1)
        plan.replace.push({ objectId: input.scanned[e!.index]!.objectId, annotation: part })
      } else plan.add.push(part)
    }
    for (const e of free) plan.remove.push(removal(e.index))
    for (const e of existing) handledItems.add(e.index)
    handledRows.add(row.id)
    plan.writtenNoteIds.push(row.id)
  }

  // 1. Imported annotations (ledger).
  for (const [key, entry] of input.ledger) {
    const index = byKey.get(key) ?? byLegacy.get(key)
    if (index === undefined || handledItems.has(index)) continue
    const row = rowsById.get(entry.noteId)
    if (!row) {
      plan.remove.push(removal(index)) // deleted in Readmate
      handledItems.add(index)
    } else if (highlightContentHash(row) === entry.noteHash) {
      plan.kept += 1 // untouched: the file's own version stays
      handledItems.add(index)
      handledRows.add(row.id)
    } else {
      writeRow(row, [{ index, nm: input.scanned[index]!.nm }])
    }
  }

  // 2. Annotations a previous Readmate write put in the file (`readmate:<id>` names).
  const readmateItems = new Map<string, { index: number; nm?: string }[]>()
  input.scanned.forEach((item, index) => {
    if (handledItems.has(index)) return
    const id = noteIdFromReadmateName(item.nm)
    if (!id) return
    const list = readmateItems.get(id) ?? []
    list.push({ index, nm: item.nm })
    readmateItems.set(id, list)
  })
  for (const [id, items] of readmateItems) {
    const row = rowsById.get(id)
    if (!row || handledRows.has(id)) {
      for (const e of items) {
        plan.remove.push(removal(e.index))
        handledItems.add(e.index)
      }
      continue
    }
    writeRow(row, items)
  }

  // 3. Rows made in Readmate that the file doesn't hold yet.
  for (const row of rowsById.values()) {
    if (handledRows.has(row.id)) continue
    writeRow(row, [])
  }
  return plan
}
