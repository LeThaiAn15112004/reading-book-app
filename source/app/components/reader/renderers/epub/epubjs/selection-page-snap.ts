/**
 * Page view: selecting text across pages turns WHOLE pages, after a short dwell at the page edge (spec 019).
 *
 * While a selection is being dragged (a press in the section, or its ends still moving — Android's selection handles
 * send no pointer events to the page, only `selectionchange`):
 *   1. Lock: the browser never moves the page. Any scroll it makes — of epub.js's paginated box, of a box around it,
 *      or of the section's own document — is put back where it was when the drag began (on the `scroll` event, which
 *      is dispatched before paint, so the half-way page is never drawn).
 *   2. Turn: when the selection's moving end has reached the end of the page (its last lines, or past it) — or the start
 *      when selecting backwards — and stays there for `SELECTION_EDGE_DWELL_MS`, ONE whole page turns that way (core
 *      `selectionEdgeAt`). Setting `scrollLeft` goes through epub.js's own scroll handling, which reports the new
 *      location (CFI, progress).
 * Left-to-right books only (epub.js's RTL `scrollLeft` is negative or reversed depending on the engine).
 */
import type { Rendition } from 'epubjs'
import {
  SELECTION_EDGE_DWELL_MS,
  pageIndexAt,
  pageScrollLeft,
  selectionEdgeAt,
  turnedPageScrollLeft,
  type SelectionEdge,
} from '@core'
import { currentSectionDocument, getRenditionLayoutDelta, renditionManager } from './rendition-internals'

type ManagerLike = {
  container?: HTMLElement
  settings?: { direction?: string }
  layout?: { pageWidth?: number; columnWidth?: number }
}

/** The ends of a selection still moving this recently = a drag in progress (no pointer events for Android handles). */
const DRAG_QUIET_MS = 700

function liveSelection(doc: Document | null): Selection | null {
  const selection = doc?.defaultView?.getSelection() ?? null
  return selection && selection.rangeCount > 0 && !selection.isCollapsed ? selection : null
}

/** Caret box at the selection's focus, in the section document's coordinates. */
function focusBox(doc: Document, selection: Selection): DOMRect | null {
  const node = selection.focusNode
  if (!node) return null
  const range = doc.createRange()
  try {
    range.setStart(node, selection.focusOffset)
    range.collapse(true)
    const rect = range.getClientRects()[0]
    if (rect) return rect
    // A collapsed range at an element boundary has no box: measure the character next to it.
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      const at = selection.focusOffset
      if (at > 0) range.setStart(node, at - 1)
      else if (length > 0) range.setEnd(node, 1)
      const box = range.getClientRects()[0]
      if (box) return box
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    return element?.getBoundingClientRect() ?? null
  } catch {
    return null
  }
}

function isForward(selection: Selection): boolean {
  const range = selection.getRangeAt(0)
  // The focus is the range's start only when the selection grew backwards.
  return !(range.startContainer === selection.focusNode && range.startOffset === selection.focusOffset)
}

function lineHeightAt(doc: Document, node: Node | null): number {
  const element = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
  const style = element ? doc.defaultView?.getComputedStyle(element) : null
  if (!style) return 20
  const lineHeight = parseFloat(style.lineHeight)
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight
  const fontSize = parseFloat(style.fontSize)
  return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.2 : 20
}

/** Starts watching; returns the cleanup. `isPaged` is read on every event (the view mode can change). */
export function attachSelectionPageSnap(rendition: Rendition, isPaged: () => boolean): () => void {
  const manager = renditionManager(rendition) as ManagerLike | undefined
  const container = manager?.container
  if (!container) return () => {}

  const enabled = () => {
    if (!isPaged()) return false
    const direction = manager?.settings?.direction
    return !direction || direction === 'ltr'
  }
  const maxScrollLeft = () => container.scrollWidth - container.clientWidth

  let sectionDoc: Document | null = null
  let pressed = false
  let lastSelectionChangeAt = -Infinity
  /** Page box position while the drag lasts (moved only by a turn). */
  let lockedLeft: number | null = null
  /** Scroll positions of every other box that could move the page, taken when the drag began. */
  let frozen = new Map<Element, { left: number; top: number }>()
  let dwell: { edge: SelectionEdge; timer: number } | null = null

  const dragging = () => pressed || performance.now() - lastSelectionChangeAt < DRAG_QUIET_MS

  const cancelDwell = () => {
    if (dwell) window.clearTimeout(dwell.timer)
    dwell = null
  }

  const beginLock = () => {
    const step = getRenditionLayoutDelta(rendition)
    lockedLeft = pageScrollLeft(pageIndexAt(container.scrollLeft, step, maxScrollLeft()), step, maxScrollLeft())
    if (container.scrollLeft !== lockedLeft) container.scrollLeft = lockedLeft
    frozen = new Map()
    const keep = (element: Element | null | undefined) => {
      if (element && element !== container) frozen.set(element, { left: element.scrollLeft, top: element.scrollTop })
    }
    for (let element = container.parentElement; element; element = element.parentElement) keep(element)
    keep(document.scrollingElement)
    keep(sectionDoc?.scrollingElement)
  }

  const endLock = () => {
    cancelDwell()
    lockedLeft = null
    frozen = new Map()
  }

  /** The edge the selection's moving end is at right now, or null. */
  const edgeNow = (): SelectionEdge | null => {
    const doc = sectionDoc
    const selection = liveSelection(doc)
    const frame = doc?.defaultView?.frameElement as HTMLElement | null | undefined
    if (!doc || !selection || !frame) return null
    const box = focusBox(doc, selection)
    if (!box) return null
    const frameRect = frame.getBoundingClientRect()
    const scale = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1
    const body = doc.body
    const bodyStyle = doc.defaultView?.getComputedStyle(body)
    const padTop = parseFloat(bodyStyle?.paddingTop ?? '0') || 0
    const padBottom = parseFloat(bodyStyle?.paddingBottom ?? '0') || 0
    const bodyRect = body.getBoundingClientRect()
    const viewHeight = doc.documentElement.clientHeight || bodyRect.bottom
    const textTop = Math.max(bodyRect.top, 0) + padTop
    const textBottom = Math.min(bodyRect.bottom, viewHeight) - padBottom
    const visible = container.getBoundingClientRect()
    const column = (manager?.layout?.pageWidth || manager?.layout?.columnWidth || 0) * scale
    return selectionEdgeAt({
      focus: {
        left: frameRect.left + box.left * scale,
        top: frameRect.top + box.top * scale,
        bottom: frameRect.top + box.bottom * scale,
      },
      forward: isForward(selection),
      visible: { left: visible.left, right: visible.right },
      text: { top: frameRect.top + textTop * scale, bottom: frameRect.top + textBottom * scale },
      columnWidth: column,
      lineHeight: lineHeightAt(doc, selection.focusNode) * scale,
    })
  }

  const turn = (edge: SelectionEdge) => {
    const step = getRenditionLayoutDelta(rendition)
    const page = pageIndexAt(lockedLeft ?? container.scrollLeft, step, maxScrollLeft())
    const target = turnedPageScrollLeft(page, edge, step, maxScrollLeft())
    if (target === null) return
    lockedLeft = target
    container.scrollLeft = target
  }

  /** Arm / keep / drop the dwell timer for the edge the selection is at now. */
  const evaluate = () => {
    if (!enabled() || !liveSelection(sectionDoc)) {
      cancelDwell()
      return
    }
    const edge = edgeNow()
    if (dwell?.edge === edge) return
    cancelDwell()
    if (!edge) return
    dwell = {
      edge,
      timer: window.setTimeout(() => {
        dwell = null
        // Still at that edge after the dwell: turn one page, then look again (held there = the next page too).
        if (enabled() && liveSelection(sectionDoc) && edgeNow() === edge) {
          turn(edge)
          requestAnimationFrame(evaluate)
        }
      }, SELECTION_EDGE_DWELL_MS),
    }
  }

  const onSelectionChange = () => {
    if (!enabled()) return
    if (!liveSelection(sectionDoc)) {
      endLock()
      return
    }
    lastSelectionChangeAt = performance.now()
    if (lockedLeft === null) beginLock()
    evaluate()
  }

  /** Any scroll while a drag is in progress is the browser's: put it back. */
  const onAnyScroll = (event: Event) => {
    if (lockedLeft === null || !enabled() || !liveSelection(sectionDoc)) return
    if (!dragging() && !dwell) return
    // Duck-typed: the section document and its nodes belong to the iframe's realm (`instanceof` would fail).
    const target = event.target as (Node & { scrollingElement?: Element | null }) | null
    const element =
      target?.nodeType === Node.DOCUMENT_NODE
        ? (target.scrollingElement ?? null)
        : target?.nodeType === Node.ELEMENT_NODE
          ? (target as unknown as Element)
          : null
    if (!element) return
    if (element === container) {
      if (Math.abs(container.scrollLeft - lockedLeft) > 0.5) container.scrollLeft = lockedLeft
      return
    }
    const kept = frozen.get(element)
    if (!kept) return
    if (element.scrollLeft !== kept.left) element.scrollLeft = kept.left
    if (element.scrollTop !== kept.top) element.scrollTop = kept.top
  }

  const onPointerDown = () => {
    pressed = true
  }
  const onPointerUp = () => {
    pressed = false
  }

  const unbindSection = () => {
    if (!sectionDoc) return
    sectionDoc.removeEventListener('selectionchange', onSelectionChange)
    sectionDoc.removeEventListener('scroll', onAnyScroll, true)
    sectionDoc.removeEventListener('pointerdown', onPointerDown, true)
    sectionDoc.removeEventListener('pointerup', onPointerUp, true)
    sectionDoc.removeEventListener('pointercancel', onPointerUp, true)
    sectionDoc = null
  }
  const bindSection = () => {
    const doc = currentSectionDocument(rendition)
    if (doc === sectionDoc) return
    unbindSection()
    endLock()
    pressed = false
    sectionDoc = doc
    if (!doc) return
    doc.addEventListener('selectionchange', onSelectionChange)
    doc.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })
    doc.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    doc.addEventListener('pointerup', onPointerUp, { capture: true, passive: true })
    doc.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true })
  }

  bindSection()
  rendition.on('rendered', bindSection)
  document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })
  window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true })

  return () => {
    endLock()
    unbindSection()
    rendition.off('rendered', bindSection)
    document.removeEventListener('scroll', onAnyScroll, true)
    window.removeEventListener('pointerup', onPointerUp, true)
  }
}
