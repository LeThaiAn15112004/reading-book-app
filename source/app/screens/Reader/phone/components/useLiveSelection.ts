import { useEffect, useRef, useState, type RefObject } from 'react'

/** A non-empty text selection inside the page, with the point used to ask the renderer for its menu. */
export interface LiveSelection {
  /** The document that holds the selection: the page itself, or an EPUB section's iframe. */
  doc: Document
  /** The element the range starts in, the target of the synthetic `contextmenu`. */
  target: Element
  /** Centre of the range's first line, in `doc`'s own coordinates. */
  x: number
  y: number
  /** The selected text (identity of the selection between polls). */
  text: string
}

const POLL_MS = 125
/** A selection unchanged for this long, with no finger on the screen, is "finished" (spec 019 R10). */
export const SELECTION_STABLE_MS = 250

function selectionIn(doc: Document, root: Element | null): LiveSelection | null {
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = selection.toString()
  if (!text.trim()) return null
  const range = selection.getRangeAt(0)
  const node = range.startContainer
  const target = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!target) return null
  // A selection in the page document counts only inside the reading surface (never the bars or a sheet).
  if (doc === document && root && !root.contains(target)) return null
  // A textarea (TXT) reports its own selection through its renderer.
  if (target.closest('textarea')) return null
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return { doc, target, x: rect.left + Math.min(rect.width / 2, 24), y: rect.top + rect.height / 2, text }
}

function find(root: Element | null): LiveSelection | null {
  const top = selectionIn(document, root)
  if (top) return top
  // EPUB sections render in same-origin iframes (epub.js); their selection is their own.
  for (const frame of root?.querySelectorAll('iframe') ?? []) {
    let doc: Document | null = null
    try {
      doc = frame.contentDocument
    } catch {
      doc = null
    }
    const found = doc ? selectionIn(doc, null) : null
    if (found) return found
  }
  return null
}

const same = (a: LiveSelection | null, b: LiveSelection | null) =>
  a === b ||
  (!!a && !!b && a.doc === b.doc && a.target === b.target && a.text === b.text && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y))

/** Asks the renderer under the selection for its menu, through the `contextmenu` path it already handles. */
export function requestSelectionMenu(selection: LiveSelection): void {
  const view = selection.doc.defaultView ?? window
  selection.target.dispatchEvent(
    new view.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: selection.x,
      clientY: selection.y,
      button: 2,
    }),
  )
}

/**
 * Follows the native text selection inside the reading surface and, once it is FINISHED (unchanged for
 * `SELECTION_STABLE_MS`, no finger down), asks the renderer for its selection menu itself (spec 019 FR-015, research
 * R10): the renderer then reports the selection through its existing `onSelectionContextMenu` path and the colour bar
 * shows at once — no separate "Mark" step. Each distinct selection is requested once. Polling (not `selectionchange`)
 * also covers the iframes EPUB adds and removes while paging.
 *
 * Returns the live selection (so the caller can clear it).
 */
export function useLiveSelection(rootRef: RefObject<HTMLElement | null>, enabled: boolean): LiveSelection | null {
  const [live, setLive] = useState<LiveSelection | null>(null)
  const stableSinceRef = useRef(0)
  const requestedRef = useRef<LiveSelection | null>(null)
  const fingerDownRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setLive(null)
      requestedRef.current = null
      return
    }
    const down = () => (fingerDownRef.current = true)
    const up = () => (fingerDownRef.current = false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    let current: LiveSelection | null = null
    const tick = () => {
      const next = find(rootRef.current)
      if (!same(current, next)) {
        current = next
        stableSinceRef.current = performance.now()
        setLive(next)
        if (!next) requestedRef.current = null
        return
      }
      if (!next || fingerDownRef.current) return
      if (same(requestedRef.current, next)) return
      if (performance.now() - stableSinceRef.current < SELECTION_STABLE_MS) return
      requestedRef.current = next
      requestSelectionMenu(next)
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [enabled, rootRef])
  return live
}
