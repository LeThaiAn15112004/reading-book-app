/**
 * PDF freehand Ink painted over one page slot (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md).
 *
 * Points are normalized 0–1 over the page box and the pen width is a fraction of the page WIDTH, so the
 * SVG uses `viewBox="0 0 1 heightRatio"` (page-width units on both axes): the pen stays round on a
 * non-square page, and zoom / resize never move a stroke — the SVG simply fills the slot. The layer
 * never takes pointer events; PdfRenderer hit-tests and draws itself.
 */
import { memo } from 'react'
import { inkPathData, type InkPoint } from '@reading-book/book-reader-sdk'

/** One stroke as the PDF surface paints it. */
export type PdfInkLayerMark = {
  id: string
  /** 0-based page. */
  pageIndex: number
  paths: readonly (readonly InkPoint[])[]
  /** Fraction of the page width. */
  width: number
  colorHex: string
  opacity: number
}

/** The stroke being drawn (not saved yet). */
export type PdfInkDraft = {
  pageIndex: number
  points: readonly InkPoint[]
  width: number
  colorHex: string
  opacity: number
}

/** Selection halo, in page-width units beyond the pen width. */
const SELECT_HALO = 0.006

const InkStrokePath = memo(function InkStrokePath({ mark, heightRatio, selected }: { mark: PdfInkLayerMark; heightRatio: number; selected: boolean }) {
  const d = mark.paths.map((path) => inkPathData(path, heightRatio)).join(' ')
  return (
    <>
      {selected ? (
        <path
          d={d}
          fill="none"
          stroke="var(--lib-accent, #3b82f6)"
          strokeOpacity={0.4}
          strokeWidth={mark.width + SELECT_HALO}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-pdf-ink-halo={mark.id}
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke={mark.colorHex}
        strokeOpacity={mark.opacity}
        strokeWidth={mark.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-pdf-ink-id={mark.id}
      />
    </>
  )
})

type PdfPageInkProps = {
  /** Page height / page width of this slot. */
  heightRatio: number
  /** Strokes of this page, in paint order (later = on top). */
  strokes: readonly PdfInkLayerMark[]
  draft: PdfInkDraft | null
  selectedId: string | null
}

export function PdfPageInk({ heightRatio, strokes, draft, selectedId }: PdfPageInkProps) {
  return (
    <svg
      viewBox={`0 0 1 ${heightRatio}`}
      preserveAspectRatio="none"
      aria-hidden
      data-pdf-ink-layer=""
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
    >
      {strokes.map((mark) => (
        <InkStrokePath key={mark.id} mark={mark} heightRatio={heightRatio} selected={selectedId === mark.id} />
      ))}
      {draft ? (
        <path
          d={inkPathData(draft.points, heightRatio)}
          fill="none"
          stroke={draft.colorHex}
          strokeOpacity={draft.opacity}
          strokeWidth={draft.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-pdf-ink-draft=""
        />
      ) : null}
    </svg>
  )
}
