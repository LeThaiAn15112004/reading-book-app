/**
 * Stable drag-selection on PDF.js text layers — a port of what pdf.js's own viewer
 * (`TextLayerBuilder` in pdfjs-dist/web/pdf_viewer.mjs) adds on top of the bare `TextLayer` we use.
 *
 * Without it, dragging through the empty space between glyph runs (between paragraphs, past a
 * line end, the page margin) lands the pointer on the `.textLayer` div itself, and Chromium snaps
 * the selection focus to the END of the layer — the selection jumps over everything below the
 * pointer. The fix, as in pdf.js:
 *  - every text layer gets a trailing `.endOfContent` div (`user-select: none`);
 *  - while a drag is in progress (`.textLayer.selecting`, pdf_viewer.css; armed by `selectionchange`
 *    with the pointer held, NOT on mousedown — a press in a gap before a paragraph's first glyph
 *    would otherwise anchor on the full-layer filler at the end of the page) it stretches over the
 *    whole layer, so gaps hit it instead of the layer; it stays `user-select: none`;
 *  - on every `selectionchange` it is moved right after the selection's moving end, so the text
 *    after that point is "behind" it and the browser extends the selection only up to there.
 * Pointer up / blur / keyup (outside a drag) put it back at the end, and a `selectionchange` with
 * no pointer held never arms it.
 */

/** Text layer div → its `.endOfContent` element. */
const textLayers = new Map<HTMLElement, HTMLElement>()
let listenersAbort: AbortController | null = null

function reset(end: HTMLElement, textLayer: HTMLElement): void {
  textLayer.append(end)
  end.style.width = ''
  end.style.height = ''
  end.style.userSelect = ''
  textLayer.classList.remove('selecting')
}

function resetAll(): void {
  for (const [textLayer, end] of textLayers) reset(end, textLayer)
}

function enableGlobalListeners(): void {
  if (listenersAbort) return
  listenersAbort = new AbortController()
  const { signal } = listenersAbort
  let pointerDown = false
  let prevRange: Range | null = null

  document.addEventListener('pointerdown', () => (pointerDown = true), { signal })
  document.addEventListener(
    'pointerup',
    () => {
      pointerDown = false
      resetAll()
    },
    { signal },
  )
  window.addEventListener(
    'blur',
    () => {
      pointerDown = false
      resetAll()
    },
    { signal },
  )
  document.addEventListener(
    'keyup',
    () => {
      if (!pointerDown) resetAll()
    },
    { signal },
  )
  document.addEventListener(
    'selectionchange',
    () => {
      // Pages released by virtualization are gone from the DOM; forget them.
      for (const textLayer of [...textLayers.keys()]) if (!textLayer.isConnected) textLayers.delete(textLayer)
      const selection = document.getSelection()
      if (!selection || selection.rangeCount === 0) {
        resetAll()
        return
      }
      // `selectionchange` often fires AFTER pointerup (end of a drag, double click, programmatic
      // change). Arming the helper then would leave the full-layer `.endOfContent` parked behind
      // the old selection with nothing left to reset it, and the next press in a gap (paragraph
      // start) would snap the new selection to it. Only a held pointer drags.
      if (!pointerDown) {
        resetAll()
        return
      }
      const active = new Set<HTMLElement>()
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i)
        for (const textLayer of textLayers.keys()) {
          if (!active.has(textLayer) && range.intersectsNode(textLayer)) active.add(textLayer)
        }
      }
      for (const [textLayer, end] of textLayers) {
        if (active.has(textLayer)) textLayer.classList.add('selecting')
        else reset(end, textLayer)
      }

      const range = selection.getRangeAt(0)
      // Which end is moving: the start when the end stayed put since the last change.
      const modifyStart =
        !!prevRange &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0)
      let anchor: Node = modifyStart ? range.startContainer : range.endContainer
      if (anchor.nodeType === Node.TEXT_NODE && anchor.parentNode) anchor = anchor.parentNode
      if (!modifyStart && range.endOffset === 0) {
        // The end sits at the very start of a node: anchor after the previous non-empty one.
        do {
          while (!anchor.previousSibling && anchor.parentNode) anchor = anchor.parentNode
          if (!anchor.previousSibling) break
          anchor = anchor.previousSibling
        } while (!anchor.childNodes.length)
      }
      const parentTextLayer = anchor.parentElement?.closest<HTMLElement>('.textLayer')
      const end = parentTextLayer ? textLayers.get(parentTextLayer) : undefined
      if (end && parentTextLayer && anchor.parentElement) {
        end.style.width = parentTextLayer.style.width
        end.style.height = parentTextLayer.style.height
        anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling)
      }
      prevRange = range.cloneRange()
    },
    { signal },
  )
}

/** Give a freshly rendered text layer the `.endOfContent` helper and stable drag-selection. */
export function attachTextLayerSelection(textLayer: HTMLElement): void {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  textLayer.append(end)
  textLayers.set(textLayer, end)
  enableGlobalListeners()
}

/** Forget a text layer that is being removed; drops the global listeners with the last one. */
export function detachTextLayerSelection(textLayer: HTMLElement | null | undefined): void {
  if (!textLayer) return
  textLayers.delete(textLayer)
  if (textLayers.size === 0) {
    listenersAbort?.abort()
    listenersAbort = null
  }
}
