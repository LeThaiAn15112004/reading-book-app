import {
  useCallback,
  useEffect,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { clampPanelPosition, type PanelPosition } from './panelGeometry'

type Size = { width: number; height: number }

export type UseDraggablePanelOptions = {
  panelRef: RefObject<HTMLDivElement | null>
  open: boolean
  position: PanelPosition | null
  dragging: boolean
  /** Fresh read at drag-move time, so the pointermove listener doesn't need to rebind per pixel
   *  (same reasoning as the getState() reads this used to do against a single hardcoded store). */
  getPosition: () => PanelPosition | null
  setPosition: (position: PanelPosition | null) => void
  setDragging: (dragging: boolean) => void
}

/**
 * Drag mechanics for a floating chrome panel's header (see `ReaderSearchPanel`, `WordCountPanel`)
 * — native Pointer Events with capture. The panel is positioned `absolute` against its own
 * `offsetParent`, which is `ReaderShell`'s root box: already mounted below the app's
 * titlebar/menubar/tabs, so plain container-relative `top`/`left` math (no viewport math) is what
 * keeps it correctly bounded to "the application view" and never dragged outside it — including
 * across a window resize, via the effect below.
 *
 * Store-agnostic: the position/dragging VALUES live in whichever store the caller passes in (one
 * shared store per floating panel, per the project's convention for reader UI state), not local
 * `useState`/`useRef`.
 */
export function useDraggablePanel({
  panelRef,
  open,
  position,
  dragging,
  getPosition,
  setPosition,
  setDragging,
}: UseDraggablePanelOptions): {
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  dragging: boolean
  /** Inline style override once dragged; undefined lets the panel's default CSS anchor apply. */
  style: CSSProperties | undefined
} {
  // Re-clamp whenever the panel (re)opens and on every window resize while it's open — a
  // position dragged in a larger window, or restored from a previous session, must not leave
  // the panel partly off-screen after the app shrinks.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const container = panel?.offsetParent as HTMLElement | null
    if (!panel || !container) return

    const reclamp = () => {
      const current = getPosition()
      if (!current) return
      const clamped = clampPanelPosition(
        current,
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: container.clientWidth, height: container.clientHeight },
      )
      if (clamped.left !== current.left || clamped.top !== current.top) {
        setPosition(clamped)
      }
    }

    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [open, panelRef, getPosition, setPosition])

  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // Let clicks on real controls in the header (the Close button) behave normally.
      if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [data-no-drag]')) {
        return
      }
      const panel = panelRef.current
      const container = panel?.offsetParent as HTMLElement | null
      if (!panel || !container) return

      event.preventDefault()
      const handle = event.currentTarget
      const pointerId = event.pointerId
      const panelRect = panel.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const panelSize: Size = { width: panelRect.width, height: panelRect.height }
      const startLeft = panelRect.left - containerRect.left
      const startTop = panelRect.top - containerRect.top
      const startX = event.clientX
      const startY = event.clientY

      setDragging(true)
      try {
        handle.setPointerCapture(pointerId)
      } catch {
        /* ignore — older hosts / already captured */
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const containerSize: Size = { width: container.clientWidth, height: container.clientHeight }
        setPosition(
          clampPanelPosition(
            {
              left: startLeft + (moveEvent.clientX - startX),
              top: startTop + (moveEvent.clientY - startY),
            },
            panelSize,
            containerSize,
          ),
        )
      }

      let cleaned = false
      const endDrag = () => {
        if (cleaned) return
        cleaned = true
        setDragging(false)
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
        endDrag()
      }

      const onLostCapture = (lostEvent: Event) => {
        const pe = lostEvent as PointerEvent
        if (typeof pe.pointerId === 'number' && pe.pointerId !== pointerId) return
        endDrag()
      }

      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
      handle.addEventListener('lostpointercapture', onLostCapture)
    },
    [panelRef, setPosition, setDragging],
  )

  return {
    onHeaderPointerDown,
    dragging,
    style: position ? { top: position.top, left: position.left, right: 'auto' } : undefined,
  }
}
