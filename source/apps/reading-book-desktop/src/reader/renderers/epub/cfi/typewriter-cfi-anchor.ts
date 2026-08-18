/**
 * EPUB typewriter anchor — CFI point + pixel offset (T5.6d).
 */

import type { EpubFrameSelectionContext } from '../openEpubjs'
import {
  parseTypewriterLocation,
  type TypewriterLocation,
} from '@reading-book/shared/models'
import { cfiChapterSignature } from '@reading-book/shared/utils'
import { resolveCfiBoundary } from './cfi-dom-range'

export type TypewriterHostPoint = {
  left: number
  top: number
  usedCfi: boolean
}

export type TypewriterCaptureResult = {
  cfi: string
  offsetPx: { x: number; y: number }
  xPct: number
  yPct: number
} | null

function caretRangeAtPoint(
  doc: Document,
  x: number,
  y: number,
): Range | null {
  const extended = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }
  try {
    if (extended.caretRangeFromPoint) {
      return extended.caretRangeFromPoint(x, y)
    }
    const pos = extended.caretPositionFromPoint?.(x, y)
    if (!pos) return null
    const range = doc.createRange()
    range.setStart(pos.offsetNode, pos.offset)
    range.collapse(true)
    return range
  } catch {
    return null
  }
}

function boundaryClientPoint(
  doc: Document,
  cfi: string,
): { x: number; y: number } | null {
  const boundary = resolveCfiBoundary(doc, cfi)
  if (!boundary) return null
  const range = doc.createRange()
  try {
    range.setStart(boundary.node, boundary.offset)
    range.collapse(true)
  } catch {
    return null
  }
  const rect = range.getBoundingClientRect()
  if (!rect.width && !rect.height) {
    return { x: rect.left, y: rect.top }
  }
  return { x: rect.left, y: rect.top }
}

/** Capture CFI + offset at an iframe-local click. */
export function captureTypewriterAnchor(input: {
  doc: Document
  ctx: EpubFrameSelectionContext
  /** Client coords relative to the iframe viewport. */
  iframeClientX: number
  iframeClientY: number
  iframeRect: DOMRect
}): TypewriterCaptureResult {
  const { doc, ctx, iframeClientX, iframeClientY, iframeRect } = input
  const width = iframeRect.width || 1
  const height = iframeRect.height || 1
  const xPct = Math.min(
    100,
    Math.max(0, (iframeClientX / width) * 100),
  )
  const yPct = Math.min(
    100,
    Math.max(0, (iframeClientY / height) * 100),
  )

  const range = caretRangeAtPoint(doc, iframeClientX, iframeClientY)
  if (!range) {
    return null
  }

  const cfi = ctx.cfiFromRange(range)?.trim() ?? ''
  if (!cfi) {
    return null
  }

  const origin = boundaryClientPoint(doc, cfi)
  const offsetPx = origin
    ? {
        x: iframeClientX - origin.x,
        y: iframeClientY - origin.y,
      }
    : { x: 0, y: 0 }

  return { cfi, offsetPx, xPct, yPct }
}

/** Viewport client coords for a click inside an iframe. */
export function iframeViewportClientPoint(
  iframeRect: DOMRect,
  iframeLocalX: number,
  iframeLocalY: number,
): { clientX: number; clientY: number } {
  return {
    clientX: iframeRect.left + iframeLocalX,
    clientY: iframeRect.top + iframeLocalY,
  }
}

function hostPointFromPct(
  xPct: number,
  yPct: number,
  iframeHostBox: { left: number; top: number; width: number; height: number },
): TypewriterHostPoint {
  return {
    left: iframeHostBox.left + (xPct / 100) * iframeHostBox.width,
    top: iframeHostBox.top + (yPct / 100) * iframeHostBox.height,
    usedCfi: false,
  }
}

function bodyOriginRect(doc: Document): DOMRect | null {
  const body = doc.body
  if (!body) return null
  return body.getBoundingClientRect()
}

/** Body-relative px for painting a typewriter box inside the EPUB iframe. */
export function resolveTypewriterIframePoint(input: {
  locationRaw: string
  doc: Document | null | undefined
  /** Fallback size when only xPct/yPct is available (iframe client box). */
  iframeSize: { width: number; height: number }
}): TypewriterHostPoint | null {
  const loc = parseTypewriterLocation(input.locationRaw)
  if (!loc) return null

  if (loc.anchor === 'cfi-offset' && input.doc) {
    const origin = boundaryClientPoint(input.doc, loc.cfi)
    const bodyRect = bodyOriginRect(input.doc)
    if (origin && bodyRect) {
      return {
        left: origin.x - bodyRect.left + loc.offsetPx.x,
        top: origin.y - bodyRect.top + loc.offsetPx.y,
        usedCfi: true,
      }
    }
  }

  const width = input.iframeSize.width || 1
  const height = input.iframeSize.height || 1
  return {
    left: (loc.xPct / 100) * width,
    top: (loc.yPct / 100) * height,
    usedCfi: false,
  }
}

/** Click → body-relative px inside the iframe document. */
export function iframeClientToBodyPoint(
  doc: Document,
  iframeClientX: number,
  iframeClientY: number,
): { left: number; top: number } | null {
  const bodyRect = bodyOriginRect(doc)
  if (!bodyRect) return null
  return {
    left: iframeClientX - bodyRect.left,
    top: iframeClientY - bodyRect.top,
  }
}

/**
 * Resolve host-overlay coordinates (legacy) for a textbox on the current EPUB section.
 * Prefer {@link resolveTypewriterIframePoint} for in-iframe paint.
 */
export function resolveTypewriterHostPoint(input: {
  locationRaw: string
  doc: Document | null | undefined
  iframeRect: DOMRect
  iframeHostBox: { left: number; top: number; width: number; height: number }
}): TypewriterHostPoint | null {
  const loc = parseTypewriterLocation(input.locationRaw)
  if (!loc) return null

  if (loc.anchor === 'cfi-offset' && input.doc) {
    const origin = boundaryClientPoint(input.doc, loc.cfi)
    if (origin) {
      return {
        left:
          input.iframeHostBox.left + origin.x + loc.offsetPx.x,
        top: input.iframeHostBox.top + origin.y + loc.offsetPx.y,
        usedCfi: true,
      }
    }
  }

  return hostPointFromPct(loc.xPct, loc.yPct, input.iframeHostBox)
}

export function typewriterBelongsToRenderedSection(
  locationRaw: string,
  renderedCfiBase: string | undefined,
): boolean {
  if (!renderedCfiBase?.trim()) return true
  const loc = parseTypewriterLocation(locationRaw)
  if (!loc) return true
  if (loc.anchor !== 'cfi-offset') return true
  const rendered = cfiChapterSignature(renderedCfiBase)
  const noteSig = cfiChapterSignature(loc.cfi)
  if (!rendered || !noteSig) return true
  return rendered === noteSig
}

export function buildCfiOffsetLocation(input: {
  cfi: string
  offsetPx: { x: number; y: number }
  xPct: number
  yPct: number
}): TypewriterLocation {
  return {
    v: 2,
    anchor: 'cfi-offset',
    cfi: input.cfi.trim(),
    offsetPx: input.offsetPx,
    xPct: input.xPct,
    yPct: input.yPct,
  }
}
