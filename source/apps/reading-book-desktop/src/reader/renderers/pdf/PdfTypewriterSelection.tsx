/**
 * Selection chrome of one Typewriter note (specs/005-typewriter-note, US2): outline, 8 resize handles, a body that
 * moves the note, and a compact toolbar. Self-contained pointer handling (pointer capture on the pressed element),
 * so a press on the note never pans the page or starts a PDF text selection. The note itself is painted by
 * `PdfTypewriterLayer`; this reports a live `preview` box while dragging and the final box on release.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { TYPEWRITER_HANDLES, moveTypewriterBox, resizeTypewriterBox, type TypewriterHandle } from '@reading-book/book-reader-sdk'
import type { PdfTypewriterMark } from './PdfTypewriterLayer'
import { layoutNote, noteHeightFraction, type TypewriterNormBox } from './typewriterBox'

const DRAG_THRESHOLD_PX = 4

const CURSOR: Record<TypewriterHandle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
const POS: Record<TypewriterHandle, [string, string]> = {
  nw: ['0%', '0%'],
  n: ['50%', '0%'],
  ne: ['100%', '0%'],
  e: ['100%', '50%'],
  se: ['100%', '100%'],
  s: ['50%', '100%'],
  sw: ['0%', '100%'],
  w: ['0%', '50%'],
}

type Drag = { pointerId: number; kind: 'move' | TypewriterHandle; startX: number; startY: number; origin: TypewriterNormBox; moved: boolean; preview: TypewriterNormBox }

export function PdfTypewriterSelection({
  mark,
  heightRatio,
  containerRef,
  onPreview,
  onBox,
  onEdit,
  onDelete,
  onProperties,
  editOnClick,
}: {
  mark: PdfTypewriterMark
  heightRatio: number
  containerRef: RefObject<HTMLDivElement | null>
  onPreview: (box: TypewriterNormBox | null) => void
  onBox: (box: TypewriterNormBox) => void
  onEdit: () => void
  onDelete: () => void
  onProperties: () => void
  /** Select mode: a second click on the selected note (no drag) starts editing. */
  editOnClick: boolean
}) {
  const dragRef = useRef<Drag | null>(null)
  const [box, setBox] = useState<TypewriterNormBox | null>(null)
  const shown = box ?? mark.box
  const minHeight = (width: number) => noteHeightFraction(layoutNote(mark.doc, mark.text, width), heightRatio)

  const begin = (kind: Drag['kind']) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = { pointerId: event.pointerId, kind, startX: event.clientX, startY: event.clientY, origin: mark.box, moved: false, preview: mark.box }
  }

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const rect = containerRef.current?.getBoundingClientRect()
    if (!drag || drag.pointerId !== event.pointerId || !rect || rect.width <= 0) return
    event.stopPropagation()
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= DRAG_THRESHOLD_PX) return
    drag.moved = true
    const dx = (event.clientX - drag.startX) / rect.width
    const dy = (event.clientY - drag.startY) / rect.height
    const o = drag.origin
    drag.preview =
      drag.kind === 'move'
        ? moveTypewriterBox(o, dx, dy)
        : resizeTypewriterBox(o, drag.kind, dx, dy, minHeight)
    setBox(drag.preview)
    onPreview(drag.preview)
  }

  const end = (commit: boolean) => (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.stopPropagation()
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
    setBox(null)
    onPreview(null)
    if (!commit) return
    if (drag.moved) onBox(drag.preview)
    else if (drag.kind === 'move' && editOnClick) onEdit()
  }

  return (
    <div
      // zIndex: pdf.js appends its text layer after a zoom / re-render; in plain DOM order it ended up ABOVE the selected note, so its
      // handles and move area got no pointer events (selectable, but not draggable). The overlay must stay on top of the page layers.
      data-tw-selected={mark.id}
      style={{ position: 'absolute', left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%`, outline: '1.5px solid #1E88E5', pointerEvents: 'none', zIndex: 5 }}
    >
      <div
        data-tw-body=""
        style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor: 'move', touchAction: 'none' }}
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end(true)}
        onPointerCancel={end(false)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
      />
      {TYPEWRITER_HANDLES.map((handle) => (
        <span
          key={handle}
          data-tw-handle={handle}
          style={{ position: 'absolute', left: POS[handle][0], top: POS[handle][1], width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, background: '#fff', border: '1.5px solid #1E88E5', borderRadius: 2, pointerEvents: 'auto', cursor: CURSOR[handle], touchAction: 'none' }}
          onPointerDown={begin(handle)}
          onPointerMove={move}
          onPointerUp={end(true)}
          onPointerCancel={end(false)}
        />
      ))}
      <div
        role="toolbar"
        aria-label="Typewriter note"
        data-tw-toolbar=""
        style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 6px)', display: 'flex', gap: 4, padding: 3, background: '#1f2937', borderRadius: 6, pointerEvents: 'auto', whiteSpace: 'nowrap' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onEdit} style={{ color: '#fff', fontSize: 12, padding: '2px 8px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          Edit
        </button>
        <button type="button" onClick={onProperties} style={{ color: '#fff', fontSize: 12, padding: '2px 8px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          Properties
        </button>
        <button type="button" onClick={onDelete} aria-label="Delete note" style={{ color: '#fecaca', fontSize: 12, padding: '2px 8px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
          Delete
        </button>
      </div>
    </div>
  )
}
