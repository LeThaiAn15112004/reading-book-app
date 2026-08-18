import { useEffect, useMemo, useRef, useState } from 'react'
import {
  freehandBoundingBox,
  normalizeHighlightColorHex,
  resizeFreehandBBox,
  scaleFreehandPointsToBox,
  translateFreehandPoints,
  type FreehandPoint,
  type FreehandResizeHandle,
  type ReaderShapeAnnotation,
} from '@reading-book/shared/models'

export type FreehandEditTarget = {
  id: string
  colorHex: string
  hasNote?: boolean
  /** Viewport rect of the stroke bbox (for panel + handles). */
  rect: { left: number; top: number; width: number; height: number }
  click?: { x: number; y: number }
  /** Ink host viewport rect — enables live bbox resize. */
  hostRect?: { left: number; top: number; width: number; height: number }
}

type FreehandEditOverlayProps = {
  editTarget: FreehandEditTarget | null
  selectedStroke: ReaderShapeAnnotation | null
  hostRect?: { left: number; top: number; width: number; height: number } | null
  onChangeColor: (id: string, colorHex: string) => void
  onEditNote: (id: string) => void
  onOpenSidebar: (id: string) => void
  onRemove: (id: string) => void
  onDismiss: () => void
  onResizePoints?: (id: string, points: FreehandPoint[]) => void
  /** Push undo once after a resize/move gesture ends. */
  onCommitPoints?: (id: string, beforePoints: FreehandPoint[]) => void
}

const HANDLES: FreehandResizeHandle[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

const HANDLE_CURSOR: Record<FreehandResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

function clampMenu(x: number, y: number, w: number, h: number) {
  return {
    left: Math.min(window.innerWidth - w - 12, Math.max(12, x)),
    top: Math.min(window.innerHeight - h - 12, Math.max(12, y)),
  }
}

/**
 * Floating freehand editor: color / note / sidebar + bbox move/resize handles.
 */
export function FreehandEditOverlay({
  editTarget,
  selectedStroke,
  hostRect,
  onChangeColor,
  onEditNote,
  onOpenSidebar,
  onRemove,
  onDismiss,
  onResizePoints,
  onCommitPoints,
}: FreehandEditOverlayProps) {
  const [pickerHex, setPickerHex] = useState('#ef4444')
  const resizeOriginRef = useRef<{
    handle: FreehandResizeHandle
    fromBox: ReturnType<typeof freehandBoundingBox>
    points: FreehandPoint[]
  } | null>(null)
  const moveOriginRef = useRef<{
    startX: number
    startY: number
    points: FreehandPoint[]
  } | null>(null)

  useEffect(() => {
    if (!editTarget) return
    setPickerHex(
      normalizeHighlightColorHex(editTarget.colorHex) ?? editTarget.colorHex,
    )
  }, [editTarget])

  useEffect(() => {
    if (!editTarget) return
    const targetId = editTarget.id
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const t = e.target as Node | null
        // Don't steal typing from note modal / inputs.
        if (
          t instanceof HTMLElement &&
          (t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable)
        ) {
          return
        }
        e.preventDefault()
        onRemove(targetId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editTarget, onDismiss, onRemove])

  const box = useMemo(() => {
    if (!editTarget) return null
    if (selectedStroke && hostRect && hostRect.width > 0 && hostRect.height > 0) {
      const bb = freehandBoundingBox(selectedStroke.points)
      if (bb) {
        const left = hostRect.left + bb.minX * hostRect.width
        const top = hostRect.top + bb.minY * hostRect.height
        const width = (bb.maxX - bb.minX) * hostRect.width
        const height = (bb.maxY - bb.minY) * hostRect.height
        return {
          left,
          top,
          width: Math.max(width, 8),
          height: Math.max(height, 8),
        }
      }
    }
    return editTarget.rect
  }, [editTarget, selectedStroke, hostRect])

  if (!editTarget || !box) return null

  const panelW = 160
  const panelH = 56
  const preferAbove = box.top - panelH - 10 >= 12
  const panelPos = clampMenu(
    box.left + box.width / 2 - panelW / 2,
    preferAbove ? box.top - panelH - 10 : box.top + box.height + 10,
    panelW,
    panelH,
  )

  const canTransform = Boolean(onResizePoints && selectedStroke && hostRect)

  return (
    <>
      <div
        className="fixed inset-0 z-[199]"
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDismiss()
        }}
      />

      <div
        className={`fixed z-[200] border border-sky-400/90 bg-sky-400/5 shadow-[0_0_0_1px_rgba(56,189,248,0.35)] ${
          canTransform ? 'pointer-events-auto cursor-move' : 'pointer-events-none'
        }`}
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        }}
        role={canTransform ? 'button' : undefined}
        aria-label={canTransform ? 'Move pencil stroke' : undefined}
        onPointerDown={(e) => {
          if (!canTransform || !selectedStroke || !hostRect || !onResizePoints) {
            return
          }
          // Only primary button; ignore if a handle starts the gesture.
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()
          moveOriginRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            points: selectedStroke.points.map((p) => ({ ...p })),
          }
          const target = e.currentTarget
          target.setPointerCapture(e.pointerId)

          const onMove = (ev: PointerEvent) => {
            const origin = moveOriginRef.current
            if (!origin || !hostRect) return
            const dx = (ev.clientX - origin.startX) / hostRect.width
            const dy = (ev.clientY - origin.startY) / hostRect.height
            onResizePoints(
              selectedStroke.id,
              translateFreehandPoints(origin.points, dx, dy),
            )
          }
          const onUp = (ev: PointerEvent) => {
            const origin = moveOriginRef.current
            moveOriginRef.current = null
            try {
              target.releasePointerCapture(ev.pointerId)
            } catch {
              /* ignore */
            }
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            if (origin) {
              onCommitPoints?.(selectedStroke.id, origin.points)
            }
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        }}
      />

      {canTransform && selectedStroke && hostRect && onResizePoints
        ? HANDLES.map((handle) => {
            const hx = handle.includes('w')
              ? box.left
              : handle.includes('e')
                ? box.left + box.width
                : box.left + box.width / 2
            const hy = handle.includes('n')
              ? box.top
              : handle.includes('s')
                ? box.top + box.height
                : box.top + box.height / 2
            return (
              <button
                key={handle}
                type="button"
                aria-label={`Resize ${handle}`}
                className="fixed z-[201] size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-sky-500 bg-white p-0 shadow"
                style={{
                  left: hx,
                  top: hy,
                  cursor: HANDLE_CURSOR[handle],
                }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const fromBox = freehandBoundingBox(selectedStroke.points)
                  if (!fromBox) return
                  resizeOriginRef.current = {
                    handle,
                    fromBox,
                    points: selectedStroke.points.map((p) => ({ ...p })),
                  }
                  const target = e.currentTarget
                  target.setPointerCapture(e.pointerId)

                  const onMove = (ev: PointerEvent) => {
                    const origin = resizeOriginRef.current
                    if (!origin?.fromBox || !hostRect) return
                    const nx = (ev.clientX - hostRect.left) / hostRect.width
                    const ny = (ev.clientY - hostRect.top) / hostRect.height
                    const to = resizeFreehandBBox(origin.fromBox, origin.handle, {
                      x: nx,
                      y: ny,
                    })
                    onResizePoints(
                      selectedStroke.id,
                      scaleFreehandPointsToBox(origin.points, origin.fromBox, to),
                    )
                  }
                  const onUp = (ev: PointerEvent) => {
                    const origin = resizeOriginRef.current
                    resizeOriginRef.current = null
                    try {
                      target.releasePointerCapture(ev.pointerId)
                    } catch {
                      /* ignore */
                    }
                    window.removeEventListener('pointermove', onMove)
                    window.removeEventListener('pointerup', onUp)
                    if (origin) {
                      onCommitPoints?.(selectedStroke.id, origin.points)
                    }
                  }
                  window.addEventListener('pointermove', onMove)
                  window.addEventListener('pointerup', onUp)
                }}
              />
            )
          })
        : null}

      <div
        className="fixed z-[202] flex items-center gap-1.5 rounded-xl border border-lib-border bg-lib-surface-strong px-2 py-1.5 shadow-xl backdrop-blur-md"
        style={{ top: panelPos.top, left: panelPos.left }}
        role="dialog"
        aria-label="Pencil stroke"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label
          className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-lib-border shadow-sm transition-transform hover:scale-105"
          title="Pick stroke color"
          aria-label="Pick stroke color"
          style={{ backgroundColor: pickerHex }}
        >
          <span
            className="pointer-events-none absolute inset-0 rounded-full opacity-40"
            style={{
              background: `conic-gradient(
                  #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444
                )`,
            }}
            aria-hidden
          />
          <span
            className="pointer-events-none absolute inset-[5px] rounded-full border border-white/70"
            style={{ backgroundColor: pickerHex }}
            aria-hidden
          />
          <input
            className="absolute inset-0 cursor-pointer opacity-0"
            type="color"
            value={pickerHex}
            onInput={(e) => {
              const next =
                normalizeHighlightColorHex(
                  (e.target as HTMLInputElement).value,
                ) ?? pickerHex
              setPickerHex(next)
              onChangeColor(editTarget.id, next)
            }}
            onChange={(e) => {
              const next =
                normalizeHighlightColorHex(
                  (e.target as HTMLInputElement).value,
                ) ?? pickerHex
              setPickerHex(next)
              onChangeColor(editTarget.id, next)
            }}
          />
        </label>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-lib-border" aria-hidden />
        <button
          type="button"
          title={editTarget.hasNote ? 'Edit note' : 'Add note'}
          aria-label={editTarget.hasNote ? 'Edit note' : 'Add note'}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-sm text-lib-muted transition-colors hover:bg-lib-bg-deep/40 hover:text-lib-text-strong"
          onClick={(e) => {
            e.stopPropagation()
            onEditNote(editTarget.id)
          }}
        >
          📝
        </button>
        <button
          type="button"
          title="Open side panel"
          aria-label="Open side panel"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-sm text-lib-muted transition-colors hover:bg-lib-bg-deep/40 hover:text-lib-text-strong"
          onClick={(e) => {
            e.stopPropagation()
            onOpenSidebar(editTarget.id)
          }}
        >
          ☰
        </button>
      </div>
    </>
  )
}
