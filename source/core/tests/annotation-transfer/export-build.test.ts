import { describe, expect, it } from 'vitest'
import {
  buildAnnotationFile,
  parseAnnotationFile,
  serializeAnnotationFile,
  type ExportRow,
  type TransferBook,
} from '../../src/annotation-transfer/index.js'
import type { INoteState } from '../../src/domain/index.js'

const SHA = 'b'.repeat(64)
const now = new Date('2026-10-28T02:15:00.000Z')

const book = (format: TransferBook['format'], extra: Partial<TransferBook> = {}): TransferBook => ({
  title: 'Nhà Giả Kim',
  author: 'Paulo Coelho',
  format,
  sha256: SHA,
  ...extra,
})

const row = (id: string, note: Partial<INoteState>, extra: Partial<ExportRow> = {}): ExportRow => ({
  id,
  createdAt: '2026-10-20T13:01:12.000Z',
  updatedAt: '2026-10-21T01:30:00.000Z',
  note: { schemaVersion: 1, type: 'highlight', style: { colorHex: '#FFEB3B' }, ...note } as INoteState,
  ...extra,
})

const build = (b: TransferBook, rows: ExportRow[], extra: { txtContentSha256?: string } = {}) =>
  buildAnnotationFile({ book: b, rows, appVersion: '1.0.0', now, ...extra })

function roundTrip(b: TransferBook, rows: ExportRow[], extra: { txtContentSha256?: string } = {}) {
  const built = build(b, rows, extra)
  if (!built.ok) throw new Error('build failed')
  const parsed = parseAnnotationFile(serializeAnnotationFile(built.file))
  if (!parsed.ok) throw new Error(`re-parse failed: ${parsed.errorCode}`)
  expect(parsed.rejected).toEqual([])
  return { built, parsed }
}

describe('buildAnnotationFile', () => {
  it('writes an EPUB highlight with its quote, comment, colour, times and CFI', () => {
    const { built, parsed } = roundTrip(book('epub'), [
      row('e1', {
        locatorExtended: {
          locator: { kind: 'cfi', cfi: 'epubcfi(/6/14!/4/2/6,/1:0,/1:63)', chapterIndex: 6 },
          text: { before: 'a ', highlight: 'Khi bạn muốn một điều gì', after: ' b' },
        },
        note: 'Câu chủ đề',
      }),
    ])
    expect(built.exported).toBe(1)
    const a = parsed.file.annotations[0]!
    expect(a).toMatchObject({
      sourceId: 'e1',
      type: 'highlight',
      colorHex: '#FFEB3B',
      note: 'Câu chủ đề',
      origin: 'app',
      createdAt: '2026-10-20T13:01:12.000Z',
      modifiedAt: '2026-10-21T01:30:00.000Z',
    })
    expect(a.locator).toEqual({ kind: 'cfi', cfi: 'epubcfi(/6/14!/4/2/6,/1:0,/1:63)', chapterIndex: 6 })
    expect(a.selectionText?.highlight).toBe('Khi bạn muốn một điều gì')
    expect(parsed.file.book).toEqual(book('epub'))
    expect(parsed.file.exportedBy).toBe('Readmate 1.0.0')
    expect(parsed.file.exportedAt).toBe(now.toISOString())
  })

  it('writes a PDF highlight with its rects, the PDF page count and no origin keys for app rows', () => {
    const pdfAnnotation = { pageIndex: 11, rects: [{ x: 0.12, y: 0.31, width: 0.55, height: 0.02 }] }
    const { parsed } = roundTrip(book('pdf', { pageCount: 120 }), [
      row('p1', { locatorExtended: { locator: { kind: 'page-rect', page: 12 }, text: { highlight: 'quote' } }, pdfAnnotation: pdfAnnotation as never }),
    ])
    const a = parsed.file.annotations[0]!
    expect(a.locator).toEqual({ kind: 'page-rect', page: 12 })
    expect(a.pdfAnnotation).toEqual(pdfAnnotation)
    expect(a.sourceKeys).toBeUndefined()
    expect(parsed.file.book.pageCount).toBe(120)
  })

  it('carries the ledger keys of a PDF annotation read from the file', () => {
    const { parsed } = roundTrip(book('pdf'), [
      row(
        'f1',
        { locatorExtended: { locator: { kind: 'page-rect', page: 2 } }, pdfAnnotation: { pageIndex: 1, rects: [{ x: 0, y: 0, width: 0.1, height: 0.1 }] } as never },
        { origin: 'file', sourceKeys: ['nm1:1:0123456789abcd#0'] },
      ),
    ])
    expect(parsed.file.annotations[0]).toMatchObject({ origin: 'file', sourceKeys: ['nm1:1:0123456789abcd#0'] })
  })

  it('writes a PDF shape with an alpha colour and no quote', () => {
    const { parsed } = roundTrip(book('pdf'), [
      row('s1', {
        type: 'rectangle',
        style: { colorHex: '#1E88E5CC' },
        locatorExtended: { locator: { kind: 'page-rect', page: 3 } },
        pdfAnnotation: { pageIndex: 2, rects: [{ x: 0.2, y: 0.4, width: 0.3, height: 0.1 }], shape: { kind: 'rectangle' } } as never,
      }),
    ])
    const a = parsed.file.annotations[0]!
    expect(a.type).toBe('rectangle')
    expect(a.colorHex).toBe('#1E88E5CC')
    expect(a.selectionText).toBeUndefined()
  })

  it('keeps typewriter text exactly, including leading and trailing spaces', () => {
    const text = '  Dòng đầu\n   dòng hai  '
    const { parsed } = roundTrip(book('pdf'), [
      row('t1', {
        type: 'typewriter',
        note: text,
        locatorExtended: { locator: { kind: 'page-rect', page: 1 } },
        pdfAnnotation: { pageIndex: 0, rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.2 }] } as never,
      }),
    ])
    expect(parsed.file.annotations[0]!.note).toBe(text)
  })

  it('writes TXT offsets and the edited text fingerprint', () => {
    const txtHash = 'c'.repeat(64)
    const { parsed } = roundTrip(
      book('txt'),
      [row('x1', { locatorExtended: { locator: { kind: 'text-offset', offset: 1042, blockId: 'txt' }, text: { highlight: 'đoạn' } }, txtAnnotation: { startOffset: 1042, endOffset: 1046 } as never })],
      { txtContentSha256: txtHash },
    )
    expect(parsed.file.annotations[0]!.txtAnnotation).toEqual({ startOffset: 1042, endOffset: 1046 })
    expect(parsed.file.txt).toEqual({ contentSha256: txtHash })
  })

  it('writes a Markdown anchor and no txt header', () => {
    const md = { startSegment: 4, startOffset: 0, endSegment: 4, endOffset: 38 }
    const { parsed } = roundTrip(
      book('md'),
      [row('m1', { locatorExtended: { locator: { kind: 'text-offset', offset: 0, blockId: 'md' }, text: { highlight: 'Cách tra cứu' } }, mdAnnotation: md as never })],
      { txtContentSha256: 'ignored' },
    )
    expect(parsed.file.annotations[0]!.mdAnnotation).toEqual(md)
    expect(parsed.file.txt).toBeUndefined()
  })

  it('orders annotations by reading position, ties by creation time', () => {
    const pdf = (id: string, page: number, y: number, createdAt = '2026-10-20T00:00:00.000Z') =>
      row(id, { locatorExtended: { locator: { kind: 'page-rect', page } }, pdfAnnotation: { pageIndex: page - 1, rects: [{ x: 0.1, y, width: 0.2, height: 0.02 }] } as never }, { createdAt })
    const { parsed } = roundTrip(book('pdf'), [pdf('c', 5, 0.2), pdf('a', 2, 0.9), pdf('b', 2, 0.1), pdf('d', 5, 0.2, '2026-10-21T00:00:00.000Z')])
    expect(parsed.file.annotations.map((x) => x.sourceId)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('refuses an empty export and skips rows it cannot represent', () => {
    expect(build(book('epub'), [])).toEqual({ ok: false, errorCode: 'empty' })
    const onlyBroken = build(book('epub'), [row('z', {}), row('y', { type: 'ink' as never, locatorExtended: { locator: { kind: 'cfi', cfi: 'x' } } })])
    expect(onlyBroken).toEqual({ ok: false, errorCode: 'empty' })
    const mixed = build(book('epub'), [row('z', {}), row('ok', { locatorExtended: { locator: { kind: 'cfi', cfi: 'epubcfi(/6/2)' } } })])
    expect(mixed.ok && mixed.exported).toBe(1)
    expect(mixed.ok && mixed.skipped).toBe(1)
  })

  it('falls back to the default colour when a row has none', () => {
    const { parsed } = roundTrip(book('epub'), [row('n', { style: undefined, locatorExtended: { locator: { kind: 'cfi', cfi: 'epubcfi(/6/2)' } } })])
    expect(parsed.file.annotations[0]!.colorHex).toBe('#FFEB3B')
  })
})

describe('buildAnnotationFile — PDF file attachments (specs/007 research R14)', () => {
  const attachmentRow = (id: string, page: number, name: string, sizeBytes: number, createdAt = '2026-10-20T13:01:12.000Z') =>
    row(
      id,
      {
        type: 'attachment',
        style: { colorHex: '#1E88E5' },
        locatorExtended: { locator: { kind: 'page-rect', page, chapterIndex: page - 1 } },
        pdfAnnotation: {
          pageIndex: page - 1,
          rects: [{ pageIndex: page - 1, x: 0.1, y: 0.1, width: 0.03, height: 0.03 }],
          attachment: { name, sizeBytes, sha256: 'c'.repeat(64) },
        },
      } as unknown as Partial<INoteState>,
      { createdAt },
    )
  const highlightOn = (id: string, page: number) =>
    row(id, {
      locatorExtended: { locator: { kind: 'page-rect', page, chapterIndex: page - 1 } },
      pdfAnnotation: { pageIndex: page - 1, rects: [{ pageIndex: page - 1, x: 0.1, y: 0.3, width: 0.5, height: 0.02 }] },
    } as unknown as Partial<INoteState>)

  it('leaves attachment rows out of the restorable file and lists them, in page order, for the readable copy', () => {
    const { built, parsed } = roundTrip(book('pdf'), [attachmentRow('a2', 3, 'later.pdf', 2048), highlightOn('h1', 2), attachmentRow('a1', 1, 'Tài liệu.docx', 1536)])
    if (!built.ok) throw new Error('unreachable')
    expect(parsed.file.annotations.map((a) => a.sourceId)).toEqual(['h1'])
    expect(JSON.stringify(built.file)).not.toContain('attachment')
    expect(built.exported).toBe(1)
    expect(built.skipped).toBe(0)
    expect(built.attachments).toEqual([
      { name: 'Tài liệu.docx', sizeBytes: 1536, page: 1, createdAt: '2026-10-20T13:01:12.000Z' },
      { name: 'later.pdf', sizeBytes: 2048, page: 3, createdAt: '2026-10-20T13:01:12.000Z' },
    ])
  })

  it('a book with only attachments still builds (for the readable copy), with no annotation in the file', () => {
    const built = build(book('pdf'), [attachmentRow('a1', 1, 'only.txt', 10)])
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.exported).toBe(0)
    expect(built.file.annotations).toEqual([])
    expect(built.attachments).toHaveLength(1)
  })

  it('an unreadable attachment row is skipped, never exported', () => {
    const broken = row('bad', { type: 'attachment', locatorExtended: { locator: { kind: 'page-rect', page: 1, chapterIndex: 0 } } } as unknown as Partial<INoteState>)
    const built = build(book('pdf'), [broken, highlightOn('h1', 1)])
    if (!built.ok) throw new Error('build failed')
    expect(built.skipped).toBe(1)
    expect(built.attachments).toEqual([])
  })
})
