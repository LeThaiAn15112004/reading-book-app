import { useEffect, useState, type RefObject } from 'react'

/** A non-empty text selection inside the page, with the point used to ask the renderer for its menu. */
export interface LiveSelection {
  /** The document that holds the selection: the page itself, or an EPUB section's iframe. */
  doc: Document
  /** The element the range starts in, the target of the synthetic `contextmenu`. */
  target: Element
  /** Centre of the range's first line, in `doc`'s own coordinates. */
  x: number
  y: number
}

const POLL_MS = 300

function selectionIn(doc: Document, root: Element | null): LiveSelection | null {
  const selection = doc.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  if (!selection.toString().trim()) return null
  const range = selection.getRangeAt(0)
  const node = range.startContainer
  const target = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!target) return null
  // A selection in the page document counts only inside the reading surface (never the bars or a sheet).
  if (doc === document && root && !root.contains(target)) return null
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return { doc, target, x: rect.left + Math.min(rect.width / 2, 24), y: rect.top + rect.height / 2 }
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
  a === b || (!!a && !!b && a.doc === b.doc && a.target === b.target && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y))

/**
 * Follows the native text selection inside the reading surface (spec 008, T103; risk R1 in `contracts/phone-ui.md`).
 *
 * On a phone, a long press selects text with the OS handles; whether the WebView also fires the `contextmenu` the
 * renderers listen to is risk R1, not yet checked on a device. So the Mobile Reader does not depend on it: while a
 * selection exists it offers a "Mark" action that dispatches that same `contextmenu` at the selection
 * (`requestSelectionMenu`), and each renderer then reports the selection through its existing
 * `onSelectionContextMenu` path. Nothing in a renderer changes. Polling (not `selectionchange`) also covers iframes
 * that EPUB adds and removes while paging.
 */
export function useLiveSelection(rootRef: RefObject<HTMLElement | null>, enabled: boolean): LiveSelection | null {
  const [live, setLive] = useState<LiveSelection | null>(null)
  useEffect(() => {
    if (!enabled) {
      setLive(null)
      return
    }
    const tick = () => {
      const next = find(rootRef.current)
      setLive((prev) => (same(prev, next) ? prev : next))
    }
    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, rootRef])
  return live
}

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
