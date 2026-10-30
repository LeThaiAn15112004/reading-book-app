import { describe, expect, it } from 'vitest'
import {
  TXT_SECTION_CHARS,
  parseAnnotationFile,
  renderReadableMarkdown,
  type AnnotationFile,
  type TransferAnnotation,
} from '../../src/annotation-transfer/index.js'

const SHA = 'a'.repeat(64)
const base = (over: Partial<TransferAnnotation>): TransferAnnotation => ({
  sourceId: 'x',
  type: 'highlight',
  locator: { kind: 'cfi', cfi: 'epubcfi(/6/2)', chapterIndex: 2 },
  colorHex: '#FFEB3B',
  createdAt: '2026-10-20T13:01:12.000Z',
  origin: 'app',
  ...over,
})
const fileOf = (format: AnnotationFile['book']['format'], annotations: TransferAnnotation[], author: string | null = 'Paulo Coelho'): AnnotationFile => ({
  fileVersion: 1,
  exportedBy: 'Readmate 1',
  exportedAt: '2026-10-28T02:15:00.000Z',
  book: { title: 'Nhà Giả Kim', author: author ?? undefined, format, sha256: SHA },
  annotations,
})
const render = (file: AnnotationFile, headingOf?: (a: TransferAnnotation) => string | undefined) =>
  renderReadableMarkdown(file, { utcOffsetMinutes: 0, headingOf })

describe('renderReadableMarkdown', () => {
  it('writes the title, the count, a heading per chapter, the quote, the kind, the colour name, the time and the comment', () => {
    const md = render(
      fileOf('epub', [
        base({ selectionText: { highlight: 'Khi bạn muốn một điều gì, cả vũ trụ sẽ hợp lực giúp bạn đạt được.' }, note: 'Câu chủ đề của cuốn sách' }),
        base({ type: 'strikethrough', colorHex: '#F48FB1', locator: { kind: 'cfi', cfi: 'epubcfi(/6/8)', chapterIndex: 4 }, selectionText: { highlight: 'đã quá muộn' }, createdAt: '2026-10-22T03:00:00.000Z' }),
      ]),
    )
    expect(md).toBe(
      [
        '# Nhà Giả Kim — Paulo Coelho',
        'Exported 2026-10-28 · 2 annotations',
        '',
        '## Chapter 3',
        '',
        '> Khi bạn muốn một điều gì, cả vũ trụ sẽ hợp lực giúp bạn đạt được.',
        '',
        '**Highlight** · Yellow · 2026-10-20 13:01',
        'Note: Câu chủ đề của cuốn sách',
        '',
        '## Chapter 5',
        '',
        '> ~~đã quá muộn~~',
        '',
        '**Strikethrough** · Pink · 2026-10-22 03:00',
        '',
      ].join('\n'),
    )
  })

  it('uses the caller\'s headings (EPUB chapter titles) and groups consecutive annotations under one heading', () => {
    const md = render(
      fileOf('epub', [base({ selectionText: { highlight: 'a' } }), base({ selectionText: { highlight: 'b' } }), base({ locator: { kind: 'cfi', cfi: 'x', chapterIndex: 3 }, selectionText: { highlight: 'c' } })]),
      (a) => (a.locator.kind === 'cfi' && a.locator.chapterIndex === 2 ? 'Chương Một' : undefined),
    )
    expect(md.match(/^## /gm)).toHaveLength(2)
    expect(md).toContain('## Chương Một')
    expect(md).toContain('## Chapter 4')
  })

  it('PDF: page headings, shapes and typewriter notes without a quote', () => {
    const md = render(
      fileOf('pdf', [
        base({ type: 'rectangle', colorHex: '#1E88E5CC', locator: { kind: 'page-rect', page: 3 } }),
        base({ type: 'typewriter', note: '  Dòng đầu\n   dòng hai  ', locator: { kind: 'page-rect', page: 5 } }),
        base({ locator: { kind: 'page-rect', page: 12 }, selectionText: { highlight: 'đoạn trong PDF' }, note: 'a\nb' }),
      ]),
    )
    expect(md).toContain('## Page 3\n\n> [Rectangle on page 3]\n\n**Rectangle** · #1E88E5CC · 2026-10-20 13:01')
    expect(md).toContain('## Page 5\n\n>   Dòng đầu\n>    dòng hai  \n\n**Typewriter note** · Yellow')
    expect(md).not.toMatch(/Typewriter note\*\* .*\nNote:/)
    expect(md).toContain('Note: a  \nb')
  })

  it('TXT and Markdown: sections by position', () => {
    const txt = render(
      fileOf('txt', [
        base({ locator: { kind: 'text-offset', offset: 10, blockId: 'txt' }, selectionText: { highlight: 'đầu' } }),
        base({ locator: { kind: 'text-offset', offset: TXT_SECTION_CHARS + 1, blockId: 'txt' }, selectionText: { highlight: 'sau' } }),
      ]),
    )
    expect(txt).toContain('## Section 1')
    expect(txt).toContain('## Section 2')
    const md = render(fileOf('md', [base({ locator: { kind: 'text-offset', offset: 0, blockId: 'md', chapterIndex: 4 }, mdAnnotation: { startSegment: 4 }, selectionText: { highlight: 'Cách tra cứu' } })]))
    expect(md).toContain('## Section 5')
  })

  it('keeps a multi-line quote together and strikes every line through', () => {
    const md = render(fileOf('epub', [base({ type: 'strikethrough', selectionText: { highlight: 'dòng một\n\ndòng hai' } })]))
    expect(md).toContain('> ~~dòng một~~\n>\n> ~~dòng hai~~')
  })

  it('names a mark with no text and omits an empty comment', () => {
    const md = render(fileOf('epub', [base({ type: 'insert', note: '' })]))
    expect(md).toContain('> [Insert text in chapter 3]')
    expect(md).not.toContain('Note:')
  })

  it('handles a book without an author, one annotation, and an unparseable time', () => {
    const md = render(fileOf('epub', [base({ selectionText: { highlight: 'q' }, createdAt: 'not a date' })], null))
    expect(md.startsWith('# Nhà Giả Kim\nExported 2026-10-28 · 1 annotation\n')).toBe(true)
    expect(md).toContain('· not a date')
  })

  it('preserves Vietnamese text exactly (no escaping, no normalisation)', () => {
    const quote = 'Tiếng Việt: “Nguyễn Du” — ế, ộ, ữ, ự, ằ, Đ'
    const nfd = 'Tiếng Việt'.normalize('NFD')
    const md = render(fileOf('epub', [base({ selectionText: { highlight: quote }, note: `${nfd} ghi chú` })]))
    expect(md).toContain(`> ${quote}`)
    expect(md).toContain(`Note: ${nfd} ghi chú`)
  })

  it('renders what the importer would read: a parsed file renders the same as the file it was written from', () => {
    const original = fileOf('epub', [base({ selectionText: { highlight: 'quote' }, note: 'n' })])
    const parsed = parseAnnotationFile(JSON.stringify(original))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(render(parsed.file)).toBe(render(original))
  })

  it('is not an annotations file: the importer refuses the readable copy', () => {
    const md = render(fileOf('epub', [base({ selectionText: { highlight: 'q' } })]))
    expect(parseAnnotationFile(md)).toEqual({ ok: false, errorCode: 'damaged' })
  })
})

describe('renderReadableMarkdown — PDF file attachments (specs/007 research R14)', () => {
  const onPage = (sourceId: string, page: number, quote: string): TransferAnnotation =>
    base({ sourceId, locator: { kind: 'page-rect', page, chapterIndex: page - 1 }, selectionText: { highlight: quote } })
  const attachment = (name: string, page: number, sizeBytes: number) => ({ name, sizeBytes, page, createdAt: '2026-10-20T13:01:12.000Z' })

  it('lists each attachment as `📎 name (size), page n` under its page, after that page’s annotations', () => {
    const md = renderReadableMarkdown(fileOf('pdf', [onPage('h2', 2, 'trang hai'), onPage('h4', 4, 'trang bốn')]), {
      utcOffsetMinutes: 0,
      attachments: [attachment('đầu.txt', 1, 12), attachment('hai.docx', 2, 1536), attachment('cuối.zip', 5, 3 * 1024 * 1024)],
    })
    expect(md).toBe(
      [
        '# Nhà Giả Kim — Paulo Coelho',
        'Exported 2026-10-28 · 2 annotations · 3 file attachments',
        '',
        '## Page 1',
        '',
        '📎 đầu.txt (12 B), page 1',
        '',
        '## Page 2',
        '',
        '> trang hai',
        '',
        '**Highlight** · Yellow · 2026-10-20 13:01',
        '',
        '📎 hai.docx (1.5 KB), page 2',
        '',
        '## Page 4',
        '',
        '> trang bốn',
        '',
        '**Highlight** · Yellow · 2026-10-20 13:01',
        '',
        '## Page 5',
        '',
        '📎 cuối.zip (3.0 MB), page 5',
        '',
      ].join('\n'),
    )
  })

  it('a PDF with only attachments still gets a readable copy; without attachments the output is unchanged', () => {
    const only = renderReadableMarkdown(fileOf('pdf', []), { utcOffsetMinutes: 0, attachments: [attachment('a.txt', 3, 5)] })
    expect(only).toContain('· 0 annotations · 1 file attachment\n')
    expect(only).toContain('## Page 3\n\n📎 a.txt (5 B), page 3\n')
    const file = fileOf('pdf', [onPage('h1', 1, 'x')])
    expect(renderReadableMarkdown(file, { utcOffsetMinutes: 0, attachments: [] })).toBe(renderReadableMarkdown(file, { utcOffsetMinutes: 0 }))
  })
})
