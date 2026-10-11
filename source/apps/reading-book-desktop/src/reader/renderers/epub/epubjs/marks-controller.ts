/**
 * Highlight / underline / strikethrough / textbox marks painted by epub.js (marks-pane) for the
 * open book: add/remove, flash, hit-test and the focused outline. Owns its own `rendered` /
 * `resized` listeners; `dispose()` detaches them.
 */
import type { Rendition } from 'epubjs'
import type { HighlightStyleKind } from '@reading-book/book-reader-sdk'
import {
  epubAnnotationTypeFor,
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
   * A `strikethrough` mark is really an `underline` mark under the hood (see
   * `epubAnnotationTypeFor`) — marks-pane's `Underline.render()` (marks-pane/src/marks.js)
   * hardcodes its `<line>` at the BOTTOM of each line box, which is exactly what we want for a
   * real underline but not for a strikethrough. There's no library hook to change that, so this
   * walks the mark's own `<rect>`/`<line>` child pairs afterward and moves each `<line>` to the
   * vertical middle of its sibling `<rect>` instead. Re-run on every `rendered` view (alongside
   * `applyFocusedMarkClass`) since marks-pane recreates this geometry from scratch each time.
   */
  const strikethroughCfiRanges = new Set<string>()
  function repositionStrikethroughLines(): void {
    if (strikethroughCfiRanges.size === 0) return
    const views = activeRendition.views() as unknown as {
      forEach: (cb: (view: MarkedView) => void) => void
    }
    views.forEach((view) => {
      for (const cfiRange of strikethroughCfiRanges) {
        const element = view.underlines?.[cfiRange]?.element
        if (!element) continue
        let rect: SVGRectElement | null = null
        for (const child of Array.from(element.children)) {
          if (child.tagName === 'rect') {
            rect = child as SVGRectElement
          } else if (child.tagName === 'line' && rect) {
            const y = Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2
            child.setAttribute('y1', String(y))
            child.setAttribute('y2', String(y))
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
    strikethroughCfiRanges.delete(cfiRange)
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
    if (styleKind === 'strikethrough') strikethroughCfiRanges.add(cfiRange)
    // Re-apply the focused outline (and strikethrough line position) in case this mark is the
    // currently-focused one — e.g. a brand-new highlight created while already "focused" (see
    // `createHighlight` in useReaderHighlights.ts), whose element didn't exist yet the moment
    // `setFocusedHighlight` was called.
    applyFocusedMarkClass()
    repositionStrikethroughLines()
  }

  function removeHighlight(cfiRange: string, styleKind: HighlightStyleKind): void {
    if (styleKind === 'strikethrough') strikethroughCfiRanges.delete(cfiRange)
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
  activeRendition.on('rendered', repositionStrikethroughLines)
  // A view's `reframe()` (iframe.js) calls `pane.render()` directly whenever it resizes — e.g.
  // once images/fonts finish loading right after the initial `rendered` fires — which rebuilds
  // every underline's <line> from scratch at marks-pane's hardcoded bottom position, undoing the
  // reposition above. `resized` fires after those internal re-renders settle, so re-run there too.
  activeRendition.on('resized', repositionStrikethroughLines)

  return {
    applyHighlight,
    removeHighlight,
    flashHighlight,
    getHighlightAtPoint,
    setFocusedHighlight,
    dispose: () => {
      try {
        activeRendition.off('rendered', applyFocusedMarkClass)
        activeRendition.off('rendered', repositionStrikethroughLines)
        activeRendition.off('resized', repositionStrikethroughLines)
      } catch {
        /* ignore */
      }
      focusedMarkId = null
      strikethroughCfiRanges.clear()
    },
  }
}
