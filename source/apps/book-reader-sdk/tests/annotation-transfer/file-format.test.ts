import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FILE_VERSION, parseAnnotationFile, serializeAnnotationFile } from '../../src/annotation-transfer/index.js'

const SHA = 'a'.repeat(64)
const base = () => ({
  fileVersion: 1,
  exportedBy: 'Readmate 1.0.0',
  exportedAt: '2026-10-28T09:15:00+07:00',
  book: { title: 'Nhà Giả Kim', author: 'Paulo Coelho', format: 'epub', sha256: SHA },
  annotations: [
    {
      sourceId: 'a1',
      type: 'highlight',
      locator: { kind: 'cfi', cfi: 'epubcfi(/6/14!/4/2/6,/1:0,/1:63)', chapterIndex: 6 },
      selectionText: { highlight: 'Khi bạn muốn một điều gì' },
      note: 'Câu chủ đề',
      colorHex: '#FFEB3B',
      createdAt: '2026-10-20T20:01:12+07:00',
      origin: 'app',
    },
  ],
})

describe('parseAnnotationFile', () => {
  it('accepts the documented sample file', () => {
    const sample = readFileSync(
      new URL('../../../../../specs/006-annotation-import-export/samples/sample-epub.readmate-notes.json', import.meta.url),
      'utf-8',
    )
    const r = parseAnnotationFile(sample)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.file.annotations).toHaveLength(1)
      expect(r.rejected).toHaveLength(0)
    }
  })

  it('rejects truncated text as damaged', () => {
    const text = JSON.stringify(base())
    expect(parseAnnotationFile(text.slice(0, text.length - 20))).toEqual({ ok: false, errorCode: 'damaged' })
  })

  it('tells our file from another JSON file', () => {
    expect(parseAnnotationFile('{}')).toEqual({ ok: false, errorCode: 'not_annotation_file' })
    expect(parseAnnotationFile('[1,2]')).toEqual({ ok: false, errorCode: 'not_annotation_file' })
    expect(parseAnnotationFile('# Title\n> quote')).toEqual({ ok: false, errorCode: 'damaged' })
  })

  it('refuses a file written by a newer version', () => {
    expect(parseAnnotationFile(JSON.stringify({ ...base(), fileVersion: FILE_VERSION + 1 }))).toEqual({
      ok: false,
      errorCode: 'newer_version',
    })
  })

  it('refuses empty annotations and a bad header', () => {
    const damaged = { ok: false, errorCode: 'damaged' }
    expect(parseAnnotationFile(JSON.stringify({ ...base(), annotations: [] }))).toEqual(damaged)
    expect(parseAnnotationFile(JSON.stringify({ ...base(), book: { ...base().book, format: 'docx' } }))).toEqual(damaged)
    expect(parseAnnotationFile(JSON.stringify({ ...base(), book: { ...base().book, sha256: 'xyz' } }))).toEqual(damaged)
    expect(parseAnnotationFile(JSON.stringify({ ...base(), book: { ...base().book, pageCount: 0 } }))).toEqual(damaged)
  })

  it('keeps an optional PDF pageCount', () => {
    const r = parseAnnotationFile(JSON.stringify({ ...base(), book: { ...base().book, format: 'pdf', pageCount: 120 } }))
    expect(r.ok && r.file.book.pageCount).toBe(120)
  })

  it('rejects single bad annotations without failing the file', () => {
    const f = base()
    const first = f.annotations[0]!
    f.annotations.push(
      { ...first, sourceId: 'b', type: 'scribble' },
      { ...first, sourceId: 'c', colorHex: 'yellow' },
      { ...first, sourceId: 'd', locator: { kind: 'page-rect', page: 0 } as never },
    )
    const r = parseAnnotationFile(JSON.stringify(f))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.file.annotations).toHaveLength(1)
      expect(r.rejected.map((x) => x.reason)).toEqual(['unknown annotation type', 'invalid colour', 'invalid location'])
      expect(r.rejected[0]!.quote).toBe('Khi bạn muốn một điều gì')
    }
  })

  it('accepts shape colours with alpha and the location kinds', () => {
    const f = base()
    const first = f.annotations[0]!
    f.annotations = [
      { ...first, sourceId: 'p', type: 'rectangle', colorHex: '#1E88E5CC', locator: { kind: 'page-rect', page: 3 } as never },
      { ...first, sourceId: 't', locator: { kind: 'text-offset', offset: 10, blockId: 'txt' } as never },
    ]
    const r = parseAnnotationFile(JSON.stringify(f))
    expect(r.ok && r.file.annotations).toHaveLength(2)
  })

  it('round-trips Vietnamese text and surrounding spaces unchanged', () => {
    const f = base()
    f.annotations[0]!.note = '  Ghi chú: “đoạn” có dấu — ế, ộ, ữ  '
    f.annotations[0]!.selectionText = { highlight: 'Tiếng Việt: Nguyễn Du — Truyện Kiều' }
    const parsed = parseAnnotationFile(JSON.stringify(f))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const again = parseAnnotationFile(serializeAnnotationFile(parsed.file))
    expect(again.ok && again.file.annotations[0]!.note).toBe('  Ghi chú: “đoạn” có dấu — ế, ộ, ữ  ')
    expect(again.ok && again.file.annotations[0]!.selectionText?.highlight).toBe('Tiếng Việt: Nguyễn Du — Truyện Kiều')
  })

  it('ignores a UTF-8 byte order mark', () => {
    expect(parseAnnotationFile(`﻿${JSON.stringify(base())}`).ok).toBe(true)
  })
})
