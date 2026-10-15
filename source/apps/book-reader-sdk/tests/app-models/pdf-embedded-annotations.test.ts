import { describe, expect, it } from 'vitest'
import {
  EMBEDDED_PDF_ANNOTATION_STYLE,
  embeddedAnnotationKeys,
  embeddedAnnotationSourceHash,
  highlightContentHash,
  highlightFromEmbeddedAnnotation,
  parseScannedPdfAnnotation,
  planEmbeddedAnnotationSync,
  readPdfJsAnnotation,
  type EmbeddedAnnotationLedgerEntry,
  type HighlightContent,
  type PdfPageViewportInfo,
  type ScannedPdfAnnotation,
} from '../../src/app-models/pdf-embedded-annotations.js'
import { isConsistentPdfHighlight, pdfHighlightDtoToReaderHighlight, packPdfAnnotationRef } from '../../src/app-models/pdf-highlight.js'
import type { NoteLocator } from '../../src/domain/index.js'

/** US-Letter page, PDF.js scale-1 viewport without rotation: y flips, origin moves to the top. */
const LETTER: PdfPageViewportInfo = { pageIndex: 0, transform: [1, 0, 0, -1, 0, 792], width: 612, height: 792 }
/** The same page with `/Rotate 90` (PDF.js: `[0, 1, 1, 0, 0, 0]`, width/height swapped). */
const LETTER_ROT90: PdfPageViewportInfo = { pageIndex: 0, transform: [0, 1, 1, 0, 0, 0], width: 792, height: 612 }

/** QuadPoints as PDF.js normalizes them: [minX, maxY, maxX, maxY, minX, minY, maxX, minY] per quad. */
function quad(x1: number, y1: number, x2: number, y2: number): number[] {
  return [x1, y2, x2, y2, x1, y1, x2, y1]
}

/** A PDF.js `getAnnotations()` item, as plain data. */
function pdfjsItem(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '12R',
    subtype: 'Highlight',
    annotationType: 9,
    rect: [72, 700, 300, 716],
    quadPoints: new Float32Array(quad(72, 700, 300, 716)),
    color: new Uint8ClampedArray([255, 235, 59]),
    contentsObj: { str: 'Remember this', dir: 'ltr' },
    titleObj: { str: 'Alice', dir: 'ltr' },
    overlaidText: 'Page 1 line 1:  the quick\nbrown fox',
    ...extra,
  }
}

function scan(extra: Record<string, unknown> = {}, page: PdfPageViewportInfo = LETTER): ScannedPdfAnnotation {
  const item = readPdfJsAnnotation(pdfjsItem(extra), page)
  if (!item) throw new Error('expected a scanned annotation')
  return item
}

describe('readPdfJsAnnotation', () => {
  it('reads a Highlight into normalized display-space rects with color, comment, author and text', () => {
    const item = scan()
    expect(item.subtype).toBe('Highlight')
    expect(item.objectId).toBe('12R')
    expect(item.pageIndex).toBe(0)
    expect(item.rects).toHaveLength(1)
    const r = item.rects[0]!
    expect(r.pageIndex).toBe(0)
    expect(r.x).toBeCloseTo(72 / 612, 5)
    expect(r.y).toBeCloseTo((792 - 716) / 792, 5)
    expect(r.width).toBeCloseTo(228 / 612, 5)
    expect(r.height).toBeCloseTo(16 / 792, 5)
    expect(item.colorHex).toBe('#FFEB3B')
    expect(item.contents).toBe('Remember this')
    expect(item.author).toBe('Alice')
    expect(item.text).toBe('Page 1 line 1: the quick brown fox')
  })

  it('keeps one rect per quad (multi-line markup)', () => {
    const item = scan({ quadPoints: [...quad(72, 700, 300, 716), ...quad(72, 672, 200, 688)] })
    expect(item.rects).toHaveLength(2)
    expect(item.rects[1]!.y).toBeGreaterThan(item.rects[0]!.y)
  })

  it('applies the page rotation through the viewport transform', () => {
    const item = scan({}, LETTER_ROT90)
    const r = item.rects[0]!
    // Rotated 90°: user-space y becomes display x, user-space x becomes display y.
    expect(r.x).toBeCloseTo(700 / 792, 5)
    expect(r.width).toBeCloseTo(16 / 792, 5)
    expect(r.y).toBeCloseTo(72 / 612, 5)
    expect(r.height).toBeCloseTo(228 / 612, 5)
  })

  it('maps every supported subtype to its style', () => {
    for (const subtype of ['Highlight', 'Underline', 'Squiggly', 'StrikeOut'] as const) {
      expect(scan({ subtype }).subtype).toBe(subtype)
    }
    expect(EMBEDDED_PDF_ANNOTATION_STYLE).toEqual({
      Highlight: 'highlight',
      Underline: 'underline',
      Squiggly: 'underline',
      StrikeOut: 'strikethrough',
      Text: 'textbox',
    })
  })

  it('anchors a Text (sticky note) annotation on its icon rect', () => {
    const item = scan({ subtype: 'Text', quadPoints: undefined, rect: [500, 740, 522, 762], contentsObj: { str: 'Sticky' }, overlaidText: undefined })
    expect(item.subtype).toBe('Text')
    expect(item.rects[0]!.x).toBeCloseTo(500 / 612, 5)
    expect(item.contents).toBe('Sticky')
    expect(item.text).toBeUndefined()
  })

  it('ignores types the app cannot represent, replies, and items without usable geometry', () => {
    for (const subtype of ['Link', 'FreeText', 'Ink', 'Square', 'Stamp', 'Popup', 'Widget', 'FileAttachment']) {
      expect(readPdfJsAnnotation(pdfjsItem({ subtype }), LETTER)).toBeNull()
    }
    expect(readPdfJsAnnotation(pdfjsItem({ inReplyTo: '9R' }), LETTER)).toBeNull()
    // Invisible / Hidden / NoView (PDF.js still returns Hidden ones for the display intent).
    for (const flags of [1, 2, 32, 2 | 4]) {
      expect(readPdfJsAnnotation(pdfjsItem({ annotationFlags: flags }), LETTER)).toBeNull()
    }
    expect(readPdfJsAnnotation(pdfjsItem({ annotationFlags: 4 }), LETTER)).not.toBeNull()
    expect(readPdfJsAnnotation(pdfjsItem({ quadPoints: null }), LETTER)).toBeNull()
    expect(readPdfJsAnnotation(pdfjsItem({ quadPoints: [1, 2, 3] }), LETTER)).toBeNull()
    expect(readPdfJsAnnotation(pdfjsItem({ quadPoints: [72, NaN, 1, 2, 3, 4, 5, 6] }), LETTER)).toBeNull()
    // Entirely off the page → nothing left after clamping.
    expect(readPdfJsAnnotation(pdfjsItem({ quadPoints: quad(700, 900, 800, 950) }), LETTER)).toBeNull()
    expect(readPdfJsAnnotation(pdfjsItem({ id: undefined }), LETTER)).toBeNull()
    expect(readPdfJsAnnotation(null, LETTER)).toBeNull()
    expect(readPdfJsAnnotation(pdfjsItem(), { ...LETTER, width: 0 })).toBeNull()
  })

  it('treats a missing color / comment / author as absent', () => {
    const item = scan({ color: null, contentsObj: { str: '  ' }, titleObj: undefined, overlaidText: '' })
    expect(item.colorHex).toBeUndefined()
    expect(item.contents).toBeUndefined()
    expect(item.author).toBeUndefined()
    expect(item.text).toBeUndefined()
  })
})

describe('parseScannedPdfAnnotation (IPC boundary)', () => {
  it('accepts what the renderer produces (structured-clone round trip)', () => {
    const item = scan()
    expect(parseScannedPdfAnnotation(JSON.parse(JSON.stringify(item)))).toEqual(item)
  })

  it('rejects bad items', () => {
    const good = JSON.parse(JSON.stringify(scan())) as Record<string, unknown>
    const bad: Record<string, unknown>[] = [
      { ...good, subtype: 'Ink' },
      { ...good, objectId: '' },
      { ...good, objectId: 'x'.repeat(65) },
      { ...good, pageIndex: -1 },
      { ...good, rects: [] },
      { ...good, rects: [{ pageIndex: 0, x: 0.5, y: 0.5, width: 0.6, height: 0.1 }] },
      { ...good, rects: [{ pageIndex: 1, x: 0.1, y: 0.1, width: 0.1, height: 0.1 }] },
      { ...good, colorHex: 'red' },
      { ...good, contents: 42 },
      { ...good, contents: 'x'.repeat(10_001) },
    ]
    for (const item of bad) expect(parseScannedPdfAnnotation(item)).toBeNull()
    expect(parseScannedPdfAnnotation(null)).toBeNull()
  })
})

describe('identity keys', () => {
  it('are stable across loads and independent of the PDF.js object id', () => {
    const first = embeddedAnnotationKeys([scan({ id: '12R' })])
    const renumbered = embeddedAnnotationKeys([scan({ id: '57R' })])
    expect(renumbered).toEqual(first)
  })

  it('ignore color, comment and author (edits in another viewer keep the identity)', () => {
    const [a] = embeddedAnnotationKeys([scan()])
    const [b] = embeddedAnnotationKeys([scan({ color: [0, 0, 255], contentsObj: { str: 'edited' }, titleObj: { str: 'Bob' } })])
    expect(b).toBe(a)
  })

  it('differ by subtype, page and geometry', () => {
    const base = embeddedAnnotationKeys([scan()])[0]
    expect(embeddedAnnotationKeys([scan({ subtype: 'Underline' })])[0]).not.toBe(base)
    expect(embeddedAnnotationKeys([scan({}, { ...LETTER, pageIndex: 1 })])[0]).not.toBe(base)
    expect(embeddedAnnotationKeys([scan({ quadPoints: quad(72, 672, 300, 688) })])[0]).not.toBe(base)
  })

  it('keep identical / stacked annotations apart with an occurrence counter', () => {
    const keys = embeddedAnnotationKeys([scan({ id: '1R' }), scan({ id: '2R' }), scan({ id: '3R', subtype: 'Underline' })])
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]!.endsWith('#0')).toBe(true)
    expect(keys[1]!.endsWith('#1')).toBe(true)
  })

  it('tolerate float noise below the key precision', () => {
    const [a] = embeddedAnnotationKeys([scan({ quadPoints: quad(72, 700, 300, 716) })])
    const [b] = embeddedAnnotationKeys([scan({ quadPoints: quad(72.00001, 700.00002, 300, 716) })])
    expect(b).toBe(a)
  })
})

describe('highlightFromEmbeddedAnnotation', () => {
  it('builds a row the PDF annotation pipeline accepts and paints', () => {
    const item = scan({ quadPoints: [...quad(72, 700, 300, 716), ...quad(72, 672, 200, 688)] })
    const h = highlightFromEmbeddedAnnotation(item)
    expect(h.styleKind).toBe('highlight')
    expect(h.colorHex).toBe('#FFEB3B')
    expect(h.note).toBe('Remember this')
    expect(h.selectionText).toEqual({ highlight: 'Page 1 line 1: the quick brown fox' })
    expect(isConsistentPdfHighlight(h.locator, h.pdfAnnotation)).toBe(true)
    const row = pdfHighlightDtoToReaderHighlight({
      id: 'n1',
      locatorRef: JSON.stringify(h.locator),
      styleKind: h.styleKind,
      colorHex: h.colorHex,
      note: h.note,
      tags: h.tags,
      selectionTextRef: JSON.stringify(h.selectionText),
      pdfAnnotationRef: packPdfAnnotationRef(h.pdfAnnotation),
      createdAt: 'c',
      updatedAt: 'u',
    })
    expect(row?.page).toBe(1)
    expect(row?.rects).toHaveLength(2)
  })

  it('uses the default color when the file has none, and maps Text to a note', () => {
    const h = highlightFromEmbeddedAnnotation(scan({ subtype: 'Text', rect: [500, 740, 522, 762], color: null }))
    expect(h.styleKind).toBe('textbox')
    expect(h.colorHex).toBe('#FFEB3B')
    expect((h.locator as NoteLocator & { chapterIndex?: number }).chapterIndex).toBe(0)
  })
})

describe('highlightContentHash', () => {
  const content: HighlightContent = {
    styleKind: 'highlight',
    colorHex: '#ffeb3b',
    note: 'n',
    tags: [],
    selectionText: { highlight: 't' },
    pdfAnnotation: { pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.02 }] },
  }
  it('is insensitive to color case / undefined tags, sensitive to every user edit', () => {
    expect(highlightContentHash({ ...content, colorHex: '#FFEB3B', tags: undefined })).toBe(highlightContentHash(content))
    for (const edit of [{ colorHex: '#4FC3F7' }, { note: 'other' }, { tags: ['x'] }, { styleKind: 'underline' as const }]) {
      expect(highlightContentHash({ ...content, ...edit })).not.toBe(highlightContentHash(content))
    }
  })
})

/**
 * A tiny model of Main's sync: the ledger + notes maps, `planEmbeddedAnnotationSync` applied the
 * way `SqliteOverlayStore.syncEmbeddedPdfAnnotations` applies it.
 */
function createSyncModel() {
  const ledger = new Map<string, EmbeddedAnnotationLedgerEntry>()
  const notes = new Map<string, HighlightContent & { origin: 'pdf' | 'app' }>()
  let nextId = 1
  return {
    ledger,
    notes,
    addAppNote(content: HighlightContent): string {
      const id = `app-${nextId++}`
      notes.set(id, { ...content, origin: 'app' })
      return id
    },
    open(items: ScannedPdfAnnotation[]) {
      const plan = planEmbeddedAnnotationSync(items, ledger, (id) => {
        const note = notes.get(id)
        return note ? highlightContentHash(note) : undefined
      })
      for (const step of plan.inserts) {
        const id = `pdf-${nextId++}`
        const row = highlightFromEmbeddedAnnotation(step.item)
        notes.set(id, { ...row, origin: 'pdf' })
        ledger.set(step.key, { sourceKey: step.key, noteId: id, sourceHash: embeddedAnnotationSourceHash(step.item), noteHash: highlightContentHash(row) })
      }
      for (const step of plan.updates) {
        const row = highlightFromEmbeddedAnnotation(step.item)
        notes.set(step.noteId, { ...row, origin: 'pdf' })
        ledger.set(step.key, { sourceKey: step.key, noteId: step.noteId, sourceHash: embeddedAnnotationSourceHash(step.item), noteHash: highlightContentHash(row) })
      }
      return plan
    },
  }
}

const A = () => scan({ id: '10R' })
const B = () => scan({ id: '11R', subtype: 'Underline', quadPoints: quad(72, 672, 300, 688), contentsObj: undefined })
const C = () => scan({ id: '12R', subtype: 'StrikeOut', quadPoints: quad(72, 644, 300, 660), contentsObj: undefined })
const D = () => scan({ id: '13R', subtype: 'Squiggly', quadPoints: quad(72, 616, 300, 632) }, { ...LETTER, pageIndex: 1 })
const E = () => scan({ id: '14R', subtype: 'Text', rect: [500, 740, 522, 762], contentsObj: { str: 'Sticky' } }, { ...LETTER, pageIndex: 2 })

describe('planEmbeddedAnnotationSync', () => {
  it('1. first open imports everything', () => {
    const model = createSyncModel()
    const plan = model.open([A(), B(), C()])
    expect(plan.inserts).toHaveLength(3)
    expect(model.notes.size).toBe(3)
    expect(plan.managed).toEqual([0, 1, 2])
  })

  it('2. reopening the same file writes nothing', () => {
    const model = createSyncModel()
    model.open([A(), B(), C()])
    const plan = model.open([A(), B(), C()])
    expect(plan).toMatchObject({ inserts: [], updates: [], unchanged: 3 })
    expect(model.notes.size).toBe(3)
  })

  it('3. a file opened before without any import still gets imported on the next open', () => {
    const model = createSyncModel()
    model.open([]) // e.g. an earlier open whose scan failed or saw nothing
    const plan = model.open([A(), B()])
    expect(plan.inserts).toHaveLength(2)
  })

  it('4. annotations added in another viewer are found on the next open (object ids renumbered)', () => {
    const model = createSyncModel()
    model.open([A(), B(), C()])
    // A full rewrite renumbers every object; two new annotations appear.
    const plan = model.open([
      { ...A(), objectId: '40R' },
      { ...B(), objectId: '41R' },
      { ...C(), objectId: '42R' },
      D(),
      E(),
    ])
    expect(plan.inserts.map((s) => s.item.subtype)).toEqual(['Squiggly', 'Text'])
    expect(plan.unchanged).toBe(3)
    expect(model.notes.size).toBe(5)
  })

  it('5. a color / comment edit in another viewer updates the imported row', () => {
    const model = createSyncModel()
    model.open([A()])
    const edited = scan({ id: '10R', color: [79, 195, 247], contentsObj: { str: 'Changed in Foxit' } })
    const plan = model.open([edited])
    expect(plan.updates).toHaveLength(1)
    const row = [...model.notes.values()][0]!
    expect(row.colorHex).toBe('#4FC3F7')
    expect(row.note).toBe('Changed in Foxit')
    expect(model.notes.size).toBe(1)
  })

  it('5b. a move in another viewer becomes a new row (the old one is kept)', () => {
    const model = createSyncModel()
    model.open([A()])
    const plan = model.open([scan({ id: '10R', quadPoints: quad(72, 500, 300, 516) })])
    expect(plan.inserts).toHaveLength(1)
    expect(model.notes.size).toBe(2)
  })

  it('6. deleting an annotation from the file never deletes the row', () => {
    const model = createSyncModel()
    model.open([A(), B()])
    const plan = model.open([A()])
    expect(plan.inserts).toHaveLength(0)
    expect(model.notes.size).toBe(2)
  })

  it('7. a file without annotations changes nothing', () => {
    const model = createSyncModel()
    const plan = model.open([])
    expect(plan).toEqual({ inserts: [], updates: [], unchanged: 0, keptAppEdits: 0, dismissed: 0, managed: [] })
    expect(model.notes.size).toBe(0)
    expect(model.ledger.size).toBe(0)
  })

  it('8. identical or overlapping annotations stay separate rows, and stay stable on reopen', () => {
    const model = createSyncModel()
    const twins = [scan({ id: '1R' }), scan({ id: '2R' }), scan({ id: '3R', subtype: 'Underline' })]
    expect(model.open(twins).inserts).toHaveLength(3)
    expect(model.open(twins).unchanged).toBe(3)
    expect(model.notes.size).toBe(3)
  })

  it('10. rows the user made or edited in the app are never overwritten', () => {
    const model = createSyncModel()
    // A row made in the app on exactly the same text as an embedded highlight.
    const appId = model.addAppNote({ ...highlightFromEmbeddedAnnotation(A()), colorHex: '#81C784' })
    model.open([A()])
    expect(model.notes.size).toBe(2)
    expect(model.notes.get(appId)?.colorHex).toBe('#81C784')

    // The user recolors the imported row in the app; the file changes the same annotation later.
    const importedId = [...model.ledger.values()][0]!.noteId
    model.notes.set(importedId, { ...model.notes.get(importedId)!, colorHex: '#F48FB1' })
    const plan = model.open([scan({ id: '10R', contentsObj: { str: 'Foxit edit' } })])
    expect(plan.keptAppEdits).toBe(1)
    expect(plan.updates).toHaveLength(0)
    expect(model.notes.get(importedId)?.colorHex).toBe('#F48FB1')
    expect(model.notes.get(importedId)?.note).toBe('Remember this')
  })

  it('an imported row deleted in the app is not imported again', () => {
    const model = createSyncModel()
    model.open([A(), B()])
    const importedId = [...model.ledger.values()][0]!.noteId
    model.notes.delete(importedId)
    const plan = model.open([A(), B()])
    expect(plan.dismissed).toBe(1)
    expect(plan.inserts).toHaveLength(0)
    expect(model.notes.size).toBe(1)
    // Still "managed": the app keeps the deleted mark off the canvas too.
    expect(plan.managed).toEqual([0, 1])
  })
})
