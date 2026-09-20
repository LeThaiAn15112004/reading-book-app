import type { ViewportRectLike } from '../../../../reader/renderers/epub'

const GAP_PX = 8
const EDGE_MARGIN_PX = 8

/**
 * Clamped `{top, left}` for a fixed-position popover anchored above `anchorRect` (falling back
 * to below it when there isn't room), horizontally centered on the anchor and kept fully inside
 * the viewport.
 */
export function highlightPopoverPosition(
  anchorRect: ViewportRectLike,
  popoverSize: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const centerX = (anchorRect.left + anchorRect.right) / 2
  let left = centerX - popoverSize.width / 2
  left = Math.max(EDGE_MARGIN_PX, Math.min(left, viewport.width - popoverSize.width - EDGE_MARGIN_PX))

  const above = anchorRect.top - popoverSize.height - GAP_PX
  const top =
    above >= EDGE_MARGIN_PX ? above : Math.min(anchorRect.bottom + GAP_PX, viewport.height - popoverSize.height - EDGE_MARGIN_PX)

  return { top: Math.max(EDGE_MARGIN_PX, top), left }
}
