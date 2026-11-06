import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SnapshotRect } from '../../logic'

type SnapshotOverlayProps = {
  active: boolean
  selectionRect: SnapshotRect | null
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/**
 * Foxit-style Snapshot region picker. `fixed inset-0` (viewport coordinates, same as
 * `PointerEvent.clientX/clientY` and the `capturePage` rect the hook sends to Main) rather than
 * `absolute` against `ReaderShell`'s own box — it needs to sit over the topbar/footer/sidebar too
 * so it can intercept every pointer event app-wide while armed, which is what suspends
 * page-turning/text-selection underneath without touching the renderers themselves. The dashed
 * box tracks the drag; a huge `box-shadow` on it dims everything outside the selection.
 */
export function SnapshotOverlay({
  active,
  selectionRect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: SnapshotOverlayProps) {
  if (!active) return null

  return (
    <div
      className="fixed inset-0 z-[400] cursor-crosshair touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      {!selectionRect ? (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-lib-border bg-lib-surface-strong px-4 py-2 text-[13px] font-semibold text-lib-text-strong shadow-xl">
          Kéo để chọn vùng cần chụp · Esc để hủy
        </div>
      ) : null}

      {selectionRect ? (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-white"
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
            boxShadow: '0 0 0 9999px rgba(10,14,25,0.5)',
          }}
        />
      ) : null}
    </div>
  )
}
