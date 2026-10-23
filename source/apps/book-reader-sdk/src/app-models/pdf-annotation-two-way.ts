/**
 * Two-way reconciliation of a PDF's embedded annotations with Readmate's rows (phase 3,
 * docs/implementation_plan/pdf_annotation_two_way_sync.md). Pure: Main's sync coordinator scans the
 * file, calls `planTwoWaySync`, writes the file (phase 2 writer) and applies the rest in SQLite.
 *
 * Every linked pair keeps a base snapshot of both sides at the last successful sync. Each field
 * (kind, color, text, geometry) is compared with its own side's base: a change on one side flows
 * to the other, changes to different fields merge, the same field changed differently on both
 * sides is a conflict (neither side overwritten). Timestamps are never used.
 */

import type { HighlightStyleKind } from './highlight-location.js'
import { DEFAULT_HIGHLIGHT_COLOR } from './highlight-colors.js'
import { isShapeStyleKind, shapeColorHex } from './pdf-shape.js'
import {
  embeddedStyleOf,
  embeddedAnnotationIdentities,
  embeddedAnnotationSourceHash,
  highlightContentHash,
  type EmbeddedAnnotationLedgerEntry,
  type ScannedPdfAnnotation,
} from './pdf-embedded-annotations.js'
import {
  noteIdFromReadmateName,
  isPdfWritableStyle,
  pdfWriteAnnotationsFromHighlight,
  type ExportableHighlight,
  type PdfWriteAnnotation,
} from './pdf-annotation-export.js'

export type SyncField = 'kind' | 'color' | 'text' | 'geometry'
const FIELDS: SyncField[] = ['kind', 'color', 'text', 'geometry']

/** One side's comparable state (geometry as a rounded signature; '' for notes — never synced). */
export type SyncSide = { kind: HighlightStyleKind; color: string; text: string; geometry: string }
export type SyncBase = { file: SyncSide; app: SyncSide }

export type SyncConflict = {
  kind: 'both-changed' | 'removed-in-file'
  /** The file's version when the conflict was detected (absent for `removed-in-file`). */
  item?: ScannedPdfAnnotation
  fields?: SyncField[]
}

export type TwoWayLedgerEntry = EmbeddedAnnotationLedgerEntry & { base?: SyncBase; conflict?: SyncConflict }

function geometrySig(rects: readonly { x: number; y: number; width: number; height: number }[]): string {
  return rects.map((r) => [r.x, r.y, r.width, r.height].map((n) => n.toFixed(3)).join(',')).join(';')
}

const color6 = (hex: string | undefined) => (hex ?? DEFAULT_HIGHLIGHT_COLOR).trim().slice(0, 7).toUpperCase()

/** A shape's colour AND opacity as one comparable string: `#RRGGBB` + the alpha byte (`FF` = opaque). */
const alphaByte = (opacity: number) => Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, '0').toUpperCase()
const shapeColorSig = (hex: string | undefined, opacity: number) => `${color6(hex)}${alphaByte(opacity)}`
function appShapeColorSig(hex: string): string {
  const m = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(hex.trim())
  return `${color6(hex)}${m ? m[1]!.toUpperCase() : 'FF'}`
}

function shapeGeometrySig(
  rects: readonly { x: number; y: number; width: number; height: number }[],
  shape: { strokeWidth: number; line?: readonly number[] } | undefined,
): string {
  return `${geometrySig(rects)}|w${(shape?.strokeWidth ?? 0).toFixed(4)}${shape?.line ? `|l${shape.line.map((n) => n.toFixed(3)).join(',')}` : ''}`
}

export function fileSide(item: ScannedPdfAnnotation): SyncSide {
  if (item.shape) {
    return {
      kind: embeddedStyleOf(item),
      color: shapeColorSig(item.colorHex, item.opacity ?? 1),
      text: item.contents?.trim() ?? '',
      geometry: shapeGeometrySig(item.rects, item.shape),
    }
  }
  return {
    kind: embeddedStyleOf(item),
    color: color6(item.colorHex),
    text: item.contents?.trim() ?? '',
    geometry: item.subtype === 'Text' ? '' : geometrySig(item.rects),
  }
}

/** The row as seen from one file annotation (its rects on that annotation's page only). */
export function appSide(row: ExportableHighlight, pageIndex: number): SyncSide {
  const rects = (row.pdfAnnotation?.rects ?? []).filter((r) => (r.pageIndex ?? row.pdfAnnotation!.pageIndex) === pageIndex)
  if (isShapeStyleKind(row.styleKind)) {
    return {
      kind: row.styleKind,
      color: appShapeColorSig(row.colorHex),
      text: row.note?.trim() ?? '',
      geometry: shapeGeometrySig(rects, row.pdfAnnotation?.shape),
    }
  }
  return {
    kind: row.styleKind,
    color: color6(row.colorHex),
    text: row.note?.trim() ?? '',
    geometry: row.styleKind === 'textbox' ? '' : geometrySig(rects),
  }
}

export function syncBase(item: ScannedPdfAnnotation, row: ExportableHighlight): SyncBase {
  return { file: fileSide(item), app: appSide(row, item.pageIndex) }
}

function changed(base: SyncSide, now: SyncSide): SyncField[] {
  return FIELDS.filter((f) => base[f] !== now[f])
}

/** `row` with the file's values for `fields` (notes never take the file's geometry). */
export function applyFileFields(row: ExportableHighlight, item: ScannedPdfAnnotation, fields: readonly SyncField[]): ExportableHighlight {
  const next: ExportableHighlight = { ...row }
  for (const field of fields) {
    if (field === 'kind') next.styleKind = embeddedStyleOf(item)
    if (field === 'color' && item.shape) next.colorHex = shapeColorHex(item.colorHex ?? DEFAULT_HIGHLIGHT_COLOR, item.opacity ?? 1)
    else if (field === 'color') {
      const alpha = row.colorHex.trim().length === 9 ? row.colorHex.trim().slice(7) : ''
      next.colorHex = `${color6(item.colorHex)}${alpha}`
    }
    if (field === 'text') next.note = item.contents?.trim() || undefined
    if (field === 'geometry' && item.shape && row.pdfAnnotation) {
      const r = item.rects[0]!
      next.pdfAnnotation = { pageIndex: item.pageIndex, rects: [{ pageIndex: item.pageIndex, x: r.x, y: r.y, width: r.width, height: r.height }], shape: item.shape }
    } else if (field === 'geometry' && next.styleKind !== 'textbox' && item.subtype !== 'Text' && row.pdfAnnotation) {
      const others = row.pdfAnnotation.rects.filter((r) => (r.pageIndex ?? row.pdfAnnotation!.pageIndex) !== item.pageIndex)
      const rects = [...others, ...item.rects.map((r) => ({ pageIndex: item.pageIndex, x: r.x, y: r.y, width: r.width, height: r.height }))].sort(
        (a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0),
      )
      next.pdfAnnotation = { pageIndex: Math.min(...rects.map((r) => r.pageIndex ?? item.pageIndex)), rects }
    }
  }
  return next
}

export type TwoWayPlan = {
  /** New file annotations → new rows. */
  inserts: { key: string; item: ScannedPdfAnnotation }[]
  /** Deleted in Readmate but changed in the file since → the row comes back (key re-pointed). */
  restores: { key: string; item: ScannedPdfAnnotation }[]
  /**
   * Rows to rewrite (file → row changes, merged results). `next` is the full new row; `expectedHash`
   * the row's content hash when planned — the update is skipped if the row changed since.
   */
  rowUpdates: { noteId: string; next: ExportableHighlight; expectedHash: string }[]
  /** Rows whose annotation left the file (complete scans only) and were untouched since. */
  rowDeletes: string[]
  /** Unknown `readmate:<id>` items whose row exists → link (crash recovery / earlier write). */
  links: { key: string; noteId: string; item: ScannedPdfAnnotation }[]
  /** Newly detected conflicts. */
  conflicts: { key: string; noteId: string; conflict: SyncConflict }[]
  /** Conflicts that disappeared (both sides now agree). */
  conflictsCleared: string[]
  /** Pairs to (re)write the base snapshot of (unchanged, or legacy rows without a base). */
  baseRefresh: { key: string; noteId: string; item: ScannedPdfAnnotation }[]
  /** What to write into the file. */
  file: { add: PdfWriteAnnotation[]; replace: { objectId: string; annotation: PdfWriteAnnotation }[]; remove: { objectId: string; pageIndex: number }[] }
  /** Rows whose annotations the file write (re)creates — their ledger entries come from the read-back. */
  writtenRows: { noteId: string; row: ExportableHighlight; oldKeys: string[]; names: string[] }[]
  /** Ledger entries to drop now (gone on both sides, deleted rows). */
  ledgerDrops: string[]
  /** Ledger entries to drop only once the file write succeeded (tombstones removed from the file). */
  ledgerDropsAfterWrite: string[]
  unchanged: number
  frozen: number
}

export type TwoWayInput = {
  items: readonly ScannedPdfAnnotation[]
  /** The scan read every page — required before anything is treated as removed from the file. */
  complete: boolean
  ledger: readonly TwoWayLedgerEntry[]
  rows: readonly ExportableHighlight[]
}

export function planTwoWaySync(input: TwoWayInput): TwoWayPlan {
  const plan: TwoWayPlan = {
    inserts: [],
    restores: [],
    rowUpdates: [],
    rowDeletes: [],
    links: [],
    conflicts: [],
    conflictsCleared: [],
    baseRefresh: [],
    file: { add: [], replace: [], remove: [] },
    writtenRows: [],
    ledgerDrops: [],
    ledgerDropsAfterWrite: [],
    unchanged: 0,
    frozen: 0,
  }
  const rowsById = new Map(input.rows.filter((r) => r.pdfAnnotation && isPdfWritableStyle(r.styleKind)).map((r) => [r.id, r]))
  const identities = embeddedAnnotationIdentities(input.items)

  // Match ledger entries to items: exact key, then the anchor key (pre-/NM rows).
  const itemOf = new Map<string, number>() // ledger key → item index
  const claimed = new Set<number>()
  const byKey = new Map(identities.map((id, i) => [id.key, i]))
  for (const e of input.ledger) {
    const i = byKey.get(e.sourceKey)
    if (i !== undefined && !claimed.has(i)) {
      itemOf.set(e.sourceKey, i)
      claimed.add(i)
    }
  }
  for (const e of input.ledger) {
    if (itemOf.has(e.sourceKey)) continue
    const i = identities.findIndex((id, index) => !claimed.has(index) && id.legacyKey === e.sourceKey)
    if (i >= 0) {
      itemOf.set(e.sourceKey, i)
      claimed.add(i)
    }
  }

  // Per row: its ledger entries (a multi-page row has one per page).
  const entriesOfRow = new Map<string, TwoWayLedgerEntry[]>()
  for (const e of input.ledger) entriesOfRow.set(e.noteId, [...(entriesOfRow.get(e.noteId) ?? []), e])

  const rowsToWrite = new Map<string, ExportableHighlight>()
  const rowNext = new Map<string, ExportableHighlight>()
  const currentRow = (id: string) => rowNext.get(id) ?? rowsById.get(id)

  for (const e of input.ledger) {
    const index = itemOf.get(e.sourceKey)
    const item = index === undefined ? undefined : input.items[index]
    const row = rowsById.get(e.noteId)

    if (e.conflict) {
      // Frozen until resolved — unless both sides now agree.
      if (item && row && FIELDS.every((f) => fileSide(item)[f] === appSide(row, item.pageIndex)[f])) {
        plan.conflictsCleared.push(e.sourceKey)
        plan.baseRefresh.push({ key: e.sourceKey, noteId: e.noteId, item })
      } else plan.frozen += 1
      continue
    }

    if (item && row) {
      let fileChanged: SyncField[]
      let appChanged: SyncField[]
      if (e.base) {
        fileChanged = changed(e.base.file, fileSide(item))
        appChanged = changed(e.base.app, appSide(row, item.pageIndex))
      } else {
        // Legacy row (imported before base snapshots): only whole-side hashes are known.
        fileChanged = embeddedAnnotationSourceHash(item) === e.sourceHash ? [] : [...FIELDS]
        appChanged = highlightContentHash(row) === e.noteHash ? [] : [...FIELDS]
      }
      if (fileChanged.length === 0 && appChanged.length === 0) {
        plan.unchanged += 1
        if (!e.base) plan.baseRefresh.push({ key: e.sourceKey, noteId: e.noteId, item })
        continue
      }
      const overlap = fileChanged.filter((f) => appChanged.includes(f))
      const conflicting = overlap.filter((f) => fileSide(item)[f] !== appSide(row, item.pageIndex)[f])
      if (conflicting.length > 0) {
        plan.conflicts.push({ key: e.sourceKey, noteId: e.noteId, conflict: { kind: 'both-changed', item, fields: conflicting } })
        continue
      }
      const fromFile = fileChanged.filter((f) => !overlap.includes(f))
      const base = currentRow(e.noteId)!
      const next = fromFile.length > 0 ? applyFileFields(base, item, fromFile) : base
      if (fromFile.length > 0) rowNext.set(e.noteId, next)
      const appOnly = appChanged.filter((f) => !overlap.includes(f))
      if (appOnly.length > 0) rowsToWrite.set(e.noteId, next)
      else if (fromFile.length === 0) plan.baseRefresh.push({ key: e.sourceKey, noteId: e.noteId, item }) // converged
      continue
    }

    if (item && !row) {
      // Deleted in Readmate.
      const fileChanged = e.base ? changed(e.base.file, fileSide(item)).length > 0 : embeddedAnnotationSourceHash(item) !== e.sourceHash
      if (fileChanged) plan.restores.push({ key: e.sourceKey, item })
      else {
        plan.file.remove.push({ objectId: item.objectId, pageIndex: item.pageIndex })
        plan.ledgerDropsAfterWrite.push(e.sourceKey)
      }
      continue
    }

    if (!input.complete) continue // an incomplete scan never means "removed from the file"

    if (!item && row) {
      const appChanged = e.base
        ? FIELDS.some((f) => e.base!.app[f] !== appSide(row, pageOfEntry(e, row))[f])
        : highlightContentHash(row) !== e.noteHash
      if (appChanged) {
        plan.conflicts.push({ key: e.sourceKey, noteId: e.noteId, conflict: { kind: 'removed-in-file' } })
        continue
      }
      // Other parts of a multi-page row may still be in the file: drop only this page's rects.
      const siblings = (entriesOfRow.get(e.noteId) ?? []).filter((o) => o !== e && itemOf.has(o.sourceKey))
      if (siblings.length > 0 && row.pdfAnnotation) {
        const page = pageOfEntry(e, row)
        const base = currentRow(e.noteId)!
        const rects = base.pdfAnnotation!.rects.filter((r) => (r.pageIndex ?? base.pdfAnnotation!.pageIndex) !== page)
        if (rects.length > 0) rowNext.set(e.noteId, { ...base, pdfAnnotation: { pageIndex: Math.min(...rects.map((r) => r.pageIndex ?? page)), rects } })
        plan.ledgerDrops.push(e.sourceKey)
      } else if (!plan.rowDeletes.includes(e.noteId)) {
        plan.rowDeletes.push(e.noteId)
        plan.ledgerDrops.push(e.sourceKey)
      } else plan.ledgerDrops.push(e.sourceKey)
      continue
    }

    plan.ledgerDrops.push(e.sourceKey) // gone on both sides
  }

  // Unknown items: link `readmate:<id>` ones whose row exists, import the rest.
  const linkedRows = new Set(input.ledger.map((e) => e.noteId))
  input.items.forEach((item, index) => {
    if (claimed.has(index)) return
    const key = identities[index]!.key
    const noteId = noteIdFromReadmateName(item.nm)
    if (noteId && rowsById.has(noteId)) {
      plan.links.push({ key, noteId, item })
      linkedRows.add(noteId)
      return
    }
    plan.inserts.push({ key, item })
  })

  // Rows made in Readmate that the file doesn't hold → add.
  for (const row of rowsById.values()) if (!linkedRows.has(row.id)) rowsToWrite.set(row.id, row)

  for (const [noteId, row] of rowNext) {
    if (!plan.rowDeletes.includes(noteId)) plan.rowUpdates.push({ noteId, next: row, expectedHash: highlightContentHash(rowsById.get(noteId)!) })
  }

  // File operations, at row granularity: every part of a row is rewritten together.
  for (const [noteId, row] of rowsToWrite) {
    const entries = (entriesOfRow.get(noteId) ?? []).filter((e) => itemOf.has(e.sourceKey) && !e.conflict)
    const existing = entries.map((e) => ({ key: e.sourceKey, item: input.items[itemOf.get(e.sourceKey)!]! }))
    const foreignName = existing.length === 1 && !noteIdFromReadmateName(existing[0]!.item.nm) ? existing[0]!.item.nm : undefined
    const parts = pdfWriteAnnotationsFromHighlight(row, foreignName)
    const free = [...existing]
    for (const part of parts) {
      let match = free.findIndex((e) => e.item.nm === part.nm)
      if (match < 0) match = free.findIndex((e) => e.item.pageIndex === part.pageIndex)
      if (match >= 0) {
        const [e] = free.splice(match, 1)
        plan.file.replace.push({ objectId: e!.item.objectId, annotation: part })
      } else plan.file.add.push(part)
    }
    for (const e of free) plan.file.remove.push({ objectId: e.item.objectId, pageIndex: e.item.pageIndex })
    plan.writtenRows.push({ noteId, row, oldKeys: entries.map((e) => e.sourceKey), names: parts.map((p) => p.nm) })
  }
  return plan
}

/** The page a ledger entry's annotation was on (from its base geometry, else the row's first page). */
function pageOfEntry(entry: TwoWayLedgerEntry, row: ExportableHighlight): number {
  const m = /^(?:nm1|pdf1:[A-Za-z]+):(\d+):/.exec(entry.sourceKey)
  if (m) return Number(m[1])
  return row.pdfAnnotation?.pageIndex ?? 0
}

export function hasFileWrites(plan: TwoWayPlan): boolean {
  return plan.file.add.length + plan.file.replace.length + plan.file.remove.length > 0
}
