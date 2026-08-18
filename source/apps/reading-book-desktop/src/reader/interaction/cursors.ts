/** Reading-surface cursor + user-select — CSS-first (Foxit/Adobe style). */

import type { InteractionTool } from '@reading-book/shared/models'
import { TEXT_CURSOR_SELECTOR } from './interaction-hit'

/** Hotspot at the chisel tip (bottom-left of the 32×32 SVG). */
const HIGHLIGHT_CURSOR_HOTSPOT = { x: 6, y: 28 } as const
const HIGHLIGHT_CURSOR_PATH = '/cursors/highlighter.svg'

/** Hotspot near the I-beam tip on the typewriter cursor SVG. */
const TYPEWRITER_CURSOR_HOTSPOT = { x: 16, y: 26 } as const
const TYPEWRITER_CURSOR_PATH = '/cursors/typewriter.svg'

/** Hotspot at the pencil tip (bottom-left). */
const PENCIL_CURSOR_HOTSPOT = { x: 4, y: 28 } as const
const PENCIL_CURSOR_PATH = '/cursors/pencil.svg'

const SURFACE_STYLE_ID = 'rb-interaction-surface-style'

const SURFACE_CLASSES = [
  'rb-tool-hand',
  'rb-tool-select',
  'rb-tool-highlight',
  'rb-tool-typewriter',
  'rb-tool-annotate',
  'rb-drawing-pencil',
  'rb-drawing-eraser',
  'rb-grabbing',
  'rb-hover-text',
] as const

/** Text-bearing tags — I-beam only after Hand hover dwell (`rb-hover-text`). */
const TEXT_CURSOR_CSS = TEXT_CURSOR_SELECTOR

export function highlightToolCursorCss(): string {
  const href =
    typeof window !== 'undefined'
      ? new URL(HIGHLIGHT_CURSOR_PATH, window.location.origin).href
      : HIGHLIGHT_CURSOR_PATH
  return `url("${href}") ${HIGHLIGHT_CURSOR_HOTSPOT.x} ${HIGHLIGHT_CURSOR_HOTSPOT.y}, text`
}

export function typewriterToolCursorCss(): string {
  const href =
    typeof window !== 'undefined'
      ? new URL(TYPEWRITER_CURSOR_PATH, window.location.origin).href
      : TYPEWRITER_CURSOR_PATH
  return `url("${href}") ${TYPEWRITER_CURSOR_HOTSPOT.x} ${TYPEWRITER_CURSOR_HOTSPOT.y}, text`
}

export function pencilToolCursorCss(): string {
  const href =
    typeof window !== 'undefined'
      ? new URL(PENCIL_CURSOR_PATH, window.location.origin).href
      : PENCIL_CURSOR_PATH
  return `url("${href}") ${PENCIL_CURSOR_HOTSPOT.x} ${PENCIL_CURSOR_HOTSPOT.y}, crosshair`
}

/**
 * Stylesheet injected into EPUB iframes.
 * Hand I-beam/pointer over text requires `rb-hover-text` (armed after hover dwell).
 */
function surfaceStyleCss(): string {
  const highlightCursor = highlightToolCursorCss()
  const typewriterCursor = typewriterToolCursorCss()
  const pencilCursor = pencilToolCursorCss()
  return `
/* Hand default: grab everywhere — avoids cursor flicker while panning over text. */
html.rb-tool-hand,
html.rb-tool-hand body {
  cursor: grab;
  user-select: text;
  -webkit-user-select: text;
}

html.rb-tool-hand :where(img, svg, video, canvas, iframe) {
  cursor: grab;
}

/* After hover dwell: I-beam on text, pointer on links / annotation hits. */
html.rb-tool-hand.rb-hover-text :where(${TEXT_CURSOR_CSS}) {
  cursor: text;
}

html.rb-tool-hand.rb-hover-text :where(a[href], a[href] *, button, [role="button"], summary) {
  cursor: pointer;
}

html.rb-tool-hand.rb-hover-text :where([data-rb-hl-id]) {
  cursor: pointer;
}

html.rb-tool-hand.rb-grabbing,
html.rb-tool-hand.rb-grabbing body,
html.rb-tool-hand.rb-grabbing body * {
  cursor: grabbing !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

/* Text Select: I-beam surface; native selection stays on. */
html.rb-tool-select,
html.rb-tool-select body {
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
}

/* Highlight tool: custom cursor; native selection paints on pointerup. */
html.rb-tool-highlight,
html.rb-tool-highlight body {
  cursor: ${highlightCursor};
  user-select: text;
  -webkit-user-select: text;
}

/* Typewriter: custom typewriter + I-beam; block native text select. */
html.rb-tool-typewriter,
html.rb-tool-typewriter body {
  cursor: ${typewriterCursor};
  user-select: none;
  -webkit-user-select: none;
}

html.rb-tool-typewriter body * {
  cursor: ${typewriterCursor};
  user-select: none;
  -webkit-user-select: none;
}

/* Annotate (draw / esign): crosshair; block native text select. */
html.rb-tool-annotate,
html.rb-tool-annotate body {
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
}

html.rb-tool-annotate body * {
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
}

/* Pencil drawing tool: dedicated pencil cursor. */
html.rb-tool-annotate.rb-drawing-pencil,
html.rb-tool-annotate.rb-drawing-pencil body,
html.rb-tool-annotate.rb-drawing-pencil body * {
  cursor: ${pencilCursor};
  user-select: none;
  -webkit-user-select: none;
}

/* Eraser: cell cursor for stroke deletion. */
html.rb-tool-annotate.rb-drawing-eraser,
html.rb-tool-annotate.rb-drawing-eraser body,
html.rb-tool-annotate.rb-drawing-eraser body * {
  cursor: cell;
  user-select: none;
  -webkit-user-select: none;
}
`
}

function ensureSurfaceStyles(doc: Document): void {
  let style = doc.getElementById(SURFACE_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = SURFACE_STYLE_ID
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }
  // Rewrite so highlighter URL + rules stay current across HMR / new iframes.
  style.textContent = surfaceStyleCss()
}

function clearInlineCursorSelect(el: HTMLElement) {
  el.style.removeProperty('cursor')
  el.style.removeProperty('user-select')
  el.style.removeProperty('-webkit-user-select')
}

function setSurfaceClasses(
  el: HTMLElement,
  tool: InteractionTool,
  grabbing: boolean,
  hoverText: boolean,
  drawingTool?: 'pencil' | 'eraser' | null,
) {
  el.classList.remove(...SURFACE_CLASSES)
  el.classList.add(`rb-tool-${tool}`)
  if (grabbing && tool === 'hand') el.classList.add('rb-grabbing')
  if (hoverText && tool === 'hand' && !grabbing) el.classList.add('rb-hover-text')
  if (tool === 'annotate' && drawingTool === 'pencil') {
    el.classList.add('rb-drawing-pencil')
  }
  if (tool === 'annotate' && drawingTool === 'eraser') {
    el.classList.add('rb-drawing-eraser')
  }
}

/**
 * Apply tool class (+ optional grabbing / hover-text) onto the EPUB host and iframes.
 * Cursor / user-select are driven by injected CSS selectors — not inline style overrides.
 * Does not mutate toolbar `activeTool`.
 */
export function applyInteractionToolSurface(
  root: ParentNode | null,
  tool: InteractionTool,
  options?: {
    grabbing?: boolean
    hoverText?: boolean
    drawingTool?: 'pencil' | 'eraser' | null
  },
) {
  if (!root) return
  const grabbing = options?.grabbing === true
  const hoverText = options?.hoverText === true
  const drawingTool = options?.drawingTool ?? null

  if (root instanceof HTMLElement) {
    clearInlineCursorSelect(root)
    setSurfaceClasses(root, tool, grabbing, hoverText, drawingTool)
  }

  root.querySelectorAll('iframe').forEach((iframe) => {
    clearInlineCursorSelect(iframe)
    setSurfaceClasses(iframe, tool, grabbing, hoverText, drawingTool)
    const doc = iframe.contentDocument
    if (!doc) return
    ensureSurfaceStyles(doc)
    if (doc.documentElement) {
      clearInlineCursorSelect(doc.documentElement)
      setSurfaceClasses(
        doc.documentElement,
        tool,
        grabbing,
        hoverText,
        drawingTool,
      )
    }
    if (doc.body) {
      clearInlineCursorSelect(doc.body)
      setSurfaceClasses(doc.body, tool, grabbing, hoverText, drawingTool)
    }
  })
}

/** @deprecated Prefer `applyInteractionToolSurface`. */
export function applyHighlightToolCursor(
  root: ParentNode | null,
  active: boolean,
) {
  applyInteractionToolSurface(root, active ? 'highlight' : 'hand')
}
