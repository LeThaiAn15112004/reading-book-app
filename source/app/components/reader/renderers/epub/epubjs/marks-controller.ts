/**
 * Highlight / underline / strikethrough / textbox marks painted by epub.js (marks-pane) for the
 * open book: add/remove, flash, hit-test and the focused outline. Owns its own `rendered` /
 * `resized` listeners; `dispose()` detaches them.
 */
import type { Rendition } from 'epubjs'
import type { HighlightStyleKind } from '@reading-book/book-reader-sdk'
import {
  epubAnnotationTypeFor,
  isLineMarkKind,
  pointInIconElement,
  pointInMarkElement,
  styleAttrsFor,
  type MarkedView,
} from './annotation-marks'
import type { EpubHighlightClickInfo, EpubjsHandle } from './types'

export type MarksController = Pick<
  EpubjsHandle,
  'applyHighlight' | 'removeHighlight' | 'flashHighlight' | 'getHighlightAtPoint' | 'setFocusedHighlight'
> & {
  dispose: () => void
}

export function createMarksController(activeRendition: Rendition): MarksController {
  /**
   * Every kind except `highlight` / `textbox` is really an `underline` mark under the hood (see
   * `epubAnnotationTypeFor`) — marks-pane's `Underline.render()` (marks-pane/src/marks.js)
   * hardcodes its `<line>` at the BOTTOM of each line box, which is exactly what a real underline
   * wants. There's no library hook to change that, so this walks the mark's own `<rect>`/`<line>`
   * child pairs afterward and restyles each `<line>`: strikethrough / replace move it to the middle
   * of the sibling `<rect>` (replace also dashes it); insert dashes it in place; squiggly swaps it
   * for a zigzag `<path>`. Re-run on every `rendered` view (alongside `applyFocusedMarkClass`)
   * since marks-pane recreates this geometry from scratch each time.
   */
  const lineMarks = new Map<string, HighlightStyleKind>()
  const SVG_NS = 'http://www.w3.org/2000/svg'
  function zigzagPoints(x1: number, x2: number, y: number): string {
    const tooth = 3
    const amp = 1.5
    const steps = Math.max(2, Math.round(Math.abs(x2 - x1) / tooth))
    const points: string[] = []
    for (let i = 0; i <= steps; i++) {
      points.push(`${x1 + ((x2 - x1) * i) / steps},${i % 2 === 0 ? y : y - amp}`)
    }
    return points.join(' ')
  }
  function restyleLineMarks(): void {
    if (lineMarks.size === 0) return
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const [cfiRange, styleKind] of lineMarks) {
        if (styleKind === 'underline') continue
        const element = view.underlines?.[cfiRange]?.element
        if (!element) continue
        let rect: SVGRectElement | null = null
        for (const child of Array.from(element.children)) {
          if (child.tagName === 'rect') {
            rect = child as SVGRectElement
          } else if ((child.tagName === 'line' || child.tagName === 'polyline') && rect) {
            const top = Number(rect.getAttribute('y'))
            const height = Number(rect.getAttribute('height'))
            if (styleKind === 'strikethrough' || styleKind === 'replace') {
              const y = top + height / 2
              child.setAttribute('y1', String(y))
              child.setAttribute('y2', String(y))
            }
            if (styleKind === 'replace' || styleKind === 'insert') {
              child.setAttribute('stroke-dasharray', '5 3')
            }
            if (styleKind === 'squiggly' && child.tagName === 'line') {
              const x1 = Number(child.getAttribute('x1'))
              const x2 = Number(child.getAttribute('x2'))
              const y = Number(child.getAttribute('y1'))
              const zigzag = document.createElementNS(SVG_NS, 'polyline')
              for (const attr of Array.from(child.attributes)) {
                if (!/^(x1|x2|y1|y2)$/.test(attr.name)) zigzag.setAttribute(attr.name, attr.value)
              }
              zigzag.setAttribute('fill', 'none')
              zigzag.setAttribute('points', zigzagPoints(x1, x2, y))
              child.replaceWith(zigzag)
            }
            rect = null
          }
        }
      }
    })
  }

  function applyHighlight({
    id,
    cfiRange,
    styleKind,
    colorHex,
  }: {
    id: string
    cfiRange: string
    styleKind: HighlightStyleKind
    colorHex: string
  }): void {
    const epubType = epubAnnotationTypeFor(styleKind)
    // Remove first: re-applying the same (cfiRange, type) after a color/style change, or a
    // duplicate load-on-open call, must replace the mark rather than leak a second DOM node.
    // Separate try/catch from the add() below — remove() failing (it shouldn't; epub.js no-ops
    // when the mark isn't found) must never block add() from still painting the highlight.
    try {
      activeRendition.annotations.remove(cfiRange, epubType)
    } catch {
      /* ignore */
    }
    lineMarks.delete(cfiRange)
    try {
      if (epubType === 'mark') {
        activeRendition.annotations.add('mark', cfiRange, { id })
      } else {
        activeRendition.annotations.add(
          epubType,
          cfiRange,
          { id },
          undefined,
          undefined,
          styleAttrsFor(styleKind, colorHex),
        )
      }
    } catch {
      /* stale/foreign cfi — ignore */
    }
    if (isLineMarkKind(styleKind)) lineMarks.set(cfiRange, styleKind)
    // Re-apply the focused outline (and strikethrough line position) in case this mark is the
    // currently-focused one — e.g. a brand-new highlight created while already "focused" (see
    // `createHighlight` in useReaderHighlights.ts), whose element didn't exist yet the moment
    // `setFocusedHighlight` was called.
    applyFocusedMarkClass()
    restyleLineMarks()
  }

  function removeHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    if (styleKind === 'strikethrough') lineMarks.delete(cfiRange)
    try {
      activeRendition.annotations.remove(cfiRange, epubAnnotationTypeFor(styleKind))
    } catch {
      /* ignore */
    }
  }

  /** Finds the live mark epub.js/marks-pane painted for `cfiRange` — undocumented internals
   *  (`view.highlights`/`view.underlines`/`view.marks`, keyed by cfiRange) reached the same way
   *  `Annotations.remove` reaches `view.unhighlight`/`view.ununderline`/`view.unmark` upstream.
   *  Only ever populated for the section currently rendered as a view, so most lookups just miss. */
  function findMarkElement(cfiRange: string, styleKind: HighlightStyleKind): Element | null {
    const storeKey: 'highlights' | 'underlines' | 'marks' =
      styleKind === 'underline' || styleKind === 'strikethrough'
        ? 'underlines'
        : styleKind === 'textbox'
          ? 'marks'
          : 'highlights'
    let found: Element | null = null
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      if (found) return
      const entry = view[storeKey]?.[cfiRange]
      if (entry?.element) found = entry.element
    })
    return found
  }

  /** Pulses a mark's opacity a few times — used when jumping to a highlight from the sidebar so
   *  it's obvious which one the reader landed on when several marks share the same viewport. */
  function flashHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    const element = findMarkElement(cfiRange, styleKind)
    if (!element) return
    try {
      element.animate(
        [{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }],
        { duration: 900, easing: 'ease-in-out' },
      )
    } catch {
      /* Element.animate unavailable — the mark just won't pulse */
    }
  }


  function getHighlightAtPoint(outerX: number, outerY: number): EpubHighlightClickInfo | null {
    let found: EpubHighlightClickInfo | null = null
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      if (found) return
      for (const store of [view.highlights, view.underlines]) {
        if (!store || found) continue
        for (const cfiRange in store) {
          const element = store[cfiRange]?.element
          const id = element?.getAttribute('data-id')
          if (!element || !id || !pointInMarkElement(element, outerX, outerY)) continue
          const rect = element.getBoundingClientRect()
          found = {
            id,
            cfiRange,
            rect: {
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
          }
          break
        }
      }
      if (found || !view.marks) return
      for (const cfiRange in view.marks) {
        const element = view.marks[cfiRange]?.element
        const id = element?.dataset.id
        if (!element || !id || !pointInIconElement(element, outerX, outerY)) continue
        const rect = element.getBoundingClientRect()
        found = {
          id,
          cfiRange,
          rect: {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
        }
        break
      }
    })
    return found
  }

  let focusedMarkId: string | null = null
  function applyFocusedMarkClass(): void {
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const store of [view.highlights, view.underlines]) {
        if (!store) continue
        for (const cfiRange in store) {
          const element = store[cfiRange]?.element
          if (!element) continue
          element.classList.toggle(
            'rb-hl-focused',
            focusedMarkId != null && element.getAttribute('data-id') === focusedMarkId,
          )
        }
      }
      if (!view.marks) return
      for (const cfiRange in view.marks) {
        const element = view.marks[cfiRange]?.element
        if (!element) continue
        element.classList.toggle('rb-hl-focused', focusedMarkId != null && element.dataset.id === focusedMarkId)
      }
    })
  }

  function setFocusedHighlight(id: string | null): void {
    focusedMarkId = id
    applyFocusedMarkClass()
  }

  activeRendition.on('rendered', applyFocusedMarkClass)
  activeRendition.on('rendered', restyleLineMarks)
  // A view's `reframe()` (iframe.js) calls `pane.render()` directly whenever it resizes — e.g.
  // once images/fonts finish loading right after the initial `rendered` fires — which rebuilds
  // every underline's <line> from scratch at marks-pane's hardcoded bottom position, undoing the
  // reposition above. `resized` fires after those internal re-renders settle, so re-run there too.
  activeRendition.on('resized', restyleLineMarks)

  return {
    applyHighlight,
    removeHighlight,
    flashHighlight,
    getHighlightAtPoint,
    setFocusedHighlight,
    dispose: () => {
      try {
        activeRendition.off('rendered', applyFocusedMarkClass)
        activeRendition.off('rendered', restyleLineMarks)
        activeRendition.off('resized', restyleLineMarks)
      } catch {
        /* ignore */
      }
      focusedMarkId = null
      lineMarks.clear()
    },
  }
}
