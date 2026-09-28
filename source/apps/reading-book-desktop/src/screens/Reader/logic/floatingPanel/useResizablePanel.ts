import { useCallback, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  CURSOR_BY_DIRECTION,
  clampPanelSize,
  type PanelPosition,
  type PanelSize,
  type ResizeDirection,
} from './panelGeometry'

type Size = { width: number; height: number }

/** Keep the panel's position inside `container` for the size it's being resized to. */
function clampPositionForSize(
  position: PanelPosition,
  size: Size,
  container: Size,
): PanelPosition {
  const maxLeft = Math.max(container.width - size.width, 0)
  const maxTop = Math.max(container.height - size.height, 0)
  return {
    left: Math.min(Math.max(position.left, 0), maxLeft),
    top: Math.min(Math.max(position.top, 0), maxTop),
  }
}

export type UseResizablePanelOptions = {
  panelRef: RefObject<HTMLDivElement | null>
  size: PanelSize | null
  resizing: boolean
  /** Fresh reads at resize-move time, so the pointermove listener doesn't need to rebind per pixel. */
  getPosition: () => PanelPosition | null
  setPosition: (position: PanelPosition | null) => void
  setSize: (size: PanelSize | null) => void
  setResizing: (resizing: boolean) => void
}

/**
 * Window-style resize for a floating chrome panel (see `ReaderSearchPanel`, `WordCountPanel`):
 * invisible hit-zones on all four edges and corners, native Pointer Events + capture. Dragging
 * from the north/west side also shifts the panel's position (via the same store the drag hook
 * uses) so the opposite edge stays put, the way an OS window resizes.
 *
 * Store-agnostic: the size/position VALUES live in whichever store the caller passes in.
 */
export function useResizablePanel({
  panelRef,
  size,
  resizing,
  getPosition,
  setPosition,
  setSize,
  setResizing,
}: UseResizablePanelOptions): {
  onResizePointerDown: (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => void
  resizing: boolean
  /** Inline style override once resized; undefined lets the panel's default CSS size apply. */
  style: CSSProperties | undefined
} {
  const onResizePointerDown = useCallback(
    (direction: ResizeDirection, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      const panel = panelRef.current
      const container = panel?.offsetParent as HTMLElement | null
      if (!panel || !container) return

      const handle = event.currentTarget
      const pointerId = event.pointerId
      const panelRect = panel.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const startWidth = panelRect.width
      const startHeight = panelRect.height
      const startLeft = panelRect.left - containerRect.left
      const startTop = panelRect.top - containerRect.top
      const startX = event.clientX
      const startY = event.clientY

      setResizing(true)
      try {
        handle.setPointerCapture(pointerId)
      } catch {
        /* ignore — older hosts / already captured */
      }

      // Pin the panel to an explicit left/top up front, replacing the default CSS anchor (which
      // is expressed via `right`/`top` and would otherwise silently shift the OPPOSITE edge as
      // width/height changes — e.g. widening while `right` stays fixed moves the left edge, not
      // the right one the user is actually dragging).
      if (!getPosition()) {
        setPosition({ left: startLeft, top: startTop })
      }

      const movesPosition = direction.includes('w') || direction.includes('n')

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        const containerSize: Size = { width: container.clientWidth, height: container.clientHeight }

        let width = startWidth
        let height = startHeight
        if (direction.includes('e')) width = startWidth + dx
        if (direction.includes('w')) width = startWidth - dx
        if (direction.includes('s')) height = startHeight + dy
        if (direction.includes('n')) height = startHeight - dy

        const nextSize = clampPanelSize({ width, height })
        setSize(nextSize)

        if (movesPosition) {
          const left = direction.includes('w') ? startLeft + (startWidth - nextSize.width) : startLeft
          const top = direction.includes('n') ? startTop + (startHeight - nextSize.height) : startTop
          setPosition(clampPositionForSize({ left, top }, nextSize, containerSize))
        }
      }

      let cleaned = false
      const endResize = () => {
        if (cleaned) return
        cleaned = true
        setResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
        handle.removeEventListener('lostpointercapture', onLostCapture)
        if (handle.hasPointerCapture?.(pointerId)) {
          try {
            handle.releasePointerCapture(pointerId)
          } catch {
            /* ignore */
          }
        }
      }

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return
        endResize()
      }

      const onLostCapture = (lostEvent: Event) => {
        const pe = lostEvent as PointerEvent
        if (typeof pe.pointerId === 'number' && pe.pointerId !== pointerId) return
        endResize()
      }

      document.body.style.cursor = CURSOR_BY_DIRECTION[direction]
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
      handle.addEventListener('lostpointercapture', onLostCapture)
    },
    [panelRef, getPosition, setPosition, setSize, setResizing],
  )

  return {
    onResizePointerDown,
    resizing,
    style: size ? { width: size.width, height: size.height, maxWidth: 'none' } : undefined,
  }
}
