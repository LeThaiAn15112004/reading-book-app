import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ICON_PT,
  attachmentIconBox,
  clampAttachmentBox,
  describeAttachFailure,
  formatAttachmentSize,
  parsePdfAttachmentInfo,
  type AttachFailure,
} from '../../src/attachments/pdf-attachment-annotation.js'
import { ATTACHMENT_MAX_BYTES } from '../../src/attachments/attachment-policy.js'
import { isConsistentPdfAttachment, parsePdfAnnotation } from '../../src/app-models/pdf-highlight.js'

const SHA = 'a'.repeat(64)
const INFO = { name: 'report.docx', sizeBytes: 1234, sha256: SHA }
const BOX = { x: 0.1, y: 0.2, width: 0.03, height: 0.025 }

describe('parsePdfAttachmentInfo', () => {
  it('accepts a valid payload, with or without modifiedAt', () => {
    expect(parsePdfAttachmentInfo(INFO)).toEqual(INFO)
    const withDate = { ...INFO, modifiedAt: '2026-10-29T08:00:00.000Z' }
    expect(parsePdfAttachmentInfo(withDate)).toEqual(withDate)
  })

  it.each([
    ['not an object', 'x'],
    ['empty name', { ...INFO, name: '' }],
    ['a path as name', { ...INFO, name: '../evil.exe' }],
    ['an unsanitised name', { ...INFO, name: 'a<b>.txt' }],
    ['size 0', { ...INFO, sizeBytes: 0 }],
    ['size over the limit', { ...INFO, sizeBytes: ATTACHMENT_MAX_BYTES + 1 }],
    ['fractional size', { ...INFO, sizeBytes: 1.5 }],
    ['uppercase hash', { ...INFO, sha256: 'A'.repeat(64) }],
    ['short hash', { ...INFO, sha256: 'a'.repeat(63) }],
    ['bad date', { ...INFO, modifiedAt: 'yesterday' }],
  ])('refuses %s', (_label, value) => {
    expect(parsePdfAttachmentInfo(value)).toBeNull()
  })

  it('accepts exactly the size limit', () => {
    expect(parsePdfAttachmentInfo({ ...INFO, sizeBytes: ATTACHMENT_MAX_BYTES })).not.toBeNull()
  })
})

describe('parsePdfAnnotation with an attachment', () => {
  it('keeps the attachment on a one-box annotation', () => {
    const parsed = parsePdfAnnotation({ pageIndex: 2, rects: [BOX], attachment: INFO })
    expect(parsed?.attachment).toEqual(INFO)
    expect(parsed?.rects).toEqual([BOX])
  })

  it('refuses several boxes, a shape, a typewriter doc, a caret or a bad payload', () => {
    expect(parsePdfAnnotation({ pageIndex: 0, rects: [BOX, BOX], attachment: INFO })).toBeUndefined()
    expect(parsePdfAnnotation({ pageIndex: 0, rects: [BOX], attachment: INFO, shape: { strokeWidth: 0.01 } })).toBeUndefined()
    expect(parsePdfAnnotation({ pageIndex: 0, rects: [BOX], attachment: INFO, caret: true })).toBeUndefined()
    expect(parsePdfAnnotation({ pageIndex: 0, rects: [BOX], attachment: { ...INFO, sizeBytes: -1 } })).toBeUndefined()
  })

  it('ties style kind attachment to the payload', () => {
    const withInfo = parsePdfAnnotation({ pageIndex: 0, rects: [BOX], attachment: INFO })
    const without = parsePdfAnnotation({ pageIndex: 0, rects: [BOX] })
    expect(isConsistentPdfAttachment('attachment', withInfo)).toBe(true)
    expect(isConsistentPdfAttachment('attachment', without)).toBe(false)
    expect(isConsistentPdfAttachment('textbox', withInfo)).toBe(false)
    expect(isConsistentPdfAttachment('textbox', without)).toBe(true)
  })
})

describe('icon box', () => {
  const letter = { width: 612, height: 792 }

  it('is 20 × 20 PDF units with its top-left at the click', () => {
    const box = attachmentIconBox({ x: 0.5, y: 0.5 }, letter)
    expect(box.x).toBe(0.5)
    expect(box.y).toBe(0.5)
    expect(box.width * letter.width).toBeCloseTo(ATTACHMENT_ICON_PT)
    expect(box.height * letter.height).toBeCloseTo(ATTACHMENT_ICON_PT)
  })

  it.each([
    ['top-left', { x: 0, y: 0 }],
    ['top-right', { x: 1, y: 0 }],
    ['bottom-left', { x: 0, y: 1 }],
    ['bottom-right', { x: 1, y: 1 }],
    ['outside', { x: -0.3, y: 1.7 }],
  ])('stays wholly inside the page at the %s corner', (_label, point) => {
    const box = attachmentIconBox(point, letter)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(1)
    expect(box.y + box.height).toBeLessThanOrEqual(1)
    expect(box.width * letter.width).toBeCloseTo(ATTACHMENT_ICON_PT)
  })

  it('uses the displayed (rotated) page size', () => {
    const landscape = { width: 792, height: 612 }
    const box = attachmentIconBox({ x: 0.2, y: 0.2 }, landscape)
    expect(box.width * landscape.width).toBeCloseTo(ATTACHMENT_ICON_PT)
    expect(box.height * landscape.height).toBeCloseTo(ATTACHMENT_ICON_PT)
  })

  it('clamp keeps the size and handles NaN', () => {
    expect(clampAttachmentBox({ x: 0.99, y: Number.NaN, width: 0.05, height: 0.05 })).toEqual({ x: 0.95, y: 0, width: 0.05, height: 0.05 })
  })
})

describe('describeAttachFailure', () => {
  const MB = 1024 * 1024
  it('gives the actual size with one decimal and the limit (spec US4 example)', () => {
    const size = Math.round(150.2 * MB)
    expect(describeAttachFailure({ code: 'too_large', sizeBytes: size, limitBytes: ATTACHMENT_MAX_BYTES, fileName: 'video.mp4' })).toBe(
      '“video.mp4” is 150.2 MB — the limit is 100 MB. Nothing was attached.',
    )
    expect(describeAttachFailure({ code: 'too_large', sizeBytes: ATTACHMENT_MAX_BYTES + 1, limitBytes: ATTACHMENT_MAX_BYTES })).toBe(
      'This file is 100.0 MB — the limit is 100 MB. Nothing was attached.',
    )
  })
  it('says an empty file is empty and names it', () => {
    expect(describeAttachFailure({ code: 'empty', fileName: 'blank.txt' })).toBe('“blank.txt” is empty (0 bytes), so there is nothing to attach. Nothing was attached.')
  })
  it('the combined limit gives both sizes', () => {
    const text = describeAttachFailure({ code: 'too_large_for_pdf', sizeBytes: 90 * MB, pdfSizeBytes: 200 * MB, limitBytes: 250 * MB, fileName: 'a.bin' })
    expect(text).toContain('90.0 MB')
    expect(text).toContain('200.0 MB')
    expect(text).toContain('250 MB')
  })
  it('follows the action for refusals of a move / delete', () => {
    expect(describeAttachFailure({ code: 'blocked', reason: 'read_only' }, 'move')).toBe(
      'Readmate can’t move this attachment: the PDF file or its folder is read-only. Nothing was moved.',
    )
    expect(describeAttachFailure({ code: 'blocked', reason: 'signed' }, 'delete')).toContain('can’t delete this attachment: the PDF is digitally signed')
    expect(describeAttachFailure({ code: 'not_found' }, 'delete')).toBe('This attachment is no longer in the PDF.')
  })
  it('has a message for every result code but a cancelled picker, and never names PDF / Foxit / Acrobat as the source of the limit', () => {
    const all: AttachFailure[] = [
      { code: 'blocked', reason: 'managed_copy' },
      { code: 'blocked', reason: 'changed' },
      { code: 'empty' },
      { code: 'read_failed', fileName: 'x' },
      { code: 'source_changed' },
      { code: 'too_large', sizeBytes: 2e8, limitBytes: ATTACHMENT_MAX_BYTES },
      { code: 'too_large_for_pdf', sizeBytes: 1, pdfSizeBytes: 2, limitBytes: 3 },
      { code: 'write_failed', errno: 'ENOSPC' },
      { code: 'write_failed', errno: 'EIO' },
      { code: 'verify_failed' },
      { code: 'unsupported_pdf' },
      { code: 'encrypted' },
      { code: 'not_found' },
      { code: 'not_editable' },
      { code: 'invalid_request' },
      { code: 'busy' },
    ]
    for (const failure of all) {
      for (const action of ['attach', 'move', 'delete'] as const) {
        const text = describeAttachFailure(failure, action)
        expect(text, failure.code).toBeTruthy()
        expect(text).not.toMatch(/Foxit|Acrobat|PDF (limit|allows)|limit of (the )?PDF/i)
      }
    }
    expect(describeAttachFailure({ code: 'cancelled' })).toBeNull()
    expect(describeAttachFailure({ code: 'write_failed', errno: 'ENOSPC' })).toContain('not enough disk space')
  })
  it('formats sizes in B / KB / MB with one decimal', () => {
    expect(formatAttachmentSize(0)).toBe('0 B')
    expect(formatAttachmentSize(1536)).toBe('1.5 KB')
    expect(formatAttachmentSize(ATTACHMENT_MAX_BYTES)).toBe('100.0 MB')
  })
})
