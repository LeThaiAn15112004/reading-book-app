/**
 * EPUB typewriter layer — notes live inside the section iframe so they scroll
 * with book content (same document as DomCssOverlay highlights).
 */

export const TYPEWRITER_LAYER_ATTR = 'data-rb-tw-layer'
export const TYPEWRITER_NOTE_ATTR = 'data-rb-tw-note'
export const TYPEWRITER_DRAFT_ATTR = 'data-rb-tw-draft'
export const TYPEWRITER_STYLE_ATTR = 'data-rb-tw-style'

/** True when an element belongs to the in-iframe typewriter overlay. */
export function isTypewriterOverlayElement(el: Element | null): boolean {
  if (!el?.closest) return false
  return Boolean(
    el.closest(
      `[${TYPEWRITER_LAYER_ATTR}], [${TYPEWRITER_NOTE_ATTR}], [${TYPEWRITER_DRAFT_ATTR}]`,
    ),
  )
}

/**
 * Ensure body is a positioning context and inject the typewriter mount layer + CSS.
 * Returns the layer element for React portals, or null if the iframe doc is not ready.
 */
export function ensureTypewriterIframeLayer(doc: Document): HTMLElement | null {
  const host = doc.body ?? doc.documentElement
  if (!host) return null

  ensureTypewriterIframeStyles(doc)

  const body = doc.body
  if (body) {
    const pos = doc.defaultView?.getComputedStyle(body).position
    if (!pos || pos === 'static') {
      body.style.position = 'relative'
    }
  }

  let layer = doc.querySelector(
    `[${TYPEWRITER_LAYER_ATTR}]`,
  ) as HTMLElement | null
  if (!layer) {
    layer = doc.createElement('div')
    layer.setAttribute(TYPEWRITER_LAYER_ATTR, '1')
    layer.className = 'rb-tw-layer'
  }

  layer.style.position = 'absolute'
  layer.style.left = '0'
  layer.style.top = '0'
  layer.style.width = '0'
  layer.style.height = '0'
  layer.style.overflow = 'visible'
  layer.style.pointerEvents = 'none'
  layer.style.zIndex = '10'

  if (layer.parentNode !== host) {
    host.appendChild(layer)
  }
  return layer
}

function ensureTypewriterIframeStyles(doc: Document): void {
  const styleHost = doc.head ?? doc.documentElement
  if (!styleHost) return

  let style = doc.querySelector(
    `style[${TYPEWRITER_STYLE_ATTR}]`,
  ) as HTMLStyleElement | null
  if (!style) {
    style = doc.createElement('style')
    style.setAttribute(TYPEWRITER_STYLE_ATTR, '1')
    styleHost.appendChild(style)
  }

  // Mirror host `index.css` typewriter rules — iframe docs do not inherit them.
  style.textContent = `
    .rb-tw-layer {
      position: absolute; left: 0; top: 0; width: 0; height: 0;
      overflow: visible; pointer-events: none; z-index: 10;
    }
    .rb-tw-layer > * {
      pointer-events: auto;
    }
    /* Tailwind utilities do not exist inside the EPUB iframe — pin boxes here. */
    [${TYPEWRITER_NOTE_ATTR}],
    [${TYPEWRITER_DRAFT_ATTR}] {
      position: absolute;
      transform: translate(-50%, -50%);
      z-index: 5;
      box-sizing: border-box;
    }
    [${TYPEWRITER_DRAFT_ATTR}] {
      z-index: 6;
    }
    @keyframes rb-annotation-jump-flash {
      0%, 100% { filter: brightness(1); box-shadow: none; }
      35% { filter: brightness(1.35); box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.85); }
      55% { filter: brightness(1.15); box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.55); }
    }
    .rb-annotation-jump-flash {
      animation: rb-annotation-jump-flash 0.9s ease-in-out;
      z-index: 7 !important;
    }
    .rb-typewriter-edit {
      box-sizing: border-box;
      min-height: 2.25rem;
      width: 12rem;
      margin: 0;
      padding: 0.25rem 0.35rem;
      resize: both;
      overflow: auto;
      border: 1px dashed #ffa500;
      border-radius: 2px;
      background-color: transparent;
      outline: none;
      box-shadow: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.35;
      caret-color: #ffa500;
    }
    .rb-typewriter-richedit {
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
      user-select: text;
      -webkit-user-select: text;
    }
    .rb-typewriter-richedit[data-empty='true']:before {
      content: attr(data-placeholder);
      color: rgba(128, 128, 128, 0.55);
      pointer-events: none;
    }
    .rb-typewriter-edit:focus,
    .rb-typewriter-edit:focus-visible {
      outline: none;
      box-shadow: none;
    }
    .rb-typewriter-static {
      box-sizing: border-box;
      width: max-content;
      max-width: min(16rem, 70vw);
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.35;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
      text-align: left;
      cursor: grab;
    }
    .rb-typewriter-html {
      display: inline-block;
      width: max-content;
      max-width: min(16rem, 70vw);
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      line-height: 1.35;
    }
    .rb-typewriter-html b,
    .rb-typewriter-html strong,
    .rb-typewriter-richedit b,
    .rb-typewriter-richedit strong { font-weight: 700; }
    .rb-typewriter-html i,
    .rb-typewriter-html em,
    .rb-typewriter-richedit i,
    .rb-typewriter-richedit em { font-style: italic; }
    .rb-typewriter-html u,
    .rb-typewriter-richedit u { text-decoration: underline; }
    .rb-tw-editor-root { min-width: 12rem; }
    .rb-typewriter-drag-handle {
      position: absolute;
      top: -0.55rem;
      left: 50%;
      z-index: 1;
      width: 1.75rem;
      height: 0.4rem;
      margin: 0;
      padding: 0;
      border: 1px solid #ffa500;
      border-radius: 999px;
      background: color-mix(in srgb, #ffa500 35%, transparent);
      transform: translateX(-50%);
      cursor: grab;
    }
    .rb-typewriter-drag-handle:active,
    .rb-typewriter-dragging .rb-typewriter-drag-handle,
    .rb-typewriter-dragging .rb-typewriter-static {
      cursor: grabbing;
    }
    .rb-typewriter-dragging .rb-typewriter-edit {
      border-color: #ffb733;
      box-shadow: 0 0 0 1px color-mix(in srgb, #ffa500 40%, transparent);
    }
  `
}
