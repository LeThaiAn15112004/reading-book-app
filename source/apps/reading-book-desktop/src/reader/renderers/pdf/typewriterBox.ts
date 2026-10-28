/**
 * Typewriter note geometry shared by the page layer, the editor and the save path (specs/005-typewriter-note).
 * Everything is laid out in PAGE-WIDTH units (`pageWidth = 1`): positions and sizes are fractions of the page
 * width, so zoom and window resize never change a line break. The page height in the same unit is `heightRatio`.
 */
import { useEffect, useState } from 'react'
import { layoutTypewriter, TYPEWRITER_MIN_BOX_WIDTH, type PdfTypewriterDoc, type TypewriterLayout } from '@reading-book/book-reader-sdk'
import { areTypewriterFontsReady, loadTypewriterFonts, typewriterRendererMetrics } from './typewriterFonts'

export type TypewriterNormBox = { x: number; y: number; width: number; height: number }

/** Re-renders once the shipped fonts are loaded (and metrics exist); `error` when a file could not load. */
export function useTypewriterFonts(): { ready: boolean; error: string | null } {
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: areTypewriterFontsReady(), error: null })
  useEffect(() => {
    if (state.ready) return
    let alive = true
    loadTypewriterFonts().then(
      () => alive && setState({ ready: true, error: null }),
      (err) => alive && setState({ ready: false, error: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      alive = false
    }
  }, [state.ready])
  return state
}

/** Layout of one note in page-width units. Call only when the fonts are ready. */
export function layoutNote(doc: PdfTypewriterDoc, text: string, widthFraction: number): TypewriterLayout {
  return layoutTypewriter(doc, text, widthFraction, 1, typewriterRendererMetrics)
}

/** The box a note needs: as wide as asked, as tall as the larger of the asked height and its laid-out text. */
export function noteHeightFraction(layout: TypewriterLayout, heightRatio: number): number {
  return layout.height / heightRatio
}

/**
 * The box to SAVE for a draft: height grows to the text; if that pushes it past the page bottom it moves up,
 * and when it still does not fit (text taller than the page) the result is null.
 */
export function fitTypewriterBox(doc: PdfTypewriterDoc, text: string, box: TypewriterNormBox, heightRatio: number): TypewriterNormBox | null {
  const width = Math.min(1, Math.max(TYPEWRITER_MIN_BOX_WIDTH, box.width))
  const layout = layoutNote(doc, text, width)
  const height = Math.max(box.height, noteHeightFraction(layout, heightRatio))
  if (height > 1) return null
  const x = Math.min(Math.max(0, box.x), 1 - width)
  const y = Math.min(Math.max(0, box.y), 1 - height)
  return { x, y, width, height }
}
