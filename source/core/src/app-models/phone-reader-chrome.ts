/**
 * The phone reader's chrome rules (spec 019, FR-001 / FR-002 / FR-004 / FR-008 / FR-021, research R8): which bars are
 * shown and which layers are open, as one pure reducer. The app's `phoneReaderChromeStore` holds the state; Back,
 * auto-hide and swipe page turns all read it. Pure: no DOM, no timers (the store runs the idle timer from
 * `idleTimerRunning`).
 */

/** Layers over the page, listed bottom to top in the order they were opened (top = last). */
export type ChromeLayer = 'selection' | 'toc' | 'marks' | 'appearance' | 'mark' | 'confirm'

export interface ChromeToast {
  id: number
  text: string
}

export interface ChromeState {
  /** The open book; a different id resets every other field. */
  bookId: string | null
  barsVisible: boolean
  /** Ordered, top last, no duplicates. */
  layers: readonly ChromeLayer[]
  sliderDragging: boolean
  toast: ChromeToast | null
  /** Measured top bar height, else the safe-area top (FR-012). */
  topInsetPx: number
}

export type ChromeEvent =
  | { type: 'open-book'; bookId: string | null }
  | { type: 'tap-middle' }
  | { type: 'page-turned' }
  | { type: 'scrolled' }
  | { type: 'idle-elapsed' }
  | { type: 'show-bars' }
  | { type: 'layer-open'; layer: ChromeLayer }
  | { type: 'layer-close'; layer: ChromeLayer }
  | { type: 'slider-drag'; on: boolean }
  | { type: 'toast'; text: string }
  | { type: 'toast-expired'; id: number }
  | { type: 'top-inset'; px: number }

/** Bars hide after this long without interaction (FR-008). */
export const CHROME_IDLE_MS = 4000
/** A toast stays this long. */
export const CHROME_TOAST_MS = 2400

export function initialChromeState(bookId: string | null = null): ChromeState {
  return { bookId, barsVisible: false, layers: [], sliderDragging: false, toast: null, topInsetPx: 0 }
}

export function reduceChrome(state: ChromeState, event: ChromeEvent): ChromeState {
  switch (event.type) {
    case 'open-book':
      // Keeps the measured inset: it belongs to the screen, not the book.
      return { ...initialChromeState(event.bookId), topInsetPx: state.topInsetPx }
    case 'tap-middle': {
      if (state.layers.length > 0) return { ...state, layers: state.layers.slice(0, -1) }
      return { ...state, barsVisible: !state.barsVisible }
    }
    case 'page-turned':
    case 'scrolled':
      return state.barsVisible ? { ...state, barsVisible: false } : state
    case 'idle-elapsed':
      if (!state.barsVisible || state.layers.length > 0 || state.sliderDragging) return state
      return { ...state, barsVisible: false }
    case 'show-bars':
      return state.barsVisible ? state : { ...state, barsVisible: true }
    case 'layer-open': {
      const rest = state.layers.filter((l) => l !== event.layer)
      return { ...state, layers: [...rest, event.layer] }
    }
    case 'layer-close': {
      const at = state.layers.indexOf(event.layer)
      if (at < 0) return state
      return { ...state, layers: state.layers.slice(0, at) }
    }
    case 'slider-drag':
      return state.sliderDragging === event.on ? state : { ...state, sliderDragging: event.on }
    case 'toast':
      return { ...state, toast: { id: (state.toast?.id ?? 0) + 1, text: event.text } }
    case 'toast-expired':
      return state.toast?.id === event.id ? { ...state, toast: null } : state
    case 'top-inset':
      return state.topInsetPx === event.px ? state : { ...state, topInsetPx: event.px }
  }
}

/** Page turns by swipe or edge tap only with nothing over the page (FR-004). */
export function swipesAllowed(state: ChromeState): boolean {
  return state.layers.length === 0
}

/** The idle timer counts only while the bars show over a bare page and the slider is not held. */
export function idleTimerRunning(state: ChromeState): boolean {
  return state.barsVisible && state.layers.length === 0 && !state.sliderDragging
}

export function topLayer(state: ChromeState): ChromeLayer | null {
  return state.layers[state.layers.length - 1] ?? null
}

export function hasLayer(state: ChromeState, layer: ChromeLayer): boolean {
  return state.layers.includes(layer)
}
