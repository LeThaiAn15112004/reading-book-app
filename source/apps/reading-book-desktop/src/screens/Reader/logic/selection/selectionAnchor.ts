import type { PendingSelection } from '@reading-book/shared/models'

export type SelectionAnchorPoint = { x: number; y: number }

/** Place the floating toolbar next to the right-click cursor; fall back to selection. */
export function anchorFromSelectionRect(
  selection: PendingSelection,
  cursor: SelectionAnchorPoint,
): SelectionAnchorPoint {
  if (Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
    return { x: cursor.x + 4, y: cursor.y + 4 }
  }
  const { rect } = selection
  if (!rect || rect.width <= 0) return cursor
  return {
    x: rect.left + rect.width / 2 - 120,
    y: Math.max(12, rect.top - 8),
  }
}
