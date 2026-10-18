/**
 * Pure geometry + styling helpers for highlight / underline / strikethrough / textbox marks drawn
 * by epub.js (marks-pane). Stateless — the per-book mark bookkeeping stays in `openEpubjs`.
 */
import { splitHighlightColor, type HighlightStyleKind } from '@reading-book/book-reader-sdk'
import type { ViewportRectLike } from './types'

/**
 * Converts a rect measured inside the EPUB iframe's own document (unscaled) to outer-document
 * viewport coordinates. `ReaderZoomViewport` applies `transform: scale(z)` to the iframe, so
 * `iframe.getBoundingClientRect()` (measured from the outer document) already reflects zoom
 * while a `Range`/`Selection` rect measured inside the iframe does not — naively adding the two
 * only lines up at 100% zoom. Deriving the scale from the iframe's own rendered size vs. its
 * `contentWindow.innerWidth/Height` corrects for any zoom level.
 */
export function toOuterRect(
  localRect: DOMRect,
  iframe: HTMLIFrameElement,
  win: Window,
): ViewportRectLike {
  const iframeRect = iframe.getBoundingClientRect()
  const scaleX = win.innerWidth > 0 ? iframeRect.width / win.innerWidth : 1
  const scaleY = win.innerHeight > 0 ? iframeRect.height / win.innerHeight : 1
  return {
    left: iframeRect.left + localRect.left * scaleX,
    top: iframeRect.top + localRect.top * scaleY,
    right: iframeRect.left + localRect.right * scaleX,
    bottom: iframeRect.top + localRect.bottom * scaleY,
    width: localRect.width * scaleX,
    height: localRect.height * scaleY,
  }
}

/** Historical fixed opacity per style kind — kept as the fallback for rows saved before the
 *  alpha picker existed, whose `colorHex` is plain 6-digit hex with no encoded alpha. */
const LEGACY_ALPHA: Record<HighlightStyleKind, number> = {
  underline: 0.9,
  strikethrough: 0.9,
  squiggly: 0.9,
  replace: 0.9,
  insert: 0.9,
  highlight: 0.35,
  textbox: 1,
}

/**
 * epub.js/marks-pane only know 3 annotation types — `"highlight"`, `"underline"`, `"mark"`
 * (see `Annotation.attach()`/`detach()` in epubjs/src/annotations.js, which hardcode exactly
 * those 3 and silently no-op on anything else). Our `HighlightStyleKind` has 2 more:
 * `strikethrough` / `squiggly` / `replace` / `insert` reuse the `underline` mark's rect+line geometry
 * (the line is moved, zigzagged or dashed afterward — see `restyleLineMarks`); `textbox` uses the `mark` type,
 * which places a plain positioned element (styled as a 📝 icon via `a[ref="epubjs-mk"]` in
 * index.css) instead of drawing over the text at all.
 */
export function epubAnnotationTypeFor(styleKind: HighlightStyleKind): 'highlight' | 'underline' | 'mark' {
  if (styleKind === 'textbox') return 'mark'
  return styleKind === 'highlight' ? 'highlight' : 'underline'
}

/** Kinds drawn with the underline mark's rect+line geometry, then restyled / repositioned by
 *  `restyleLineMarks` (marks-controller.ts). */
export function isLineMarkKind(styleKind: HighlightStyleKind): boolean {
  return styleKind !== 'highlight' && styleKind !== 'textbox'
}

export function styleAttrsFor(styleKind: HighlightStyleKind, colorHex: string): Record<string, string> {
  const { hex6, alpha } = splitHighlightColor(colorHex, LEGACY_ALPHA[styleKind])
  return styleKind === 'highlight'
    ? { fill: hex6, 'fill-opacity': String(alpha), 'mix-blend-mode': 'multiply' }
    : { stroke: hex6, 'stroke-opacity': String(alpha), 'mix-blend-mode': 'multiply' }
}

/** Hit-test against each of a mark's own line-box children — mirrors marks-pane's own
 *  `Mark.getClientRects()` override (marks-pane/src/marks.js), which is NOT the native
 *  `Element.getClientRects()` (that returns just the group's single bounding box for SVG).
 *  Testing the group's bounding box alone would false-positive in the gap between two wrapped
 *  lines of a multi-line highlight. */
export function pointInMarkElement(element: SVGElement, outerX: number, outerY: number): boolean {
  let child = element.firstChild
  while (child) {
    if (child instanceof Element) {
      const r = child.getBoundingClientRect()
      if (outerX >= r.left && outerX <= r.right && outerY >= r.top && outerY <= r.bottom) {
        return true
      }
    }
    child = child.nextSibling
  }
  return false
}

/** Point-in-rect test for a `textbox` note's plain `<a>` icon (epub.js `mark()`, not an SVG
 *  group) — a single small element, unlike a highlight's per-line rects, so its own bounding
 *  box is all that's needed. */
export function pointInIconElement(element: Element, outerX: number, outerY: number): boolean {
  const r = element.getBoundingClientRect()
  return outerX >= r.left && outerX <= r.right && outerY >= r.top && outerY <= r.bottom
}

type MarkStore = Record<string, { element: SVGElement } | undefined>
type IconStore = Record<string, { element: HTMLElement } | undefined>
export type MarkedView = { highlights?: MarkStore; underlines?: MarkStore; marks?: IconStore }
