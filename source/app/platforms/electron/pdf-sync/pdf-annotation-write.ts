/**
 * Write Readmate's annotations into a PDF's bytes: scan the source, plan (SDK
 * `planPdfAnnotationWrite`), append one incremental update (`pdf-incremental-writer.ts`), then read
 * the result back with pdf.js and check every written / removed annotation. Used by the export
 * (phase 2, docs/implementation_plan/pdf_annotation_export.md). Runs in the scan worker; pure Node.
 */
import {
  embeddedAnnotationIdentities,
  planPdfAnnotationWrite,
  type EmbeddedAnnotationLedgerEntry,
  type ExportableHighlight,
  type PdfAnnotationWritePlan,
  type ScannedPdfAnnotation,
} from '@reading-book/book-reader-sdk'
import { scanPdfAnnotationBytes, type PdfAnnotationScanResult } from './pdf-annotation-scan'
import { appendAnnotationUpdate, PdfWriteError, type AnnotationUpdate, type PageGeometry } from './pdf-incremental-writer'
import { TypewriterWriteError, type TypewriterWriteFailure } from './typewriter-pdf'

export type PdfAnnotationWriteInput = {
  bytes: Uint8Array
  ledger: EmbeddedAnnotationLedgerEntry[]
  rows: ExportableHighlight[]
}

export type PdfAnnotationWriteSummary = { added: number; replaced: number; removed: number; kept: number }

export type PdfAnnotationWriteOutput = {
  output: Uint8Array
  summary: PdfAnnotationWriteSummary
  /** Typewriter notes left out (cannot be drawn); everything else was written. */
  skipped: TypewriterSkip[]
  plan: PdfAnnotationWritePlan
  /** The output re-scanned (what a sync would read from it next). */
  after: PdfAnnotationScanResult
  /** The source scan (identity keys of its items line up with `before.items`). */
  before: PdfAnnotationScanResult
}

export class PdfVerifyError extends Error {}

/** A Typewriter note left out of an update because it cannot be drawn (see contracts §3); its row stays in the app, untouched. */
export type TypewriterSkip = { nm: string; code: TypewriterWriteFailure; characters?: string[] }

/**
 * `appendAnnotationUpdate`, except that a Typewriter note that cannot be written (unsupported characters, a font that
 * failed, text that does not fit) is left out and reported — it never blocks the other annotations.
 */
function appendTolerant(bytes: Uint8Array, pages: ReadonlyMap<number, PageGeometry>, ops: AnnotationUpdate): { output: Uint8Array; ops: AnnotationUpdate; skipped: TypewriterSkip[] } {
  const skipped: TypewriterSkip[] = []
  let current = ops
  for (let attempt = 0; attempt < 1000; attempt++) {
    try {
      return { output: appendAnnotationUpdate(bytes, pages, current), ops: current, skipped }
    } catch (err) {
      if (!(err instanceof TypewriterWriteError) || !err.nm) throw err
      const nm = err.nm
      skipped.push({ nm, code: err.code, ...(err.characters ? { characters: err.characters } : {}) })
      current = { ...current, add: current.add.filter((a) => a.nm !== nm), replace: current.replace.filter((r) => r.annotation.nm !== nm) }
    }
  }
  throw new PdfWriteError('unsupported_pdf', 'too many notes that cannot be written')
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01

/** `#RRGGBB` read back vs the written RGB 0–1 (PDF.js rounds through bytes: ±1 per channel). */
function sameColor(hex: string, color: readonly number[]): boolean {
  return color.every((c, i) => Math.abs(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) - c * 255) <= 1.01)
}

/** The output must contain exactly what the plan says (names, subtypes, pages, colors), and nothing removed. */
function verify(plan: AnnotationUpdate, before: ScannedPdfAnnotation[], after: PdfAnnotationScanResult): void {
  if (!after.complete) throw new PdfVerifyError('the written file could not be read completely')
  const byName = new Map<string, ScannedPdfAnnotation[]>()
  for (const item of after.items) if (item.nm) byName.set(item.nm, [...(byName.get(item.nm) ?? []), item])
  for (const annotation of [...plan.add, ...plan.replace.map((r) => r.annotation)]) {
    const found = byName.get(annotation.nm) ?? []
    if (found.length !== 1) throw new PdfVerifyError(`${annotation.nm}: expected once, found ${found.length} times`)
    const item = found[0]!
    if (item.subtype !== annotation.subtype || item.pageIndex !== annotation.pageIndex) throw new PdfVerifyError(`${annotation.nm}: wrong subtype or page`)
    if (item.colorHex && !sameColor(item.colorHex, annotation.color)) {
      throw new PdfVerifyError(`${annotation.nm}: wrong color ${item.colorHex}`)
    }
    if (annotation.subtype !== 'Text') {
      const first = annotation.rects[0]!
      const got = item.rects[0]!
      if (!near(first.x, got.x) || !near(first.y, got.y) || !near(first.width, got.width) || !near(first.height, got.height)) {
        throw new PdfVerifyError(`${annotation.nm}: geometry moved`)
      }
    }
  }
  const removed = new Set(plan.remove.map((r) => r.objectId))
  for (const item of after.items) if (removed.has(item.objectId)) throw new PdfVerifyError(`${item.objectId} was not removed`)
  // Nothing else may disappear: every untouched source annotation is still there.
  const touched = new Set([...removed, ...plan.replace.map((r) => r.objectId)])
  const afterIds = new Set(after.items.map((i) => i.objectId))
  for (const item of before) if (!touched.has(item.objectId) && !afterIds.has(item.objectId)) throw new PdfVerifyError(`${item.objectId} disappeared`)
}

export async function writeAnnotationsToPdf(input: PdfAnnotationWriteInput): Promise<PdfAnnotationWriteOutput> {
  const before = await scanPdfAnnotationBytes(input.bytes)
  if (!before.complete) throw new PdfWriteError('unsupported_pdf', 'the source could not be read completely')
  const ledger = new Map(input.ledger.map((e) => [e.sourceKey, e]))
  const plan = planPdfAnnotationWrite({ scanned: before.items, ledger, rows: input.rows })
  const pages = new Map<number, PageGeometry>(before.pages.map((p) => [p.pageIndex, p]))
  const { output, ops, skipped } = appendTolerant(input.bytes, pages, plan)
  const after = await scanPdfAnnotationBytes(output)
  verify(ops, before.items, after)
  return {
    output,
    skipped,
    summary: { added: ops.add.length, replaced: ops.replace.length, removed: ops.remove.length, kept: plan.kept },
    plan,
    after,
    before,
  }
}

export type PdfAnnotationApplyInput = { bytes: Uint8Array; ops: AnnotationUpdate }
export type PdfAnnotationApplyOutput = { output: Uint8Array; after: PdfAnnotationScanResult; skipped: TypewriterSkip[] }

/**
 * Apply already-planned file operations (two-way sync, phase 3): append them as one incremental
 * update and verify the read-back exactly like the export does. The object ids in `ops` must come
 * from a scan of these very bytes (the coordinator checks the SHA-256 before calling).
 */
export async function applyAnnotationOps(input: PdfAnnotationApplyInput): Promise<PdfAnnotationApplyOutput> {
  const before = await scanPdfAnnotationBytes(input.bytes)
  if (!before.complete) throw new PdfWriteError('unsupported_pdf', 'the file could not be read completely')
  const pages = new Map<number, PageGeometry>(before.pages.map((p) => [p.pageIndex, p]))
  const { output, ops, skipped } = appendTolerant(input.bytes, pages, input.ops)
  const after = await scanPdfAnnotationBytes(output)
  verify(ops, before.items, after)
  return { output, after, skipped }
}

/** Identity keys of a scan's items (for ledger bookkeeping after a write). */
export function identityKeys(items: readonly ScannedPdfAnnotation[]): string[] {
  return embeddedAnnotationIdentities(items).map((i) => i.key)
}
