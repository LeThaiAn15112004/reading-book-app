import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_ICON_PT,
  attachmentIconBox,
  clampAttachmentBox,
  parsePdfAttachmentInfo,
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
