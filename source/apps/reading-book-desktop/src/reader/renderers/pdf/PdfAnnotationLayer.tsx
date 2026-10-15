/**
 * PDF text markup painted over one page slot (see docs/implementation_plan/pdf_text_annotations.md).
 *
 * Rects are normalized 0–1 against the page box, so they are laid out as percentages of the slot:
 * zoom, resize and the background page-size refresh never move them, and they exist whether or not
 * the page currently holds a canvas / text layer (virtualization only drops those). The layers are
 * React children of the slot, apart from the canvas / `.textLayer` PDF.js owns, and never take
 * pointer events — PdfRenderer hit-tests clicks itself, so text selection under a mark still works.
 * Styles: `.rb-pdf-annot-*` in index.css.
 */
import type { CSSProperties } from 'react'
import type { HighlightStyleKind, PdfHighlightRect } from '@reading-book/book-reader-sdk'

/** One annotation as the PDF surface paints it. */
export type PdfAnnotationMark = {
  id: string
  styleKind: HighlightStyleKind
  colorHex: string
  /** 1-based pages, normalized rects; may span several pages. */
  rects: readonly PdfHighlightRect[]
}

/** A short-lived pulse on one mark (jump from the sidebar); `nonce` restarts the animation. */
export type PdfAnnotationFlash = { id: string; nonce: number }

function percent(value: number): string {
  return `${(value * 100).toFixed(4)}%`
}

function boxStyle(rect: PdfHighlightRect, colorHex: string): CSSProperties {
  return {
    left: percent(rect.x),
    top: percent(rect.y),
    width: percent(rect.width),
    height: percent(rect.height),
    ['--rb-annot-color' as string]: colorHex,
  }
}

type PdfPageAnnotationsProps = {
  /** 1-based page of the slot. */
  page: number
  /** Marks with at least one rect on `page`, in paint order (later = on top). */
  marks: readonly PdfAnnotationMark[]
  focusedId: string | null
  flash: PdfAnnotationFlash | null
}

export function PdfPageAnnotations({ page, marks, focusedId, flash }: PdfPageAnnotationsProps) {
  const notes = marks.filter((m) => m.styleKind === 'textbox')
  return (
    <>
      <div className="rb-pdf-annot-layer" aria-hidden data-pdf-annot-layer="">
        {marks.map((mark) =>
          mark.styleKind === 'textbox'
            ? null
            : mark.rects.map((rect, i) =>
                rect.page === page ? (
                  <div
                    key={`${mark.id}:${i}:${flash?.id === mark.id ? flash.nonce : 0}`}
                    className="rb-pdf-annot"
                    data-pdf-annot-id={mark.id}
                    data-kind={mark.styleKind}
                    data-focused={focusedId === mark.id ? '' : undefined}
                    data-flash={flash?.id === mark.id ? '' : undefined}
                    style={boxStyle(rect, mark.colorHex)}
                  />
                ) : null,
              ),
        )}
      </div>
      {notes.length > 0 ? (
        <div className="rb-pdf-annot-notes" aria-hidden>
          {notes.map((mark) => {
            // EPUB parity: a note is a 📝 icon at the end of the noted text, no colored mark.
            const last = mark.rects[mark.rects.length - 1]
            if (!last || last.page !== page) return null
            return (
              <span
                key={`${mark.id}:${flash?.id === mark.id ? flash.nonce : 0}`}
                className="rb-pdf-annot-note"
                data-pdf-annot-id={mark.id}
                data-pdf-annot-note=""
                data-focused={focusedId === mark.id ? '' : undefined}
                data-flash={flash?.id === mark.id ? '' : undefined}
                style={{ left: percent(last.x + last.width), top: percent(last.y) }}
              />
            )
          })}
        </div>
      ) : null}
    </>
  )
}
