/**
 * Detect whether a viewport point lands on readable text (not empty margin).
 * Used by Hand ↔ Text Select smart switching.
 */
export function isTextNodeAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): boolean {
  const caretRange =
    typeof doc.caretRangeFromPoint === 'function'
      ? doc.caretRangeFromPoint(clientX, clientY)
      : null

  if (caretRange?.startContainer.nodeType === Node.TEXT_NODE) {
    return (caretRange.startContainer.textContent?.trim().length ?? 0) > 0
  }

  const caretPos = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null
    }
  ).caretPositionFromPoint?.(clientX, clientY)

  if (caretPos?.offsetNode?.nodeType === Node.TEXT_NODE) {
    return (caretPos.offsetNode.textContent?.trim().length ?? 0) > 0
  }

  return false
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

  const caretRange =
    typeof doc.caretRangeFromPoint === 'function'
      ? doc.caretRangeFromPoint(clientX, clientY)
      : null
  if (caretRange?.startContainer) {
    try {
      if (typeof range.isPointInRange === 'function') {
        return range.isPointInRange(
          caretRange.startContainer,
          caretRange.startOffset,
        )
      }
      const cmp = range.comparePoint(
        caretRange.startContainer,
        caretRange.startOffset,
      )
      return cmp === 0
    } catch {
      // Fall through to rect hit-test (cross-boundary edge cases).
    }
  }

  const caretPos = (
    doc as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null
    }
  ).caretPositionFromPoint?.(clientX, clientY)
  if (caretPos?.offsetNode) {
    try {
      if (typeof range.isPointInRange === 'function') {
        return range.isPointInRange(caretPos.offsetNode, caretPos.offset)
      }
      return range.comparePoint(caretPos.offsetNode, caretPos.offset) === 0
    } catch {
      // Fall through.
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
