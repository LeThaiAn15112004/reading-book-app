import { describe, expect, it } from 'vitest'
import {
  contentKeyOfNote,
  decidePlacement,
  parseAnnotationFile,
  planImport,
  type AnnotationFile,
  type TransferAnnotation,
} from '../../src/annotation-transfer/index.js'
import type { INoteState } from '../../src/domain/index.js'

const SHA = 'd'.repeat(64)
const R = { x: 0.1, y: 0.2, width: 0.3, height: 0.02 }

const epub = (id: string, over: Partial<TransferAnnotation> = {}): TransferAnnotation => ({
  sourceId: id,
  type: 'highlight',
  locator: { kind: 'cfi', cfi: `epubcfi(/6/${id})`, chapterIndex: 1 },
  selectionText: { highlight: `quote ${id}` },
  note: `comment ${id}`,
  colorHex: '#FFEB3B',
  createdAt: '2026-10-20T00:00:00Z',
  origin: 'app',
  ...over,
})

const pdf = (id: string, page: number, over: Partial<TransferAnnotation> = {}): TransferAnnotation => ({
  sourceId: id,
  type: 'highlight',
  locator: { kind: 'page-rect', page },
  selectionText: { highlight: `pdf ${id}` },
  colorHex: '#FFEB3B',
  createdAt: '2026-10-20T00:00:00Z',
  origin: 'app',
  pdfAnnotation: { pageIndex: page - 1, rects: [R] },
  ...over,
})

const fileOf = (format: AnnotationFile['book']['format'], annotations: TransferAnnotation[]): AnnotationFile => ({
  fileVersion: 1,
  exportedBy: 'Readmate 1',
  exportedAt: '2026-10-28T00:00:00Z',
  book: { title: 'T', format, sha256: SHA },
  annotations,
})

const plan = (file: AnnotationFile, over: Partial<Parameters<typeof planImport>[0]> = {}) =>
  planImport({ file, rejected: [], existingKeys: new Set(), placement: 'exact', isUsableId: () => true, ...over })

/** The stored row an annotation becomes (what `contentKeyOfNote` reads back). */
const rowOf = (a: TransferAnnotation): INoteState =>
  ({
    schemaVersion: 1,
    type: a.type,
    locatorExtended: { locator: a.locator, text: a.selectionText },
    note: a.note ?? null,
    pdfAnnotation: a.pdfAnnotation,
    txtAnnotation: a.txtAnnotation,
    mdAnnotation: a.mdAnnotation,
  }) as unknown as INoteState

describe('planImport', () => {
  it('adds everything into an empty book, keeping the source ids when they are free', () => {
    const p = plan(fileOf('epub', [epub('1'), epub('2')]))
    expect(p.toAdd.map((a) => [a.sourceId, a.id])).toEqual([['1', '1'], ['2', '2']])
    expect(p.present).toBe(0)
    expect(p.notPlaced).toEqual([])
  })

  it('skips what the book already holds: a second import adds nothing (SC-003)', () => {
    const file = fileOf('epub', [epub('1'), epub('2')])
    const existing = new Set(file.annotations.map((a) => contentKeyOfNote(rowOf(a))!))
    const p = plan(file, { existingKeys: existing })
    expect(p.toAdd).toEqual([])
    expect(p.present).toBe(2)
  })

  it('mixes new, present and not placed', () => {
    const a = epub('1')
    const bad = pdf('x', 2, { pdfAnnotation: { pageIndex: 1, rects: [] } })
    const file = fileOf('pdf', [pdf('p1', 2), pdf('p2', 3), bad])
    const existing = new Set([contentKeyOfNote(rowOf(file.annotations[0]!))!])
    const p = plan(file, { existingKeys: existing })
    expect(p.toAdd.map((x) => x.sourceId)).toEqual(['p2'])
    expect(p.present).toBe(1)
    expect(p.notPlaced).toEqual([{ type: 'highlight', quote: 'pdf x', reason: 'invalid PDF annotation' }])
    expect(a.sourceId).toBe('1')
  })

  it('recognises the same content under a different id as present', () => {
    const existing = new Set([contentKeyOfNote(rowOf(epub('old', { locator: { kind: 'cfi', cfi: 'epubcfi(/6/1)' }, selectionText: { highlight: 'quote 1' }, note: 'comment 1' })))!])
    const p = plan(fileOf('epub', [epub('1')]), { existingKeys: existing })
    expect(p.present).toBe(1)
    expect(p.toAdd).toEqual([])
  })

  it('counts an identical annotation repeated in the file once', () => {
    const p = plan(fileOf('epub', [epub('1'), epub('1b', { locator: { kind: 'cfi', cfi: 'epubcfi(/6/1)', chapterIndex: 1 }, selectionText: { highlight: 'quote 1' }, note: 'comment 1' })]))
    expect(p.toAdd).toHaveLength(1)
    expect(p.present).toBe(1)
  })

  it('gives a fresh id (null) when the source id exists in any book, and never reuses one twice', () => {
    const p = plan(fileOf('epub', [epub('1'), epub('2')]), { isUsableId: (id) => id !== '1' })
    expect(p.toAdd.map((a) => a.id)).toEqual([null, '2'])
    const dup = plan(fileOf('epub', [epub('s', { note: 'a' }), epub('s', { note: 'b' })]))
    expect(dup.toAdd.map((a) => a.id)).toEqual(['s', null])
  })

  it('treats a PDF annotation read from the file as present when the target scan holds it', () => {
    const fromFile = pdf('f', 3, { origin: 'file', sourceKeys: ['nm1:2:abc#0'] })
    const p = plan(fileOf('pdf', [fromFile, pdf('a', 4)]), { scanKeys: new Set(['nm1:2:abc#0']) })
    expect(p.toAdd.map((a) => a.sourceId)).toEqual(['a'])
    expect(p.present).toBe(1)
    // not in the scan -> it is imported like any other row
    expect(plan(fileOf('pdf', [fromFile]), { scanKeys: new Set() }).toAdd).toHaveLength(1)
  })

  it('re-validates the per-format payloads and reports bad ones as not placed', () => {
    const txt = (id: string, start: number, end: number, offset = start): TransferAnnotation => ({
      sourceId: id, type: 'highlight', colorHex: '#FFEB3B', createdAt: '2026-10-20T00:00:00Z', origin: 'app',
      locator: { kind: 'text-offset', offset, blockId: 'txt' }, txtAnnotation: { startOffset: start, endOffset: end },
    })
    const p = plan(fileOf('txt', [txt('ok', 1, 5), txt('empty', 5, 5), txt('moved', 1, 5, 2)]))
    expect(p.toAdd.map((a) => a.sourceId)).toEqual(['ok'])
    expect(p.notPlaced.map((n) => n.reason)).toEqual(['invalid text range', 'text location does not match its range'])
    const md = (id: string, locatorSegment: number): TransferAnnotation => ({
      sourceId: id, type: 'highlight', colorHex: '#FFEB3B', createdAt: '2026-10-20T00:00:00Z', origin: 'app',
      locator: { kind: 'text-offset', offset: 0, blockId: 'md', chapterIndex: locatorSegment },
      mdAnnotation: { startSegment: 4, startOffset: 0, endSegment: 4, endOffset: 38 },
    })
    const q = plan(fileOf('md', [md('ok', 4), md('bad', 3)]))
    expect(q.toAdd.map((a) => a.sourceId)).toEqual(['ok'])
    expect(q.notPlaced[0]!.reason).toBe('Markdown location does not match its anchor')
    // an EPUB file whose annotation carries a page location
    expect(plan(fileOf('epub', [pdf('w', 2)])).notPlaced[0]!.reason).toBe('location does not belong to an EPUB')
  })

  it('carries the annotations the parser rejected into not placed', () => {
    const text = JSON.stringify({ ...fileOf('epub', [epub('1'), { ...epub('2'), colorHex: 'red' }]) })
    const parsed = parseAnnotationFile(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const p = plan(parsed.file, { rejected: parsed.rejected })
    expect(p.toAdd).toHaveLength(1)
    expect(p.notPlaced).toEqual([{ type: 'highlight', quote: 'quote 2', reason: 'invalid colour' }])
  })

  it('keeps typewriter text and the quote exactly', () => {
    const tw: TransferAnnotation = { ...pdf('t', 1), type: 'typewriter', selectionText: undefined, note: '  hai dòng\n  ba  ' }
    const p = plan(fileOf('pdf', [tw]))
    expect(p.toAdd[0]!.note).toBe('  hai dòng\n  ba  ')
  })
})

describe('contentKeyOfNote', () => {
  it('is null for a row without a location and equal for the same stored content', () => {
    expect(contentKeyOfNote({ schemaVersion: 1, type: 'highlight' } as unknown as INoteState)).toBeNull()
    const a = epub('1')
    expect(contentKeyOfNote(rowOf(a))).toBe(contentKeyOfNote({ ...rowOf(a), note: 'comment 1' } as unknown as INoteState))
  })
})

describe('placement', () => {
  const target = { title: 'Sổ tay', author: 'An', format: 'pdf', sha256: 'e'.repeat(64), pageCount: 10 }
  const header = (over: Partial<AnnotationFile['book']> = {}, txt?: AnnotationFile['txt']) => ({
    book: { title: 'Sổ tay', author: 'An', format: 'pdf' as const, sha256: SHA, pageCount: 10, ...over },
    txt,
  })

  it('identical bytes are exact for every format', () => {
    expect(decidePlacement(header({ sha256: target.sha256 }), target)).toBe('exact')
    expect(decidePlacement(header({ format: 'epub', sha256: target.sha256 }), { ...target, format: 'epub' })).toBe('exact')
    expect(decidePlacement(header({ format: 'md', sha256: target.sha256 }), { ...target, format: 'md' })).toBe('exact')
  })

  it('a PDF that is the same document with equal known page counts is placed by page position', () => {
    expect(decidePlacement(header(), target)).toBe('pdf-page-position')
    expect(decidePlacement(header({ title: 'SỔ  TAY' }), target)).toBe('pdf-page-position')
  })

  it('a PDF is not placed when a page count is missing, differs, or the document differs', () => {
    expect(decidePlacement(header({ pageCount: undefined }), target)).toBe('none')
    expect(decidePlacement(header(), { ...target, pageCount: undefined })).toBe('none')
    expect(decidePlacement(header({ pageCount: 11 }), target)).toBe('none')
    expect(decidePlacement(header({ title: 'Khác' }), target)).toBe('none')
    expect(decidePlacement(header({ author: 'Bình' }), target)).toBe('none')
  })

  it('EPUB and Markdown of a different edition, and another format, are never placed', () => {
    expect(decidePlacement(header({ format: 'epub' }), { ...target, format: 'epub' })).toBe('none')
    expect(decidePlacement(header({ format: 'md' }), { ...target, format: 'md' })).toBe('none')
    expect(decidePlacement(header({ sha256: target.sha256 }), { ...target, format: 'epub' })).toBe('none')
  })

  it('TXT: exact when the edited-text fingerprint (or the unedited original) matches, else re-anchored by quote', () => {
    const t = { title: 'T', format: 'txt', sha256: target.sha256 }
    expect(decidePlacement(header({ format: 'txt', sha256: target.sha256 }), t)).toBe('exact')
    expect(decidePlacement(header({ format: 'txt', sha256: target.sha256 }), { ...t, txtContentSha256: 'a'.repeat(64) })).toBe('txt-quote')
    expect(decidePlacement(header({ format: 'txt' }, { contentSha256: 'a'.repeat(64) }), { ...t, txtContentSha256: 'a'.repeat(64) })).toBe('exact')
    expect(decidePlacement(header({ format: 'txt' }, { contentSha256: 'a'.repeat(64) }), { ...t, txtContentSha256: 'b'.repeat(64) })).toBe('txt-quote')
    expect(decidePlacement(header({ format: 'txt' }), { ...t, sha256: 'c'.repeat(64) })).toBe('txt-quote')
  })

  it('planImport: none reports everything as a different edition; page position drops pages beyond the document', () => {
    const file = fileOf('pdf', [pdf('p3', 3), pdf('p20', 20)])
    const none = plan(file, { placement: 'none' })
    expect(none.toAdd).toEqual([])
    expect(none.notPlaced.map((n) => n.reason)).toEqual(['different edition of the book', 'different edition of the book'])
    const byPage = plan(file, { placement: 'pdf-page-position', targetPageCount: 10 })
    expect(byPage.toAdd.map((a) => a.sourceId)).toEqual(['p3'])
    expect(byPage.notPlaced.map((n) => n.reason)).toEqual(['page is beyond the end of the target document'])
    expect(plan(file, { placement: 'pdf-page-position' }).toAdd).toEqual([])
  })
})

describe('TXT quote re-anchoring (placement txt-quote)', () => {
  const TEXT = 'Chương 1\nTrăm năm trong cõi người ta.\nChữ tài chữ mệnh khéo là ghét nhau.\nTrăm năm là bao lâu?\n'
  const txt = (id: string, quote: string | undefined, start: number, ctx: { before?: string; after?: string } = {}): TransferAnnotation => ({
    sourceId: id, type: 'highlight', colorHex: '#FFEB3B', createdAt: '2026-10-20T00:00:00Z', origin: 'app', note: `n ${id}`,
    locator: { kind: 'text-offset', offset: start, blockId: 'txt' },
    txtAnnotation: { startOffset: start, endOffset: start + (quote?.length ?? 1) },
    selectionText: quote === undefined ? undefined : { highlight: quote, ...ctx },
  })
  const place = (annotations: TransferAnnotation[], over: Partial<Parameters<typeof planImport>[0]> = {}) =>
    plan(fileOf('txt', annotations), { placement: 'txt-quote', targetText: TEXT, ...over })

  it('moves an annotation to where its quote is in the new text and keeps everything else', () => {
    const p = place([txt('a', 'Chữ tài chữ mệnh', 3)])
    const at = TEXT.indexOf('Chữ tài chữ mệnh')
    expect(p.toAdd).toHaveLength(1)
    const a = p.toAdd[0]!
    expect(a.txtAnnotation).toEqual({ startOffset: at, endOffset: at + 'Chữ tài chữ mệnh'.length })
    expect(a.locator).toEqual({ kind: 'text-offset', offset: at, blockId: 'txt' })
    expect(a.note).toBe('n a')
    expect(TEXT.slice(a.txtAnnotation!.startOffset, a.txtAnnotation!.endOffset)).toBe('Chữ tài chữ mệnh')
  })

  it('uses the stored context for a quote that occurs twice, and reports the rest as not placed', () => {
    const p = place([
      txt('first', 'Trăm năm', 0, { after: ' trong cõi' }),
      txt('second', 'Trăm năm', 0, { before: 'ghét nhau.\n' }),
      txt('amb', 'Trăm năm', 0),
      txt('gone', 'câu không còn nữa', 0),
      txt('noquote', undefined, 0),
    ])
    expect(p.toAdd.map((a) => a.sourceId)).toEqual(['first', 'second'])
    expect(p.toAdd.map((a) => a.txtAnnotation!.startOffset)).toEqual([TEXT.indexOf('Trăm năm'), TEXT.lastIndexOf('Trăm năm')])
    expect(p.notPlaced.map((n) => n.reason)).toEqual([
      'its text was not found exactly once in this edition',
      'its text was not found exactly once in this edition',
      'it has no quote to match',
    ])
  })

  it('treats a re-anchored annotation that the book already holds as present', () => {
    const at = TEXT.indexOf('Chữ tài chữ mệnh')
    const same = txt('moved', 'Chữ tài chữ mệnh', at)
    const existing = new Set([contentKeyOfNote(rowOf(same))!])
    const p = place([txt('moved', 'Chữ tài chữ mệnh', 3)], { existingKeys: existing })
    expect(p.present).toBe(1)
    expect(p.toAdd).toEqual([])
  })

  it('places nothing when the target text is missing', () => {
    expect(place([txt('a', 'Trăm năm trong', 0)], { targetText: undefined }).toAdd).toEqual([])
  })
})
