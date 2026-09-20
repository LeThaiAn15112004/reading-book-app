/** Reading-surface cursor + user-select — CSS-first (Foxit/Adobe style). */

import type { InteractionTool } from '@reading-book/book-reader-sdk'
import { TEXT_CURSOR_SELECTOR } from './interaction-hit'

const SURFACE_STYLE_ID = 'rb-interaction-surface-style'

const SURFACE_CLASSES = [
  'rb-tool-hand',
  'rb-tool-select',
  'rb-tool-highlight',
  'rb-tool-underline',
  'rb-tool-strikethrough',
  'rb-grabbing',
  'rb-hover-text',
] as const

/** Text-bearing tags — I-beam only after Hand hover dwell (`rb-hover-text`). */
const TEXT_CURSOR_CSS = TEXT_CURSOR_SELECTOR

/**
 * Stylesheet injected into EPUB iframes.
 * Hand I-beam/pointer over text requires `rb-hover-text` (armed after hover dwell).
 */
/**
 * Cursor `url(...)` references injected into an EPUB section iframe must be fully-qualified
 * (`http(s)://origin/...`), not path-absolute (`/cursors/x.svg`) — epub.js sections are blob:
 * documents, and blob: is not a "special" URL scheme, so path-absolute references inside them
 * don't resolve against the app's origin the way they would in a normal http(s) document.
 */
function originUrl(path: string): string {
  return `${window.location.origin}${path}`
}

function surfaceStyleCss(): string {
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

/* After hover dwell: I-beam on text, pointer on links. */
html.rb-tool-hand.rb-hover-text :where(${TEXT_CURSOR_CSS}) {
  cursor: text;
}

html.rb-tool-hand.rb-hover-text :where(a[href], a[href] *, button, [role="button"], summary) {
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

/* Highlight / Underline: same native-selection surface as Select, custom pen cursor. */
html.rb-tool-highlight,
html.rb-tool-highlight body {
  cursor: url(${originUrl('/cursors/highlighter.svg')}) 6 28, text;
  user-select: text;
  -webkit-user-select: text;
}

html.rb-tool-underline,
html.rb-tool-underline body {
  cursor: url(${originUrl('/cursors/underline.svg')}) 6 28, text;
  user-select: text;
  -webkit-user-select: text;
}

/* Strikethrough: same native-selection surface, reuses the underline cursor art (no dedicated
   asset — mirrors how the mark itself reuses underline geometry in openEpubjs.ts). */
html.rb-tool-strikethrough,
html.rb-tool-strikethrough body {
  cursor: url(${originUrl('/cursors/underline.svg')}) 6 28, text;
  user-select: text;
  -webkit-user-select: text;
}
`
}

function ensureSurfaceStyles(doc: Document): void {
  const parent = doc.head ?? doc.documentElement
  if (!parent) return // iframe document torn down / not yet ready (e.g. about:blank mid-swap)
  let style = doc.getElementById(SURFACE_STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.id = SURFACE_STYLE_ID
    parent.appendChild(style)
  }
  // Rewrite so rules stay current across HMR / new iframes.
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
) {
  el.classList.remove(...SURFACE_CLASSES)
  el.classList.add(`rb-tool-${tool}`)
  if (grabbing && tool === 'hand') el.classList.add('rb-grabbing')
  if (hoverText && tool === 'hand' && !grabbing) el.classList.add('rb-hover-text')
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
  },
) {
  if (!root) return
  const grabbing = options?.grabbing === true
  const hoverText = options?.hoverText === true

  if (root instanceof HTMLElement) {
    clearInlineCursorSelect(root)
    setSurfaceClasses(root, tool, grabbing, hoverText)
  }

  root.querySelectorAll('iframe').forEach((iframe) => {
    clearInlineCursorSelect(iframe)
    setSurfaceClasses(iframe, tool, grabbing, hoverText)
    const doc = iframe.contentDocument
    if (!doc) return
    ensureSurfaceStyles(doc)
    if (doc.documentElement) {
      clearInlineCursorSelect(doc.documentElement)
      setSurfaceClasses(doc.documentElement, tool, grabbing, hoverText)
    }
    if (doc.body) {
      clearInlineCursorSelect(doc.body)
      setSurfaceClasses(doc.body, tool, grabbing, hoverText)
    }
  })
}
