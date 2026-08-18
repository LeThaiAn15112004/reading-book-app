/**
 * Reading-surface hit targets — aligned with CSS cursor rules in `cursors.ts`.
 */

/** Tags that show I-beam in hand mode (must stay in sync with injected EPUB CSS). */
export const TEXT_CURSOR_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'td',
  'th',
  'blockquote',
  'pre',
  'code',
  'span',
  'em',
  'strong',
  'i',
  'b',
  'u',
  's',
  'mark',
  'label',
  'figcaption',
  'dt',
  'dd',
  'cite',
  'q',
  'small',
  'sub',
  'sup',
].join(', ')

const INTERACTIVE_SELECTOR =
  'a[href], button, [role="button"], summary, input, textarea, select, [contenteditable="true"]'

type CaretPoint = { node: Node; offset: number }

/**
 * Resolve caret node/offset at a viewport point.
 * Prefers standard `caretPositionFromPoint`; falls back to legacy WebKit API.
 */
function caretPointFromPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): CaretPoint | null {
  const pos = doc.caretPositionFromPoint?.(clientX, clientY)
  if (pos?.offsetNode) {
    return { node: pos.offsetNode, offset: pos.offset }
  }

  // Legacy Chromium/WebKit — keep runtime fallback without using the deprecated
  // `Document.caretRangeFromPoint` TypeScript signature.
  const legacyCaretRangeFromPoint = (
    doc as unknown as {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
  ).caretRangeFromPoint
  const range = legacyCaretRangeFromPoint?.call(doc, clientX, clientY) ?? null
  if (range?.startContainer) {
    return { node: range.startContainer, offset: range.startOffset }
  }

  return null
}

/** True when the element would receive the I-beam cursor in hand mode. */
export function isTextCursorTarget(el: Element | null): boolean {
  if (!el) return false
  if (el.closest(INTERACTIVE_SELECTOR)) return false
  return !!el.closest(TEXT_CURSOR_SELECTOR)
}

/** I-beam zone at viewport coords — matches CSS cursor, not just caret proximity. */
export function isTextCursorTargetAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): boolean {
  const el = doc.elementFromPoint(clientX, clientY)
  return isTextCursorTarget(el)
}

/**
 * Targets that may switch away from grab after a hover dwell in Hand mode
 * (text → I-beam, links/annotations → pointer).
 */
export function isHandHoverCursorTargetAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): boolean {
  const el = doc.elementFromPoint(clientX, clientY)
  if (!el) return false
  if (el.closest(INTERACTIVE_SELECTOR)) return true
  if (el.closest('[data-rb-hl-id]')) return true
  if (el.closest('[data-rb-tw-note], [data-rb-tw-draft]')) return true
  return isTextCursorTarget(el)
}

/**
 * Hover dwell before Hand mode shows I-beam/pointer over text or annotations.
 * Keeps grab while the pointer skims across text during a pan.
 */
export const HAND_HOVER_CURSOR_DELAY_MS = 300

/**
 * Detect whether a viewport point lands on readable text (not empty margin).
 * Used when native caret placement matters (selection menu, empty-click on text).
 */
export function isTextNodeAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): boolean {
  const caret = caretPointFromPoint(doc, clientX, clientY)
  if (caret?.node.nodeType !== Node.TEXT_NODE) return false
  return (caret.node.textContent?.trim().length ?? 0) > 0
}

/**
 * True when the viewport point lands inside the document's current text selection
 * (used so the floating toolbar only opens on right-click over the selection).
 */
export function isPointInTextSelection(
  doc: Document,
  clientX: number,
  clientY: number,
): boolean {
  const sel = doc.defaultView?.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false
  if (!(sel.toString()?.trim().length ?? 0)) return false

  let range: Range
  try {
    range = sel.getRangeAt(0)
  } catch {
    return false
  }

  const caret = caretPointFromPoint(doc, clientX, clientY)
  if (caret) {
    try {
      if (typeof range.isPointInRange === 'function') {
        return range.isPointInRange(caret.node, caret.offset)
      }
      return range.comparePoint(caret.node, caret.offset) === 0
    } catch {
      // Fall through to rect hit-test (cross-boundary edge cases).
    }
  }

  const rects = range.getClientRects()
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return true
    }
  }
  return false
}

export const PAN_DRAG_THRESHOLD_PX = 4
