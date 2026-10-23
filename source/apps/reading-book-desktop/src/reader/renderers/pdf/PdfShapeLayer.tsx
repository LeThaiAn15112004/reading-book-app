/**
 * PDF shape annotations (rectangle / ellipse / line / arrow) painted over one page slot — and the live
 * preview of the one being drawn. docs/implementation_plan/pdf_shape_tools.md.
 *
 * Geometry is normalized 0–1 over the page box and the pen width is a fraction of the page WIDTH, so the SVG
 * uses `viewBox="0 0 1 heightRatio"` (page-width units on both axes): zoom and resize never move a shape. The
 * layer never takes pointer events — PdfRenderer hit-tests and draws the selection chrome itself.
 */
import { memo } from 'react'
import {
  shapeArrowBarbs,
  shapeFromDrag,
  shapeOpacityOf,
  shapeStrokeHex,
  type PdfShapeKind,
  type PdfShapeRect,
  type PdfShapeGeometry,
} from '@reading-book/book-reader-sdk'

/** One saved shape as the PDF surface paints it. */
export type PdfShapeMark = {
  /** The annotation row's id (also what the Notes list and the flash use). */
  id: string
  kind: PdfShapeKind
  /** 0-based page. */
  pageIndex: number
  rect: PdfShapeRect
  shape: PdfShapeGeometry
  /** `#RRGGBB` or `#RRGGBBAA` (opacity). */
  colorHex: string
}

/** The drag in progress (not saved yet). */
export type PdfShapeDraft = {
  pageIndex: number
  kind: PdfShapeKind
  /** Normalized page points where the press started / the pointer is now. */
  start: [number, number]
  end: [number, number]
  /** Pen look of the next shape. */
  colorHex: string
  width: number
  opacity: number
}

/** A short-lived pulse on one shape (jump from the Notes list); `nonce` restarts the animation. */
export type PdfShapeFlash = { id: string; nonce: number }

type ShapePaint = { kind: PdfShapeKind; rect: PdfShapeRect; shape: PdfShapeGeometry; stroke: string; opacity: number }

/** The SVG of one shape, in page-width units. The pen is drawn INSIDE the box (half a pen inset), like the PDF appearance. */
function ShapeGraphic({ paint, heightRatio, ...rest }: { paint: ShapePaint; heightRatio: number } & Record<`data-${string}`, string | undefined>) {
  const { kind, rect, shape, stroke, opacity } = paint
  const common = { fill: 'none', stroke, strokeOpacity: opacity, strokeWidth: shape.strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const half = shape.strokeWidth / 2
  if ((kind === 'line' || kind === 'arrow') && shape.line) {
    const [x1, y1, x2, y2] = shape.line
    if (kind === 'line') return <line x1={x1} y1={y1 * heightRatio} x2={x2} y2={y2 * heightRatio} {...common} {...rest} />
    const [a, b] = shapeArrowBarbs(shape.line, shape.strokeWidth, heightRatio)
    return (
      <g {...common} {...rest}>
        <line x1={x1} y1={y1 * heightRatio} x2={x2} y2={y2 * heightRatio} />
        <polyline points={`${a[0]},${a[1] * heightRatio} ${x2},${y2 * heightRatio} ${b[0]},${b[1] * heightRatio}`} />
      </g>
    )
  }
  const x = rect.x + half
  const y = rect.y * heightRatio + half
  const width = Math.max(0, rect.width - shape.strokeWidth)
  const height = Math.max(0, rect.height * heightRatio - shape.strokeWidth)
  if (kind === 'ellipse') return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...common} {...rest} />
  return <rect x={x} y={y} width={width} height={height} {...common} {...rest} />
}

const ShapeMarkGraphic = memo(function ShapeMarkGraphic({ mark, heightRatio, flash }: { mark: PdfShapeMark; heightRatio: number; flash: PdfShapeFlash | null }) {
  return (
    <ShapeGraphic
      key={flash?.id === mark.id ? flash.nonce : 0}
      paint={{ kind: mark.kind, rect: mark.rect, shape: mark.shape, stroke: shapeStrokeHex(mark.colorHex), opacity: shapeOpacityOf(mark.colorHex) }}
      heightRatio={heightRatio}
      data-pdf-annot-id={mark.id}
      data-pdf-shape={mark.kind}
      data-flash={flash?.id === mark.id ? '' : undefined}
    />
  )
})

type PdfPageShapesProps = {
  /** Page height / page width of this slot. */
  heightRatio: number
  /** Shapes of this page, in paint order (later = on top). */
  marks: readonly PdfShapeMark[]
  draft: PdfShapeDraft | null
  flash: PdfShapeFlash | null
}

export function PdfPageShapes({ heightRatio, marks, draft, flash }: PdfPageShapesProps) {
  const preview = draft ? shapeFromDrag(draft.kind, draft.start, draft.end, draft.width, heightRatio) : null
  return (
    <svg
      viewBox={`0 0 1 ${heightRatio}`}
      preserveAspectRatio="none"
      aria-hidden
      data-pdf-shape-layer=""
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
    >
      {marks.map((mark) => (
        <ShapeMarkGraphic key={mark.id} mark={mark} heightRatio={heightRatio} flash={flash} />
      ))}
      {draft && preview ? (
        <ShapeGraphic
          paint={{ kind: draft.kind, rect: preview.rect, shape: preview.shape, stroke: shapeStrokeHex(draft.colorHex), opacity: draft.opacity }}
          heightRatio={heightRatio}
          data-pdf-shape-draft={draft.kind}
        />
      ) : null}
    </svg>
  )
}
