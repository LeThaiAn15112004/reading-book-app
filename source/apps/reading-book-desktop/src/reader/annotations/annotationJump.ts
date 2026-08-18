/**
 * Jump-to-annotation helpers — instant center-in-viewport + flash.
 * Used after chapter/CFI navigation so layout heights are ready.
 * Read Era / Foxit style: land on the final centered frame (no smooth pan).
 */

import { READER_CHROME_TRANSITION_MS } from '../chrome/readerChromeInteraction'

export type AnnotationFocusTarget =
  | { kind: 'highlight'; id: string }
  | { kind: 'typewriter'; id: string }

export const ANNOTATION_JUMP_FLASH_CLASS = 'rb-annotation-jump-flash'
export const ANNOTATION_JUMP_FLASH_MS = 900

/** Extra settle time after chrome resize for DomCssOverlay paint / portal mount. */
export const ANNOTATION_JUMP_PAINT_DELAY_MS = 80

const JUMP_VIEWPORT_SUPPRESS_ATTR = 'data-rb-annotation-jump-suppress'

function cssEscapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function annotationFocusSelector(target: AnnotationFocusTarget): string {
  if (target.kind === 'highlight') {
    return `[data-rb-hl-id="${cssEscapeAttr(target.id)}"]`
  }
  return `[data-rb-tw-note="${cssEscapeAttr(target.id)}"], [data-typewriter-note="${cssEscapeAttr(target.id)}"]`
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** Wait for chrome layout transition + one paint frame + short paint delay. */
export async function waitForAnnotationLayoutSettle(
  chromeWasLikelyToggled = true,
): Promise<void> {
  if (chromeWasLikelyToggled) {
    await waitMs(READER_CHROME_TRANSITION_MS)
  } else {
    await waitMs(ANNOTATION_JUMP_PAINT_DELAY_MS)
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  await waitMs(ANNOTATION_JUMP_PAINT_DELAY_MS)
}

/**
 * Hide the EPUB host while navigating + centering so the user only sees the
 * final frame (avoids continuous-mode flash at section start).
 */
export function setAnnotationJumpViewportHidden(
  host: HTMLElement | null,
  hidden: boolean,
): void {
  if (!host) return
  if (hidden) {
    host.setAttribute(JUMP_VIEWPORT_SUPPRESS_ATTR, '1')
    host.style.visibility = 'hidden'
    return
  }
  host.removeAttribute(JUMP_VIEWPORT_SUPPRESS_ATTR)
  host.style.visibility = ''
}

export async function waitForAnnotationElement(
  root: ParentNode,
  selector: string,
  timeoutMs = 900,
): Promise<Element | null> {
  const existing = root.querySelector(selector)
  if (existing) return existing

  const started = performance.now()
  while (performance.now() - started < timeoutMs) {
    await waitMs(40)
    const found = root.querySelector(selector)
    if (found) return found
  }
  return root.querySelector(selector)
}

/** Continuous mode mounts several section iframes — find the painted mark in any. */
async function waitForAnnotationElementInEpubHost(
  host: HTMLElement,
  selector: string,
  timeoutMs = 900,
): Promise<Element | null> {
  const find = (): Element | null => {
    for (const iframe of host.querySelectorAll('iframe')) {
      const doc = iframe.contentDocument
      if (!doc) continue
      const el = doc.querySelector(selector)
      if (el) return el
    }
    return null
  }

  const existing = find()
  if (existing) return existing

  const started = performance.now()
  while (performance.now() - started < timeoutMs) {
    await waitMs(40)
    const found = find()
    if (found) return found
  }
  return find()
}

function topLevelRect(el: Element): DOMRect {
  const rect = el.getBoundingClientRect()
  const view = el.ownerDocument.defaultView
  const frameEl = view?.frameElement as HTMLElement | null
  if (!frameEl) return rect
  const fr = frameEl.getBoundingClientRect()
  return new DOMRect(
    rect.left + fr.left,
    rect.top + fr.top,
    rect.width,
    rect.height,
  )
}

function resolveScrollRoot(host: HTMLElement, doc: Document): HTMLElement {
  const outer = host.querySelector<HTMLElement>('.epub-container')
  if (
    outer &&
    (outer.scrollHeight > outer.clientHeight + 1 ||
      outer.scrollWidth > outer.clientWidth + 1)
  ) {
    return outer
  }
  const scrolling = doc.scrollingElement
  if (
    scrolling instanceof HTMLElement &&
    scrolling.scrollHeight > scrolling.clientHeight + 1
  ) {
    return scrolling
  }
  if (doc.documentElement.scrollHeight > doc.documentElement.clientHeight + 1) {
    return doc.documentElement
  }
  if (doc.body && doc.body.scrollHeight > doc.body.clientHeight + 1) {
    return doc.body
  }
  return (
    (scrolling instanceof HTMLElement ? scrolling : null) ??
    doc.documentElement
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * Center the annotation in the viewport instantly (Read Era / Foxit style).
 * Near document start/end, scroll is clamped so the mark stays in view.
 * Handles iframe marks whose scroll root is the host `.epub-container`.
 */
export function scrollAnnotationIntoCenterView(
  el: Element,
  host: HTMLElement | null,
): void {
  const doc = el.ownerDocument
  const scrollRoot = host ? resolveScrollRoot(host, doc) : null

  if (!scrollRoot || scrollRoot === doc.documentElement || scrollRoot === doc.body) {
    el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
    return
  }

  const er = topLevelRect(el)
  const rr = scrollRoot.getBoundingClientRect()

  // Align mark center to scroll-root center; clamp to scrollable range.
  const dy = er.top + er.height / 2 - (rr.top + rr.height / 2)
  const dx = er.left + er.width / 2 - (rr.left + rr.width / 2)

  const maxTop = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight)
  const maxLeft = Math.max(0, scrollRoot.scrollWidth - scrollRoot.clientWidth)
  const nextTop = clamp(scrollRoot.scrollTop + dy, 0, maxTop)
  const nextLeft = clamp(scrollRoot.scrollLeft + dx, 0, maxLeft)

  const topDelta = nextTop - scrollRoot.scrollTop
  const leftDelta = nextLeft - scrollRoot.scrollLeft
  if (Math.abs(topDelta) < 1 && Math.abs(leftDelta) < 1) return

  // Instant jump — never smooth-pan from a provisional display(cfi) land.
  scrollRoot.scrollTop = nextTop
  scrollRoot.scrollLeft = nextLeft
}

/** @deprecated Prefer {@link scrollAnnotationIntoCenterView}. */
export const scrollAnnotationIntoNearestView = scrollAnnotationIntoCenterView

/** Temporary flash so the jumped annotation is easy to spot. */
export function flashAnnotationElement(el: Element): void {
  const targets: Element[] = el.hasAttribute('data-rb-hl-id')
    ? Array.from(
        el.ownerDocument.querySelectorAll(
          `[data-rb-hl-id="${cssEscapeAttr(el.getAttribute('data-rb-hl-id') ?? '')}"]`,
        ),
      )
    : [el]

  for (const target of targets) {
    target.classList.remove(ANNOTATION_JUMP_FLASH_CLASS)
    // Force restart if the class was still present from a prior jump.
    void (target as HTMLElement).offsetWidth
    target.classList.add(ANNOTATION_JUMP_FLASH_CLASS)
  }

  window.setTimeout(() => {
    for (const target of targets) {
      target.classList.remove(ANNOTATION_JUMP_FLASH_CLASS)
    }
  }, ANNOTATION_JUMP_FLASH_MS)
}

/**
 * After navigate: find mark in any EPUB iframe, instant center-scroll, flash.
 */
export async function focusAnnotationInEpubHost(
  host: HTMLElement,
  target: AnnotationFocusTarget,
): Promise<boolean> {
  const selector = annotationFocusSelector(target)
  const el = await waitForAnnotationElementInEpubHost(host, selector)
  if (!el) return false

  scrollAnnotationIntoCenterView(el, host)
  // One more pass after layout/paint — chrome resize can nudge heights.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  scrollAnnotationIntoCenterView(el, host)
  flashAnnotationElement(el)
  return true
}

/** Host-document jump (fake ReadingCanvas). */
export async function focusAnnotationInDocument(
  root: ParentNode,
  target: AnnotationFocusTarget,
  scrollHost: HTMLElement | null = null,
): Promise<boolean> {
  const selector = annotationFocusSelector(target)
  const el = await waitForAnnotationElement(root, selector)
  if (!el) return false
  scrollAnnotationIntoCenterView(el, scrollHost)
  flashAnnotationElement(el)
  return true
}
