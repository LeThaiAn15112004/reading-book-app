/**
 * Hover outline, selection outline, resize handles and the contextual toolbar of PDF Ink, painted over one
 * page slot. UI only: nothing here is saved into the PDF or the annotation data.
 *
 * Boxes are positioned in percent of the slot, so zoom, resize and scrolling move them with the page; only
 * the handle size and the toolbar are fixed pixels. The layer itself takes no pointer events — only the
 * handles and the toolbar do, and they stop their events so the page never reads them as a click, a pan or
 * a text selection.
 */
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { INK_RESIZE_HANDLES, inkHandlePosition, inkToolbarSide, type InkBox, type InkResizeHandle } from '@reading-book/book-reader-sdk'

const HANDLE_PX = 10

const HANDLE_CURSOR: Record<InkResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

function boxStyle(box: InkBox): CSSProperties {
  return { position: 'absolute', left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }
}

export type PdfInkResizeEvents = {
  onHandleDown: (handle: InkResizeHandle, event: ReactPointerEvent<HTMLElement>) => void
  onHandleMove: (event: ReactPointerEvent<HTMLElement>) => void
  onHandleUp: (event: ReactPointerEvent<HTMLElement>, commit: boolean) => void
}

/** An object to outline: its id and its outline box (normalized over the page), as painted — previews included. */
export type PdfOutlineTarget = { id: string; box: InkBox }

type PdfInkSelectionOverlayProps = PdfInkResizeEvents & {
  /** Rendered page height in CSS px (decides which side the toolbar opens on). */
  pageHeightPx: number
  /** Object under the pointer on this page (never the selected one). */
  hovered: PdfOutlineTarget | null
  /** Selected object on this page; `resizable` = it offers resize handles. */
  selected: (PdfOutlineTarget & { resizable: boolean }) | null
  /** The compact toolbar for the selected object. */
  toolbar: ReactNode
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

export function PdfInkSelectionOverlay({ pageHeightPx, hovered, selected, toolbar, onHandleDown, onHandleMove, onHandleUp }: PdfInkSelectionOverlayProps) {
  const hoverBox = hovered?.box ?? null
  const selectedBox = selected?.box ?? null
  if (!hoverBox && !selectedBox) return null
  const resizable = selected?.resizable ?? false
  const side = selectedBox ? inkToolbarSide(selectedBox.y * pageHeightPx) : 'above'
  const rightAligned = selectedBox ? selectedBox.x + selectedBox.width / 2 > 0.5 : false

  return (
    <div aria-hidden={selected ? undefined : true} data-pdf-ink-overlay="" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {hovered && hoverBox ? (
        <div
          data-pdf-ink-hover-outline={hovered.id}
          style={{ ...boxStyle(hoverBox), border: '1.5px solid var(--lib-accent, #3b82f6)', opacity: 0.7, borderRadius: 2 }}
        />
      ) : null}
      {selected && selectedBox ? (
        <div data-pdf-ink-selection={selected.id} style={{ ...boxStyle(selectedBox), border: '1.5px solid var(--lib-accent, #3b82f6)', borderRadius: 2 }}>
          {resizable
            ? INK_RESIZE_HANDLES.map((handle) => {
                const [hx, hy] = inkHandlePosition(selectedBox, handle)
                return (
                  <div
                    key={handle}
                    data-pdf-ink-handle={handle}
                    onPointerDown={(e) => onHandleDown(handle, e)}
                    onPointerMove={onHandleMove}
                    onPointerUp={(e) => onHandleUp(e, true)}
                    onPointerCancel={(e) => onHandleUp(e, false)}
                    onLostPointerCapture={(e) => onHandleUp(e, false)}
                    onClick={stop}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{
                      position: 'absolute',
                      left: `${((hx - selectedBox.x) / selectedBox.width) * 100}%`,
                      top: `${((hy - selectedBox.y) / selectedBox.height) * 100}%`,
                      width: HANDLE_PX,
                      height: HANDLE_PX,
                      transform: 'translate(-50%, -50%)',
                      background: 'var(--lib-surface-strong, #fff)',
                      border: '1.5px solid var(--lib-accent, #3b82f6)',
                      borderRadius: 2,
                      cursor: HANDLE_CURSOR[handle],
                      pointerEvents: 'auto',
                      touchAction: 'none',
                    }}
                  />
                )
              })
            : null}
          <div
            data-pdf-ink-toolbar={selected.id}
            data-side={side}
            // Nothing in the toolbar may reach the page: no click-through, pan, text selection or tap-zone turn.
            onPointerDown={stop}
            onPointerUp={stop}
            onPointerMove={stop}
            onClick={stop}
            onDoubleClick={stop}
            onContextMenu={stop}
            onMouseDown={(e) => {
              e.stopPropagation()
              if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
            }}
            onKeyDown={stop}
            style={{
              position: 'absolute',
              ...(side === 'above' ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }),
              ...(rightAligned ? { right: 0 } : { left: 0 }),
              pointerEvents: 'auto',
              userSelect: 'none',
              cursor: 'default',
            }}
          >
            {toolbar}
          </div>
        </div>
      ) : null}
    </div>
  )
}
