import { useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { appApi } from '../../../../bridge'
import { useSnapshotStore, type SnapshotPoint } from '../snapshot/snapshotStore'

/** Smallest drag (viewport CSS px, either axis) that counts as a real selection — filters out an
 *  accidental click from cancelling the tool outright; the user just stays armed to retry. */
const MIN_SELECTION_SIZE = 6

export type SnapshotRect = { x: number; y: number; width: number; height: number }

function rectFrom(start: SnapshotPoint, current: SnapshotPoint): SnapshotRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  }
}

type UseSnapshotToolOptions = {
  /** Reset the tool whenever the open book changes, like the other floating chrome UI. */
  bookId: string | undefined
  setToast: (message: string | null) => void
}

/**
 * Foxit's "Snapshot" toolbar tool: arm crosshair mode, drag a rectangle over the (already
 * rendered) reader window, release to crop exactly that screen region and copy it to the OS
 * clipboard as a PNG. Captured via `webContents.capturePage` in Main (see `app.ipc.ts`'s
 * `captureSnapshot`), not html2canvas — that captures the real composited pixels of the window,
 * so it works identically whether the page underneath is an EPUB iframe or a PDF/canvas surface,
 * with no cross-origin/iframe caveats.
 *
 * `SnapshotOverlay` renders a full-window layer while `active`, which is what actually suspends
 * page-turning/text-selection underneath — this hook only owns the drag mechanics and the
 * capture/clipboard side effect.
 */
export function useSnapshotTool({ bookId, setToast }: UseSnapshotToolOptions) {
  const active = useSnapshotStore((s) => s.active)
  const start = useSnapshotStore((s) => s.start)
  const current = useSnapshotStore((s) => s.current)
  const capturing = useSnapshotStore((s) => s.capturing)
  const activate = useSnapshotStore((s) => s.activate)
  const deactivate = useSnapshotStore((s) => s.deactivate)
  const beginDrag = useSnapshotStore((s) => s.beginDrag)
  const updateDrag = useSnapshotStore((s) => s.updateDrag)
  const clearDrag = useSnapshotStore((s) => s.clearDrag)
  const setCapturing = useSnapshotStore((s) => s.setCapturing)

  // Switching books mid-selection would otherwise leave the tool armed over the new book.
  useEffect(() => {
    deactivate()
  }, [bookId, deactivate])

  const toggle = useCallback(() => {
    if (useSnapshotStore.getState().active) deactivate()
    else activate()
  }, [activate, deactivate])

  useEffect(() => {
    if (!active) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      deactivate()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, deactivate])

  const onOverlayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || useSnapshotStore.getState().capturing) return
      event.preventDefault()
      const handle = event.currentTarget
      try {
        handle.setPointerCapture(event.pointerId)
      } catch {
        /* ignore — older hosts / already captured */
      }
      beginDrag({ x: event.clientX, y: event.clientY })
    },
    [beginDrag],
  )

  const onOverlayPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!useSnapshotStore.getState().start) return
      updateDrag({ x: event.clientX, y: event.clientY })
    },
    [updateDrag],
  )

  const onOverlayPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const { start: dragStart, current: dragCurrent } = useSnapshotStore.getState()
      if (!dragStart || !dragCurrent) return
      const handle = event.currentTarget
      if (handle.hasPointerCapture?.(event.pointerId)) {
        try {
          handle.releasePointerCapture(event.pointerId)
        } catch {
          /* ignore */
        }
      }

      const rect = rectFrom(dragStart, dragCurrent)
      if (rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
        // Too small to be an intentional drag — stay armed so the user can just try again.
        clearDrag()
        return
      }

      setCapturing(true)
      void appApi
        .captureSnapshot(rect)
        .then((result) => {
          setToast(
            result.ok ? 'Đã sao chép vùng chọn vào bộ nhớ tạm.' : 'Không thể chụp vùng đã chọn.',
          )
        })
        .catch(() => setToast('Không thể chụp vùng đã chọn.'))
        .finally(() => deactivate())
    },
    [clearDrag, deactivate, setCapturing, setToast],
  )

  return {
    active,
    capturing,
    selectionRect: start && current ? rectFrom(start, current) : null,
    toggle,
    deactivate,
    onOverlayPointerDown,
    onOverlayPointerMove,
    onOverlayPointerUp,
  }
}
