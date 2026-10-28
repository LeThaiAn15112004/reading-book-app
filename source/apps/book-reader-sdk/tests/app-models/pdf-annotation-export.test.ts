import { describe, expect, it } from 'vitest'
import { emptyTypewriterDoc } from '../../src/typewriter/index.js'
import {
  isPdfWritableStyle,
  noteIdFromReadmateName,
  pdfColorFromHex,
  pdfDateString,
  pdfWriteAnnotationsFromHighlight,
  planPdfAnnotationWrite,
  readmateAnnotationName,
  type ExportableHighlight,
} from '../../src/app-models/pdf-annotation-export.js'
import {
  embeddedAnnotationIdentities,
  embeddedAnnotationSourceHash,
  highlightContentHash,
  highlightFromEmbeddedAnnotation,
  type EmbeddedAnnotationLedgerEntry,
  type ScannedPdfAnnotation,
} from '../../src/app-models/pdf-embedded-annotations.js'

const rect = (pageIndex: number, y: number) => ({ pageIndex, x: 0.1, y, width: 0.5, height: 0.02 })

function row(id: string, extra: Partial<ExportableHighlight> = {}): ExportableHighlight {
  return {
    id,
    styleKind: 'highlight',
    colorHex: '#FFEB3B',
    tags: [],
    pdfAnnotation: { pageIndex: 0, rects: [rect(0, 0.1)] },
    createdAt: '2026-10-17T08:00:00.000Z',
    updatedAt: '2026-10-17T09:30:05.000Z',
    ...extra,
  }
}

function scanned(objectId: string, extra: Partial<ScannedPdfAnnotation> = {}): ScannedPdfAnnotation {
  return { objectId, subtype: 'Highlight', pageIndex: 0, rects: [rect(0, 0.3)], colorHex: '#FFEB3B', ...extra }
}

/** A ledger with `items` imported as rows (what the import wrote), keyed like the sync does. */
function imported(items: ScannedPdfAnnotation[]) {
  const ledger = new Map<string, EmbeddedAnnotationLedgerEntry>()
  const rows: ExportableHighlight[] = []
  embeddedAnnotationIdentities(items).forEach(({ key }, i) => {
    const h = highlightFromEmbeddedAnnotation(items[i]!)
    const r = row(`imp-${i}`, { ...h })
    rows.push(r)
    ledger.set(key, { sourceKey: key, noteId: r.id, sourceHash: embeddedAnnotationSourceHash(items[i]!), noteHash: highlightContentHash(r) })
  })
  return { ledger, rows }
}

describe('mapping helpers', () => {
  it('colors: #RRGGBB, #RRGGBBAA (opacity), fallback', () => {
    expect(pdfColorFromHex('#FF0000')).toEqual({ color: [1, 0, 0], opacity: 1 })
    expect(pdfColorFromHex('#4fc3f780')).toEqual({ color: [0.31, 0.765, 0.969], opacity: 0.502 })
    expect(pdfColorFromHex('nonsense').color).toEqual(pdfColorFromHex('#FFEB3B').color)
  })

  it('PDF dates are UTC D:YYYYMMDDHHmmSSZ', () => {
    expect(pdfDateString('2026-10-17T09:30:05.000Z')).toBe('D:20261017093005Z')
    expect(pdfDateString('garbage')).toBe('D:19700101000000Z')
  })

  it('Readmate names round-trip', () => {
    expect(readmateAnnotationName('abc', 0, 0)).toBe('readmate:abc')
    expect(readmateAnnotationName('abc', 3, 2)).toBe('readmate:abc:p4')
    expect(noteIdFromReadmateName('readmate:abc:p4')).toBe('abc')
    expect(noteIdFromReadmateName('readmate:abc')).toBe('abc')
    expect(noteIdFromReadmateName('{FOXIT-1}')).toBeUndefined()
    expect(noteIdFromReadmateName(undefined)).toBeUndefined()
  })
})

describe('pdfWriteAnnotationsFromHighlight', () => {
  it('maps each style to its PDF subtype with color, opacity, note, author and dates', () => {
    const kinds = { highlight: 'Highlight', underline: 'Underline', squiggly: 'Squiggly', strikethrough: 'StrikeOut', textbox: 'Text' } as const
    for (const [styleKind, subtype] of Object.entries(kinds)) {
      const [w] = pdfWriteAnnotationsFromHighlight(row('n1', { styleKind: styleKind as keyof typeof kinds, colorHex: '#00FF0080', note: ' my note ' }))
      expect(w).toMatchObject({ nm: 'readmate:n1', subtype, pageIndex: 0, color: [0, 1, 0], contents: 'my note', author: 'Readmate' })
      expect(w!.opacity).toBe(subtype === 'Text' ? 1 : 0.502)
    }
  })

  it('splits a selection across pages into one annotation per page; a note goes on the last page only', () => {
    const multi = row('n2', { pdfAnnotation: { pageIndex: 2, rects: [rect(2, 0.9), rect(2, 0.93), rect(3, 0.05)] } })
    const parts = pdfWriteAnnotationsFromHighlight(multi)
    expect(parts.map((p) => [p.nm, p.pageIndex, p.rects.length])).toEqual([
      ['readmate:n2', 2, 2],
      ['readmate:n2:p4', 3, 1],
    ])
    const note = pdfWriteAnnotationsFromHighlight({ ...multi, styleKind: 'textbox', note: 'x' })
    expect(note.map((p) => [p.nm, p.pageIndex])).toEqual([['readmate:n2', 3]])
  })

  it('keeps an imported annotation’s own name; nothing for rows without geometry', () => {
    expect(pdfWriteAnnotationsFromHighlight(row('n3'), '{FOXIT-9}')[0]!.nm).toBe('{FOXIT-9}')
    expect(pdfWriteAnnotationsFromHighlight(row('n4', { pdfAnnotation: undefined }))).toEqual([])
  })
})

describe('Typewriter notes (FreeText)', () => {
  const doc = emptyTypewriterDoc()
  const tw = (extra: Partial<ExportableHighlight> = {}) =>
    row('t1', {
      styleKind: 'typewriter',
      colorHex: '#1E88E5',
      note: '  Xin chào\nthế giới ',
      pdfAnnotation: { pageIndex: 1, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }], typewriter: doc },
      ...extra,
    })

  it('is writable and maps to one FreeText with the untrimmed text', () => {
    expect(isPdfWritableStyle('typewriter')).toBe(true)
    const [w, ...rest] = pdfWriteAnnotationsFromHighlight(tw())
    expect(rest).toEqual([])
    expect(w).toMatchObject({ nm: 'readmate:t1', subtype: 'FreeText', pageIndex: 1, opacity: 1, contents: '  Xin chào\nthế giới ', author: 'Readmate' })
    expect(w!.typewriter).toEqual({ doc, text: '  Xin chào\nthế giới ' })
    expect(w!.rects).toEqual([{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }])
    expect(w!.color[2]).toBeCloseTo(0.898, 2)
  })

  it('writes nothing without a doc, text or exactly one rect', () => {
    expect(pdfWriteAnnotationsFromHighlight(tw({ pdfAnnotation: { pageIndex: 1, rects: [rect(1, 0.1)] } }))).toEqual([])
    expect(pdfWriteAnnotationsFromHighlight(tw({ note: undefined }))).toEqual([])
    const two = { pageIndex: 1, rects: [rect(1, 0.1), rect(1, 0.3)], typewriter: doc }
    expect(pdfWriteAnnotationsFromHighlight(tw({ pdfAnnotation: two }))).toEqual([])
  })

  it('plans an add for a new note and a replace after a text edit', () => {
    const base = { scanned: [], ledger: new Map(), rows: [tw()] }
    const plan = planPdfAnnotationWrite(base)
    expect(plan.add.map((a) => a.subtype)).toEqual(['FreeText'])
    expect(plan.writtenNoteIds).toEqual(['t1'])
  })
})

describe('planPdfAnnotationWrite', () => {
  it('a file without annotations and no rows: nothing to write', () => {
    expect(planPdfAnnotationWrite({ scanned: [], ledger: new Map(), rows: [] })).toEqual({ add: [], replace: [], remove: [], kept: 0, writtenNoteIds: [] })
  })

  it('rows made in Readmate are added', () => {
    const plan = planPdfAnnotationWrite({ scanned: [], ledger: new Map(), rows: [row('a'), row('b', { styleKind: 'underline' })] })
    expect(plan.add.map((a) => [a.nm, a.subtype])).toEqual([
      ['readmate:a', 'Highlight'],
      ['readmate:b', 'Underline'],
    ])
    expect(plan.writtenNoteIds).toEqual(['a', 'b'])
  })

  it('imported annotations untouched in Readmate are kept as they are', () => {
    const items = [scanned('10R', { nm: '{F-1}' }), scanned('11R', { subtype: 'Underline', rects: [rect(0, 0.5)] })]
    const { ledger, rows } = imported(items)
    const plan = planPdfAnnotationWrite({ scanned: items, ledger, rows })
    expect(plan).toMatchObject({ add: [], replace: [], remove: [], kept: 2 })
  })

  it('an imported annotation edited in Readmate is replaced in place and keeps its /NM', () => {
    const items = [scanned('10R', { nm: '{F-1}' })]
    const { ledger, rows } = imported(items)
    rows[0] = { ...rows[0]!, colorHex: '#FF0000', note: 'edited in Readmate' }
    const plan = planPdfAnnotationWrite({ scanned: items, ledger, rows })
    expect(plan.replace).toHaveLength(1)
    expect(plan.replace[0]).toMatchObject({ objectId: '10R', annotation: { nm: '{F-1}', color: [1, 0, 0], contents: 'edited in Readmate' } })
    expect(plan.add).toHaveLength(0)
  })

  it('an imported annotation deleted in Readmate (tombstone) is removed', () => {
    const items = [scanned('10R', { nm: '{F-1}' }), scanned('11R', { nm: '{F-2}', rects: [rect(0, 0.6)] })]
    const { ledger, rows } = imported(items)
    const plan = planPdfAnnotationWrite({ scanned: items, ledger, rows: rows.slice(1) })
    expect(plan.remove).toEqual([{ objectId: '10R', pageIndex: 0 }])
    expect(plan.kept).toBe(1)
  })

  it('writing twice never duplicates: Readmate names already in the file are replaced, orphans removed', () => {
    const rows = [row('a'), row('b')]
    const first = planPdfAnnotationWrite({ scanned: [], ledger: new Map(), rows })
    // The file after the first write holds both, as readmate:a / readmate:b.
    const inFile = first.add.map((a, i) => scanned(`${20 + i}R`, { nm: a.nm, subtype: a.subtype as ScannedPdfAnnotation['subtype'], rects: a.rects.map((r) => ({ ...r, pageIndex: 0 })) }))
    const again = planPdfAnnotationWrite({ scanned: inFile, ledger: new Map(), rows })
    expect(again.add).toHaveLength(0)
    expect(again.replace.map((r) => r.objectId)).toEqual(['20R', '21R'])
    // Row b deleted in Readmate → its annotation goes.
    const afterDelete = planPdfAnnotationWrite({ scanned: inFile, ledger: new Map(), rows: [rows[0]!] })
    expect(afterDelete.remove).toEqual([{ objectId: '21R', pageIndex: 0 }])
    expect(afterDelete.add).toHaveLength(0)
  })

  it('a multi-page row matches its parts by name; a missing part is added, a stale one removed', () => {
    const multi = row('m', { pdfAnnotation: { pageIndex: 0, rects: [rect(0, 0.9), rect(1, 0.1)] } })
    const inFile = [scanned('30R', { nm: 'readmate:m' }), scanned('31R', { nm: 'readmate:m:p5', pageIndex: 4, rects: [rect(4, 0.1)] })]
    const plan = planPdfAnnotationWrite({ scanned: inFile, ledger: new Map(), rows: [multi] })
    expect(plan.replace.map((r) => [r.objectId, r.annotation.nm])).toEqual([['30R', 'readmate:m']])
    expect(plan.add.map((a) => a.nm)).toEqual(['readmate:m:p2'])
    expect(plan.remove).toEqual([{ objectId: '31R', pageIndex: 4 }])
  })

  it('foreign annotations Readmate never imported are left alone', () => {
    const plan = planPdfAnnotationWrite({ scanned: [scanned('40R', { nm: '{OTHER}' })], ledger: new Map(), rows: [] })
    expect(plan).toMatchObject({ add: [], replace: [], remove: [], kept: 0 })
  })
})
