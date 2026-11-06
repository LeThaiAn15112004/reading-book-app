/**
 * Typewriter notes painted over one page slot (specs/005-typewriter-note), and the in-place editor for the one
 * being typed. Text is positioned from `layoutTypewriter` (the SAME lines the PDF appearance stream uses), in
 * page-width units turned into CSS with `cqw` (the wrapper is an inline-size container as wide as the page), so
 * zoom never re-wraps a line. Saved notes take no pointer events; PdfRenderer hit-tests them itself.
 */
import { memo, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { LaidOutLine, LaidOutSegment, PdfTypewriterDoc, TypewriterLayout } from '@reading-book/book-reader-sdk'
import { layoutNote, noteHeightFraction, useTypewriterFonts, type TypewriterNormBox } from './typewriterBox'
import { PdfTypewriterSelection } from './PdfTypewriterSelection'
import { typewriterCssFamily, typewriterRendererMetrics } from './typewriterFonts'

/** One saved note as the PDF surface paints it. */
export type PdfTypewriterMark = {
  id: string
  /** 0-based page. */
  pageIndex: number
  box: TypewriterNormBox
  doc: PdfTypewriterDoc
  text: string
}

/** A short-lived pulse on one note (jump from the Notes list); `nonce` restarts the animation. */
export type PdfTypewriterFlash = { id: string; nonce: number }

/** Page-width units → CSS (`cqw` = 1 % of the page-wide container). */
const cqw = (units: number) => `${units * 100}cqw`

const TEXT_STYLE: CSSProperties = {
  position: 'absolute',
  whiteSpace: 'pre',
  fontKerning: 'none',
  fontVariantLigatures: 'none',
  fontFeatureSettings: '"kern" 0, "liga" 0, "clig" 0',
  textRendering: 'geometricPrecision',
  letterSpacing: 0,
}

/** `baseline` is relative to the LINE element (lines are positioned at `line.top`, their segments and bars inside them). The PDF appearance draws underline / strike as thin bars; so does the page (WYSIWYG, no CSS decoration). */
function bars(seg: LaidOutSegment, baseline: number): { key: string; top: number; height: number }[] {
  const thick = Math.max(0.3 / 612, seg.size * 0.05)
  const out: { key: string; top: number; height: number }[] = []
  if (seg.underline) out.push({ key: 'u', top: baseline + seg.size * 0.12 - thick / 2, height: thick })
  if (seg.strike) out.push({ key: 's', top: baseline - seg.size * 0.3 - thick / 2, height: thick })
  return out
}

function Segment({ seg, line, extra = '' }: { seg: LaidOutSegment; line: LaidOutLine; extra?: string }) {
  const upm = typewriterRendererMetrics.unitsPerEm(seg.face)
  const ascent = (typewriterRendererMetrics.ascent(seg.face) / upm) * seg.size
  const descent = (Math.abs(typewriterRendererMetrics.descent(seg.face)) / upm) * seg.size
  return (
    <>
      <span
        data-tw-seg=""
        data-start={seg.start}
        style={{
          ...TEXT_STYLE,
          left: cqw(seg.x),
          top: cqw(line.baseline - line.top - ascent),
          fontFamily: `'${typewriterCssFamily(seg.face)}'`,
          fontSize: cqw(seg.size),
          lineHeight: cqw(ascent + descent),
          color: seg.color,
        }}
      >
        {seg.text + extra}
      </span>
      {bars(seg, line.baseline - line.top).map((bar) => (
        <span key={bar.key} aria-hidden style={{ position: 'absolute', left: cqw(seg.x), top: cqw(bar.top), width: cqw(seg.width), height: cqw(bar.height), background: seg.color }} />
      ))}
    </>
  )
}

/** The laid-out lines of one note; `data-*` attributes let the editor map DOM positions to text offsets. */
/** `hanging[i]`: the spaces after line i that the layout lets hang past its end; the editor shows them so the caret can pass them. */
export function TypewriterLines({ layout, hanging }: { layout: TypewriterLayout; hanging?: readonly string[] }) {
  return (
    <>
      {layout.lines.map((line, i) => (
        <div key={i} data-tw-line="" data-start={line.start} data-end={line.end} style={{ position: 'absolute', left: 0, right: 0, top: cqw(line.top), height: cqw(line.height) }}>
          {line.segments.map((seg, j) => (
            <Segment key={j} seg={seg} line={line} extra={j === line.segments.length - 1 ? hanging?.[i] : undefined} />
          ))}
          {line.segments.length === 0 ? <br /> : null}
        </div>
      ))}
    </>
  )
}

const MarkView = memo(function MarkView({ mark, heightRatio, flashNonce }: { mark: PdfTypewriterMark; heightRatio: number; flashNonce: number | null }) {
  const layout = useMemo(() => layoutNote(mark.doc, mark.text, mark.box.width), [mark.doc, mark.text, mark.box.width])
  const height = Math.max(mark.box.height, noteHeightFraction(layout, heightRatio))
  return (
    <div
      data-tw-note={mark.id}
      data-flash={flashNonce != null ? '' : undefined}
      style={{ position: 'absolute', left: `${mark.box.x * 100}%`, top: `${mark.box.y * 100}%`, width: `${mark.box.width * 100}%`, height: `${height * 100}%`, pointerEvents: 'none' }}
    >
      <TypewriterLines layout={layout} />
    </div>
  )
})

/**
 * All saved notes of one page (and, via `children`, the editor of the draft on this page). */
export function PdfPageTypewriters({
  marks,
  heightRatio,
  flash,
  selectedId = null,
  hoverId = null,
  hiddenId = null,
  editOnClick = false,
  onBox,
  onEdit,
  onDelete,
  onProperties,
  children,
}: {
  marks: readonly PdfTypewriterMark[]
  heightRatio: number
  flash: PdfTypewriterFlash | null
  selectedId?: string | null
  hoverId?: string | null
  /** The note being edited: the editor paints it, so the saved copy is not painted twice. */
  hiddenId?: string | null
  editOnClick?: boolean
  onBox?: (id: string, box: TypewriterNormBox) => void
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
  onProperties?: (id: string) => void
  children?: ReactNode
}) {
  const { ready } = useTypewriterFonts()
  const containerRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<{ id: string; box: TypewriterNormBox } | null>(null)
  if (!ready) return null
  const selected = marks.find((m) => m.id === selectedId && m.id !== hiddenId)
  const hover = hoverId && hoverId !== selectedId ? marks.find((m) => m.id === hoverId && m.id !== hiddenId) : undefined
  return (
    <div ref={containerRef} data-pdf-typewriters="" aria-hidden={children ? undefined : true} style={{ position: 'absolute', inset: 0, containerType: 'inline-size', pointerEvents: 'none' }}>
      {marks.map((mark) =>
        mark.id === hiddenId ? null : (
          <MarkView key={mark.id} mark={preview?.id === mark.id ? { ...mark, box: preview.box } : mark} heightRatio={heightRatio} flashNonce={flash?.id === mark.id ? flash.nonce : null} />
        ),
      )}
      {hover ? (
        <div aria-hidden style={{ position: 'absolute', left: `${hover.box.x * 100}%`, top: `${hover.box.y * 100}%`, width: `${hover.box.width * 100}%`, height: `${hover.box.height * 100}%`, outline: '1px solid rgba(30,136,229,0.7)', pointerEvents: 'none' }} />
      ) : null}
      {selected ? (
        <PdfTypewriterSelection
          mark={selected}
          heightRatio={heightRatio}
          containerRef={containerRef}
          onPreview={(box) => setPreview(box ? { id: selected.id, box } : null)}
          onBox={(box) => onBox?.(selected.id, box)}
          onEdit={() => onEdit?.(selected.id)}
          onDelete={() => onDelete?.(selected.id)}
          onProperties={() => onProperties?.(selected.id)}
          editOnClick={editOnClick}
        />
      ) : null}
      {children}
    </div>
  )
}
