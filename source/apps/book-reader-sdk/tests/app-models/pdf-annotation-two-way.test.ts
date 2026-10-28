import { describe, expect, it } from 'vitest'
import { type ExportableHighlight, type PdfWriteAnnotation } from '../../src/app-models/pdf-annotation-export.js'
import { applyAlign, applyStyle, emptyTypewriterDoc } from '../../src/typewriter/index.js'
import {
  applyFileFields,
  fileSide,
  planTwoWaySync,
  syncBase,
  type TwoWayLedgerEntry,
  type TwoWayPlan,
} from '../../src/app-models/pdf-annotation-two-way.js'
import {
  embeddedAnnotationIdentities,
  embeddedAnnotationSourceHash,
  highlightContentHash,
  highlightFromEmbeddedAnnotation,
  type ScannedPdfAnnotation,
} from '../../src/app-models/pdf-embedded-annotations.js'

const R = (pageIndex: number, y: number, x = 0.1) => ({ pageIndex, x, y, width: 0.5, height: 0.02 })

let nextObj = 100
function fileItem(extra: Partial<ScannedPdfAnnotation> = {}): ScannedPdfAnnotation {
  return { objectId: `${nextObj++}R`, subtype: 'Highlight', pageIndex: 0, rects: [R(0, 0.3)], colorHex: '#FFEB3B', ...extra }
}

function appRow(id: string, extra: Partial<ExportableHighlight> = {}): ExportableHighlight {
  return { id, styleKind: 'highlight', colorHex: '#FFEB3B', tags: [], pdfAnnotation: { pageIndex: 0, rects: [R(0, 0.1)] }, createdAt: 'c', updatedAt: 'u', ...extra }
}

const hex = (c: readonly number[]) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** What a reader would scan back from a written annotation. */
function scannedFromWrite(a: PdfWriteAnnotation, objectId: string): ScannedPdfAnnotation {
  const item: ScannedPdfAnnotation = {
    objectId,
    subtype: a.subtype as ScannedPdfAnnotation['subtype'],
    pageIndex: a.pageIndex,
    rects: a.subtype === 'Text' ? [{ pageIndex: a.pageIndex, x: 0.6, y: 0.1, width: 0.03, height: 0.03 }] : a.rects.map((r) => ({ pageIndex: a.pageIndex, ...r })),
    colorHex: hex(a.color),
    nm: a.nm,
  }
  if (a.contents) item.contents = a.contents
  return item
}

/**
 * A model of the coordinator: the file (scanned items), the ledger and the rows. `cycle()` plans,
 * "writes" the file, and applies the plan exactly as Main does.
 */
function world() {
  let file: ScannedPdfAnnotation[] = []
  const ledger = new Map<string, TwoWayLedgerEntry>()
  const rows = new Map<string, ExportableHighlight>()
  let newRow = 1
  const setEntry = (key: string, noteId: string, item: ScannedPdfAnnotation, row: ExportableHighlight) =>
    ledger.set(key, { sourceKey: key, noteId, sourceHash: embeddedAnnotationSourceHash(item), noteHash: highlightContentHash(row), base: syncBase(item, row) })
  return {
    get file() {
      return file
    },
    set file(next) {
      file = next
    },
    ledger,
    rows,
    cycle(complete = true): TwoWayPlan {
      const plan = planTwoWaySync({ items: file, complete, ledger: [...ledger.values()], rows: [...rows.values()] })
      // File write (replace keeps the object id; remove drops; add appends).
      const removed = new Set(plan.file.remove.map((r) => r.objectId))
      const replaced = new Map(plan.file.replace.map((r) => [r.objectId, r.annotation]))
      file = file.filter((i) => !removed.has(i.objectId)).map((i) => (replaced.has(i.objectId) ? scannedFromWrite(replaced.get(i.objectId)!, i.objectId) : i))
      for (const a of plan.file.add) file.push(scannedFromWrite(a, `${nextObj++}R`))
      const keys = embeddedAnnotationIdentities(file)
      // SQLite.
      for (const { noteId, next } of plan.rowUpdates) rows.set(noteId, next)
      for (const id of plan.rowDeletes) rows.delete(id)
      for (const key of [...plan.ledgerDrops, ...plan.ledgerDropsAfterWrite]) ledger.delete(key)
      for (const { key, item } of plan.inserts) {
        const row = appRow(`imp-${newRow++}`, highlightFromEmbeddedAnnotation(item))
        rows.set(row.id, row)
        setEntry(key, row.id, item, row)
      }
      for (const { key, item } of plan.restores) {
        const row = appRow(`res-${newRow++}`, highlightFromEmbeddedAnnotation(item))
        rows.set(row.id, row)
        setEntry(key, row.id, item, row)
      }
      for (const { key, noteId, item } of plan.links) setEntry(key, noteId, item, rows.get(noteId)!)
      for (const { key, conflict } of plan.conflicts) ledger.set(key, { ...ledger.get(key)!, conflict })
      for (const key of plan.conflictsCleared) {
        const e = ledger.get(key)!
        delete e.conflict
      }
      for (const { key, noteId } of plan.baseRefresh) {
        const item = file[keys.findIndex((k) => k.key === key)]
        if (item) setEntry(key, noteId, item, rows.get(noteId)!)
      }
      // Written rows: ledger entries from the read-back, matched by the /NM each part was written with.
      for (const { noteId, row, oldKeys, names } of plan.writtenRows) {
        for (const k of oldKeys) ledger.delete(k)
        file.forEach((item, i) => {
          if (item.nm && names.includes(item.nm)) setEntry(keys[i]!.key, noteId, item, rows.get(noteId) ?? row)
        })
      }
      // Rows updated from the file: refresh their base against the current file item.
      for (const { noteId } of plan.rowUpdates) {
        for (const [key, e] of ledger) if (e.noteId === noteId && !e.conflict) {
          const item = file[keys.findIndex((k) => k.key === key)]
          if (item) setEntry(key, noteId, item, rows.get(noteId)!)
        }
      }
      return plan
    },
  }
}

const writes = (p: TwoWayPlan) => p.file.add.length + p.file.replace.length + p.file.remove.length

describe('planTwoWaySync — Readmate → file', () => {
  it('a row made in Readmate is added to the file once; later cycles write nothing', () => {
    const w = world()
    w.rows.set('a', appRow('a'))
    const first = w.cycle()
    expect(first.file.add.map((a) => a.nm)).toEqual(['readmate:a'])
    expect(w.file).toHaveLength(1)
    for (let i = 0; i < 3; i++) expect(writes(w.cycle())).toBe(0)
    expect(w.file).toHaveLength(1)
    expect(w.rows.size).toBe(1)
  })

  it('an edit in Readmate rewrites the annotation in place', () => {
    const w = world()
    w.rows.set('a', appRow('a'))
    w.cycle()
    const objectId = w.file[0]!.objectId
    w.rows.set('a', { ...w.rows.get('a')!, colorHex: '#FF0000', note: 'edited' })
    const plan = w.cycle()
    expect(plan.file.replace.map((r) => r.objectId)).toEqual([objectId])
    expect(w.file[0]).toMatchObject({ objectId, colorHex: '#FF0000', contents: 'edited' })
    expect(writes(w.cycle())).toBe(0)
  })

  it('a delete in Readmate removes the annotation from the file (file untouched since)', () => {
    const w = world()
    w.rows.set('a', appRow('a'))
    w.cycle()
    w.rows.delete('a')
    const plan = w.cycle()
    expect(plan.file.remove).toHaveLength(1)
    expect(w.file).toHaveLength(0)
    expect(w.ledger.size).toBe(0)
  })

  it('a foreign annotation without /NM edited in Readmate gets a Readmate /NM and stays one row', () => {
    const w = world()
    w.file = [fileItem()]
    w.cycle() // import
    const [rowId] = [...w.rows.keys()]
    w.rows.set(rowId!, { ...w.rows.get(rowId!)!, note: 'my note' })
    const plan = w.cycle()
    expect(plan.file.replace).toHaveLength(1)
    expect(w.file[0]!.nm).toBe(`readmate:${rowId}`)
    expect(writes(w.cycle())).toBe(0)
    expect(w.rows.size).toBe(1)
  })
})

describe('planTwoWaySync — file → Readmate', () => {
  it('a change in the file updates the row and writes nothing back', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    w.file = [{ ...w.file[0]!, colorHex: '#00FF00', contents: 'from Foxit' }]
    const plan = w.cycle()
    expect(writes(plan)).toBe(0)
    expect([...w.rows.values()][0]).toMatchObject({ colorHex: '#00FF00', note: 'from Foxit' })
    expect(writes(w.cycle())).toBe(0)
  })

  it('removed from the file, row untouched → row deleted; incomplete scans never delete', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    w.file = []
    expect(w.cycle(false).rowDeletes).toEqual([])
    expect(w.rows.size).toBe(1)
    expect(w.cycle(true).rowDeletes).toHaveLength(1)
    expect(w.rows.size).toBe(0)
  })
})

describe('planTwoWaySync — both sides', () => {
  it('different fields changed on each side merge both ways', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    const [rowId] = [...w.rows.keys()]
    w.rows.set(rowId!, { ...w.rows.get(rowId!)!, note: 'note from Readmate' }) // text
    w.file = [{ ...w.file[0]!, colorHex: '#0000FF' }] // color
    const plan = w.cycle()
    expect(plan.conflicts).toEqual([])
    expect(w.rows.get(rowId!)).toMatchObject({ colorHex: '#0000FF', note: 'note from Readmate' })
    expect(w.file[0]).toMatchObject({ colorHex: '#0000FF', contents: 'note from Readmate', nm: '{F-1}' })
    expect(writes(w.cycle())).toBe(0)
  })

  it('the same field changed differently is a conflict: nothing overwritten, frozen until both agree', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    const [rowId] = [...w.rows.keys()]
    w.rows.set(rowId!, { ...w.rows.get(rowId!)!, colorHex: '#FF0000' })
    w.file = [{ ...w.file[0]!, colorHex: '#00FF00' }]
    const plan = w.cycle()
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]!.conflict).toMatchObject({ kind: 'both-changed', fields: ['color'] })
    expect(writes(plan)).toBe(0)
    expect(w.rows.get(rowId!)!.colorHex).toBe('#FF0000')
    expect(w.file[0]!.colorHex).toBe('#00FF00')
    expect(w.cycle().frozen).toBe(1)
    // The other app changes it to Readmate's value: converged, conflict cleared.
    w.file = [{ ...w.file[0]!, colorHex: '#FF0000' }]
    expect(w.cycle().conflictsCleared).toHaveLength(1)
    expect(writes(w.cycle())).toBe(0)
  })

  it('the same field changed to the same value on both sides is not a conflict', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    const [rowId] = [...w.rows.keys()]
    w.rows.set(rowId!, { ...w.rows.get(rowId!)!, colorHex: '#FF0000' })
    w.file = [{ ...w.file[0]!, colorHex: '#FF0000' }]
    const plan = w.cycle()
    expect(plan.conflicts).toEqual([])
    expect(writes(plan)).toBe(0)
  })

  it('removed in the file while edited in Readmate → conflict, row kept', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    const [rowId] = [...w.rows.keys()]
    w.rows.set(rowId!, { ...w.rows.get(rowId!)!, note: 'keep me' })
    w.file = []
    const plan = w.cycle()
    expect(plan.conflicts.map((c) => c.conflict.kind)).toEqual(['removed-in-file'])
    expect(w.rows.get(rowId!)!.note).toBe('keep me')
  })

  it('deleted in Readmate while edited in the file → the row is restored, not lost', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' })]
    w.cycle()
    w.rows.clear()
    w.file = [{ ...w.file[0]!, contents: 'edited in Foxit meanwhile' }]
    const plan = w.cycle()
    expect(plan.restores).toHaveLength(1)
    expect(writes(plan)).toBe(0)
    expect([...w.rows.values()][0]!.note).toBe('edited in Foxit meanwhile')
  })
})

describe('planTwoWaySync — identity and recovery', () => {
  it('after a crash between the file write and the commit, Readmate names are linked, not duplicated', () => {
    const w = world()
    w.rows.set('a', appRow('a'))
    w.file = [{ ...fileItem(), nm: 'readmate:a', rects: [R(0, 0.1)] }] // written, ledger never committed
    const plan = w.cycle()
    expect(plan.links).toHaveLength(1)
    expect(plan.inserts).toHaveLength(0)
    expect(writes(plan)).toBe(0)
    expect(w.rows.size).toBe(1)
  })

  it('moves of a named annotation keep the row; repeated cycles never duplicate', () => {
    const w = world()
    w.file = [fileItem({ nm: '{F-1}' }), fileItem({ nm: '{F-2}', subtype: 'Underline', rects: [R(0, 0.5)] })]
    w.rows.set('mine', appRow('mine'))
    w.cycle()
    w.file = w.file.map((i) => (i.nm === '{F-1}' ? { ...i, rects: [R(0, 0.7)] } : i))
    w.cycle()
    for (let i = 0; i < 4; i++) w.cycle()
    expect(w.rows.size).toBe(3)
    expect(w.file).toHaveLength(3)
    expect([...w.rows.values()].find((r) => r.id.startsWith('imp') && r.pdfAnnotation!.rects[0]!.y === 0.7)).toBeTruthy()
  })

  it('legacy ledger rows (no base) still sync by hash and get a base', () => {
    const item = fileItem({ nm: '{F-1}' })
    const row = appRow('old', highlightFromEmbeddedAnnotation(item))
    const key = embeddedAnnotationIdentities([item])[0]!.key
    const plan = planTwoWaySync({
      items: [item],
      complete: true,
      ledger: [{ sourceKey: key, noteId: 'old', sourceHash: embeddedAnnotationSourceHash(item), noteHash: highlightContentHash(row) }],
      rows: [row],
    })
    expect(plan.unchanged).toBe(1)
    expect(plan.baseRefresh).toHaveLength(1)
    expect(writes(plan)).toBe(0)
  })

  it('a multi-page row is written as one annotation per page and stays stable', () => {
    const w = world()
    w.rows.set('m', appRow('m', { pdfAnnotation: { pageIndex: 0, rects: [R(0, 0.9), R(1, 0.05)] } }))
    expect(w.cycle().file.add.map((a) => a.nm)).toEqual(['readmate:m', 'readmate:m:p2'])
    expect(writes(w.cycle())).toBe(0)
    expect(w.file).toHaveLength(2)
  })
})

describe('planTwoWaySync — Typewriter notes (FreeText)', () => {
  const TEXT = 'Xin chào thế giới'
  const twRow = (id: string, doc = emptyTypewriterDoc(), extra: Partial<ExportableHighlight> = {}): ExportableHighlight =>
    appRow(id, { styleKind: 'typewriter', note: TEXT, colorHex: doc.base.color, pdfAnnotation: { pageIndex: 0, rects: [R(0, 0.2)], typewriter: doc }, ...extra })

  it('a Typewriter row is written once as a FreeText named after it; later cycles write nothing', () => {
    const w = world()
    w.rows.set('t', twRow('t'))
    const first = w.cycle()
    expect(first.file.add.map((a) => [a.nm, a.subtype, a.contents])).toEqual([['readmate:t', 'FreeText', TEXT]])
    expect(first.file.add[0]!.typewriter?.text).toBe(TEXT)
    for (let i = 0; i < 3; i++) expect(writes(w.cycle())).toBe(0)
    expect(w.rows.size).toBe(1)
  })

  it('a formatting change in the app (a bold word) is rewritten into the file; the file side has no colour to compare', () => {
    const w = world()
    w.rows.set('t', twRow('t'))
    w.cycle()
    const doc = applyStyle(emptyTypewriterDoc(), TEXT, { start: 0, end: 3 }, { bold: true, color: '#FF0000' })
    w.rows.set('t', twRow('t', doc))
    const plan = w.cycle()
    expect(plan.file.replace).toHaveLength(1)
    expect(plan.file.replace[0]!.annotation.typewriter?.doc.runs).toHaveLength(1)
    expect(writes(w.cycle())).toBe(0)
  })

  it('the sync fields are kind / colour / text / geometry; the file never changes the kind or the colour', () => {
    const item: ScannedPdfAnnotation = { objectId: '9R', subtype: 'FreeText', pageIndex: 0, rects: [R(0, 0.2)], contents: TEXT, nm: 'readmate:t', colorHex: '#00FF00' }
    expect(fileSide(item)).toEqual({ kind: 'typewriter', color: '', text: TEXT, geometry: '0.100,0.200,0.500,0.020' })
    const row = twRow('t')
    const next = applyFileFields(row, { ...item, colorHex: '#00FF00' }, ['kind', 'color'])
    expect(next.styleKind).toBe('typewriter')
    expect(next.colorHex).toBe(row.colorHex)
    expect(next.pdfAnnotation?.typewriter).toEqual(row.pdfAnnotation?.typewriter)
  })

  it('a box moved in the file moves the note and keeps its document', () => {
    const w = world()
    const doc = applyStyle(emptyTypewriterDoc(), TEXT, { start: 0, end: 3 }, { bold: true })
    w.rows.set('t', twRow('t', doc))
    w.cycle()
    w.file = [{ ...w.file[0]!, rects: [R(0, 0.5, 0.2)] }]
    w.cycle()
    const row = w.rows.get('t')!
    expect(row.pdfAnnotation?.rects[0]).toMatchObject({ x: 0.2, y: 0.5 })
    expect(row.pdfAnnotation?.typewriter).toEqual(doc)
  })

  it('a different /Contents in the file is a conflict: the document and text stay untouched, nothing is written', () => {
    const w = world()
    const doc = applyStyle(emptyTypewriterDoc(), TEXT, { start: 0, end: 3 }, { bold: true })
    w.rows.set('t', twRow('t', doc))
    w.cycle()
    w.file = [{ ...w.file[0]!, contents: 'edited elsewhere' }]
    const plan = w.cycle()
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]!.conflict).toMatchObject({ kind: 'both-changed', fields: ['text'] })
    expect(writes(plan)).toBe(0)
    expect(w.rows.get('t')!.note).toBe(TEXT)
    expect(w.rows.get('t')!.pdfAnnotation?.typewriter).toEqual(doc)
  })

  it('choosing the file text keeps the box and base style but restarts the rich text (old offsets are meaningless)', () => {
    const doc = applyAlign(applyStyle(emptyTypewriterDoc(), TEXT, { start: 0, end: 3 }, { bold: true }), TEXT, null, 'center')
    const item: ScannedPdfAnnotation = { objectId: '9R', subtype: 'FreeText', pageIndex: 0, rects: [R(0, 0.2)], contents: 'từ file\r\nhai', nm: 'readmate:t' }
    const next = applyFileFields(twRow('t', doc), item, ['text'])
    expect(next.note).toBe('từ file\nhai')
    expect(next.pdfAnnotation?.typewriter?.runs).toEqual([])
    expect(next.pdfAnnotation?.typewriter?.align).toEqual([])
    expect(next.pdfAnnotation?.typewriter?.base).toEqual(doc.base)
  })

  it('a Readmate FreeText whose row is gone comes back as a plain Typewriter row; a foreign or empty one is never imported', () => {
    const w = world()
    w.file = [{ objectId: '9R', subtype: 'FreeText', pageIndex: 0, rects: [R(0, 0.2)], contents: TEXT, nm: 'readmate:lost' }]
    const plan = w.cycle()
    expect(plan.inserts).toHaveLength(1)
    const imported = [...w.rows.values()][0]!
    expect(imported.styleKind).toBe('typewriter')
    expect(imported.note).toBe(TEXT)
    expect(imported.pdfAnnotation?.typewriter).toBeDefined()
    const empty = world()
    empty.file = [{ objectId: '9R', subtype: 'FreeText', pageIndex: 0, rects: [R(0, 0.2)], nm: 'readmate:blank' }]
    expect(empty.cycle().inserts).toHaveLength(0)
  })
})
