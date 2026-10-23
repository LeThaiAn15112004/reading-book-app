/**
 * PDF freehand Ink painted over one page slot (docs/implementation_plan/pdf_freehand_ink_eraser_plan.md).
 *
 * Points are normalized 0–1 over the page box and the pen width is a fraction of the page WIDTH, so the
 * SVG uses `viewBox="0 0 1 heightRatio"` (page-width units on both axes): the pen stays round on a
 * non-square page, and zoom / resize never move a stroke — the SVG simply fills the slot. The layer
 * never takes pointer events; PdfRenderer hit-tests and draws itself.
 */
import { memo } from 'react'
import { INK_PEN_PRESETS, inkPathData, inkStrokeLayers, type InkPenStyle, type InkPoint } from '@reading-book/book-reader-sdk'

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
  /** Marker strokes multiply with the page. */
  penStyle: InkPenStyle
  /** Partial Eraser preview: `paths` is what would remain; this is the whole stroke, painted faded underneath. */
  erasedGhost?: readonly (readonly InkPoint[])[]
}

/** The stroke being drawn (not saved yet). */
export type PdfInkDraft = {
  pageIndex: number
  points: readonly InkPoint[]
  width: number
  colorHex: string
  opacity: number
  penStyle: InkPenStyle
}

/** Marker strokes composite with `multiply` (like a highlighter); Pen and Pencil are plain alpha. */
function blendStyle(penStyle: InkPenStyle) {
  return INK_PEN_PRESETS[penStyle].blend === 'multiply' ? ({ mixBlendMode: 'multiply' } as const) : undefined
}

/**
 * The visible part of a stroke. Pen / Pencil / Marker are ONE path (unchanged). The Brush is the same
 * centre-line painted as concentric round-capped layers inside one group (faint wide edge → dense core), with
 * the stroke's opacity on the group — a soft, rounded mark at constant width, in the same page-width units
 * as every other stroke, so it scales with zoom exactly like them.
 */
function StrokeShape({
  d,
  penStyle,
  colorHex,
  width,
  opacity,
  ...rest
}: {
  d: string
  penStyle: InkPenStyle
  colorHex: string
  width: number
  opacity: number
} & Record<`data-${string}`, string | undefined>) {
  const layers = inkStrokeLayers(penStyle)
  if (layers.length === 1) {
    return (
      <path
        d={d}
        fill="none"
        stroke={colorHex}
        strokeOpacity={opacity}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={blendStyle(penStyle)}
        {...rest}
      />
    )
  }
  return (
    <g opacity={opacity} style={blendStyle(penStyle)} {...rest}>
      {layers.map((layer) => (
        <path
          key={layer.scale}
          d={d}
          fill="none"
          stroke={colorHex}
          strokeOpacity={layer.alpha}
          strokeWidth={width * layer.scale}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  )
}

/** Selection halo, in page-width units beyond the pen width. */
const SELECT_HALO = 0.006

/** A stroke the Eraser would remove on release: still saved, only painted faded. */
const ERASE_PREVIEW_OPACITY = 0.4
/** The part a Partial Eraser gesture would cut away, painted faded under what remains. */
const PARTIAL_GHOST_OPACITY = 0.25

const InkStrokePath = memo(function InkStrokePath({
  mark,
  heightRatio,
  selected,
  erasing,
}: {
  mark: PdfInkLayerMark
  heightRatio: number
  selected: boolean
  erasing: boolean
}) {
  const d = mark.paths.map((path) => inkPathData(path, heightRatio)).join(' ')
  return (
    <>
      {mark.erasedGhost ? (
        <StrokeShape
          d={mark.erasedGhost.map((path) => inkPathData(path, heightRatio)).join(' ')}
          penStyle={mark.penStyle}
          colorHex={mark.colorHex}
          width={mark.width}
          opacity={mark.opacity * PARTIAL_GHOST_OPACITY}
          data-pdf-ink-ghost={mark.id}
        />
      ) : null}
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
      <StrokeShape
        d={d}
        penStyle={mark.penStyle}
        colorHex={mark.colorHex}
        width={mark.width}
        opacity={erasing ? mark.opacity * ERASE_PREVIEW_OPACITY : mark.opacity}
        data-pdf-ink-id={mark.id}
        data-pdf-ink-style={mark.penStyle}
        data-pdf-ink-erasing={erasing ? '' : undefined}
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
  /** Strokes the running Eraser gesture has touched (preview only). */
  erasingIds?: ReadonlySet<string> | null
}

export function PdfPageInk({ heightRatio, strokes, draft, selectedId, erasingIds }: PdfPageInkProps) {
  return (
    <svg
      viewBox={`0 0 1 ${heightRatio}`}
      preserveAspectRatio="none"
      aria-hidden
      data-pdf-ink-layer=""
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
    >
      {strokes.map((mark) => (
        <InkStrokePath key={mark.id} mark={mark} heightRatio={heightRatio} selected={selectedId === mark.id} erasing={erasingIds?.has(mark.id) === true} />
      ))}
      {draft ? (
        <StrokeShape
          d={inkPathData(draft.points, heightRatio)}
          penStyle={draft.penStyle}
          colorHex={draft.colorHex}
          width={draft.width}
          opacity={draft.opacity}
          data-pdf-ink-draft=""
        />
      ) : null}
    </svg>
  )
}
