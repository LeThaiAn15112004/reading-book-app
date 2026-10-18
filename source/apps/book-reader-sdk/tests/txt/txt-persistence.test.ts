import { describe, expect, it } from 'vitest'
import {
  committedTxtState,
  createTxtDocument,
  createTxtPersistedState,
  editTxtDocument,
  addTxtHighlight,
  parseTxtAnnotationRef,
  planTxtCommit,
  removeTxtHighlight,
  resolveTxtReadingOffset,
  txtHighlightToWire,
  txtReadingLocation,
  txtReadingPercent,
  txtReadingProgress,
  updateTxtHighlight,
} from '../../src/txt/index.js'
import { Location, PageRectLocation, TextOffsetLocation } from '../../src/domain/index.js'
import { highlightOf, SAMPLE_TEXT } from './txt-fixtures.js'

describe('planTxtCommit', () => {
  const a = highlightOf(SAMPLE_TEXT, 'needle')
  const b = highlightOf(SAMPLE_TEXT, 'Khởi đầu')

  it('is empty when nothing changed since the last commit', () => {
    const persisted = createTxtPersistedState(SAMPLE_TEXT, 0, [a, b])
    const plan = planTxtCommit(persisted, { text: SAMPLE_TEXT, highlights: [a, b] })
    expect(plan).toEqual({ textChanged: false, upserts: [], deletedIds: [], empty: true })
  })

  it('upserts new rows, rewrites changed ones and deletes missing ones', () => {
    const persisted = createTxtPersistedState(SAMPLE_TEXT, 3, [a, b])
    const c = highlightOf(SAMPLE_TEXT, 'hết')
    const recoloured = { ...a, colorHex: '#00ff00' }
    const plan = planTxtCommit(persisted, { text: SAMPLE_TEXT, highlights: [recoloured, c] })
    expect(plan.textChanged).toBe(false)
    expect(plan.upserts.map((h) => h.id)).toEqual([a.id, c.id])
    expect(plan.deletedIds).toEqual([b.id])
    expect(plan.empty).toBe(false)
  })

  it('flags a text change, and rows that only moved are rewritten (their offsets are part of the row)', () => {
    const persisted = createTxtPersistedState(SAMPLE_TEXT, 0, [a, b])
    const doc = createTxtDocument(SAMPLE_TEXT, [a, b])
    const edited = editTxtDocument(doc, { start: 0, deleteLength: 0, insert: '>> ' }, {
      now: 0,
      selectionBefore: { start: 0, end: 0 },
      selectionAfter: { start: 3, end: 3 },
    }).doc
    const plan = planTxtCommit(persisted, edited)
    expect(plan.textChanged).toBe(true)
    expect(plan.upserts.map((h) => h.id)).toEqual([a.id, b.id])
    expect(plan.deletedIds).toEqual([])
  })

  it('an annotation created and removed between two commits writes nothing', () => {
    const persisted = createTxtPersistedState(SAMPLE_TEXT, 0, [])
    let doc = createTxtDocument(SAMPLE_TEXT)
    doc = addTxtHighlight(doc, a)
    doc = removeTxtHighlight(doc, a.id)
    expect(planTxtCommit(persisted, doc).empty).toBe(true)
  })

  it('a note edit changes the signature; applying the commit makes the plan empty again', () => {
    const persisted = createTxtPersistedState(SAMPLE_TEXT, 0, [a])
    const doc = updateTxtHighlight(createTxtDocument(SAMPLE_TEXT, [a]), a.id, { note: 'remember' }, 'T')
    const plan = planTxtCommit(persisted, doc)
    expect(plan.upserts).toHaveLength(1)
    const committed = committedTxtState(doc, 1)
    expect(committed.revision).toBe(1)
    expect(committed.text).toBe(SAMPLE_TEXT)
    expect(planTxtCommit(committed, doc).empty).toBe(true)
  })

  it('a failed commit leaves the persisted state alone, so the next plan still contains everything', () => {
    const persisted = createTxtPersistedState(SAMPLE_TEXT, 0, [a])
    let doc = createTxtDocument(SAMPLE_TEXT, [a])
    doc = editTxtDocument(doc, { start: 0, deleteLength: 0, insert: 'x' }, {
      now: 0,
      selectionBefore: { start: 0, end: 0 },
      selectionAfter: { start: 1, end: 1 },
    }).doc
    const first = planTxtCommit(persisted, doc)
    // …the save failed; the user keeps typing…
    doc = editTxtDocument(doc, { start: 1, deleteLength: 0, insert: 'y' }, {
      now: 10,
      selectionBefore: { start: 1, end: 1 },
      selectionAfter: { start: 2, end: 2 },
    }).doc
    const second = planTxtCommit(persisted, doc)
    expect(first.textChanged && second.textChanged).toBe(true)
    expect(second.upserts[0]!.startOffset).toBe(a.startOffset + 2)
  })
})

describe('txtHighlightToWire', () => {
  it('carries the offsets as txtAnnotationRef and the quote as selectionTextRef', () => {
    const wire = txtHighlightToWire(highlightOf(SAMPLE_TEXT, 'needle', { note: 'n', tags: ['x'] }))
    expect(parseTxtAnnotationRef(wire.txtAnnotationRef)).toEqual({
      startOffset: SAMPLE_TEXT.indexOf('needle'),
      endOffset: SAMPLE_TEXT.indexOf('needle') + 6,
    })
    expect(JSON.parse(wire.selectionTextRef!).highlight).toBe('needle')
    expect(wire).toMatchObject({ styleKind: 'highlight', note: 'n', tags: ['x'] })
  })
})

describe('reading position', () => {
  it('round-trips through the saved JSON', () => {
    const saved = txtReadingLocation(1234, 5000).toString()
    expect(JSON.parse(saved)).toEqual({ kind: 'text-offset', offset: 1234, blockId: 'txt' })
    expect(resolveTxtReadingOffset(saved, 5000)).toBe(1234)
  })

  it('clamps an offset past the end (the text got shorter)', () => {
    expect(resolveTxtReadingOffset(txtReadingLocation(900, 1000).toString(), 300)).toBe(300)
    expect(txtReadingLocation(9000, 100).offset).toBe(100)
  })

  it('starts at the top for anything that is not a TXT location', () => {
    expect(resolveTxtReadingOffset(undefined, 100)).toBe(0)
    expect(resolveTxtReadingOffset(null, 100)).toBe(0)
    expect(resolveTxtReadingOffset('', 100)).toBe(0)
    expect(resolveTxtReadingOffset('not json', 100)).toBe(0)
    expect(resolveTxtReadingOffset(new PageRectLocation(4).toString(), 100)).toBe(0)
    expect(resolveTxtReadingOffset(new PageRectLocation(4), 100)).toBe(0)
    expect(resolveTxtReadingOffset('{"kind":"cfi","cfi":"epubcfi(/6/2)"}', 100)).toBe(0)
  })

  it('accepts a parsed Location too', () => {
    expect(resolveTxtReadingOffset(new TextOffsetLocation(42, 'txt'), 100)).toBe(42)
    expect(resolveTxtReadingOffset(Location.parse(new TextOffsetLocation(7).toString()), 100)).toBe(7)
  })

  it('progress and percent', () => {
    expect(txtReadingProgress(50, 200)).toBe(0.25)
    expect(txtReadingPercent(50, 200)).toBe(25)
    expect(txtReadingProgress(0, 0)).toBe(0)
    expect(txtReadingProgress(500, 200)).toBe(1)
    expect(txtReadingPercent(1, 3)).toBe(33)
  })
})
