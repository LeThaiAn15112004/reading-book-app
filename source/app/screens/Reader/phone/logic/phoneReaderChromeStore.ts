/**
 * The phone reader's ONE chrome state holder (spec 019, FR-021, research R8; reason recorded in
 * `specs/008-shared-core-architecture/contracts/phone-ui.md`, "Mobile-only state").
 *
 * Holds, for the open book only (session-only, reset by `resetFor(bookId)`):
 *   - the chrome: bars shown / hidden, the ordered stack of open layers, the slider-dragging flag, the toast and the
 *     measured top inset — rules in core `reduceChrome`;
 *   - the live values the renderers report and the reading surface reads (Markdown headings / active heading, the
 *     pending Markdown / TXT selection, the text percentage), so `useReadingSurface` keeps no React state of its own.
 *
 * Back (`useBackClose` on each layer), auto-hide (the idle timer below) and swipe page turns (`swipesAllowed`) all read
 * this one store.
 */
import { create } from 'zustand'
import {
  CHROME_IDLE_MS,
  CHROME_TOAST_MS,
  idleTimerRunning,
  initialChromeState,
  reduceChrome,
  swipesAllowed,
  topLayer,
  type ChromeEvent,
  type ChromeLayer,
  type ChromeState,
  type MdHeadingInfo,
} from '@core'
import type { MdSelectionInfo } from '../../../../components/reader/renderers/md'
import type { TxtSelectionInfo } from '../../../../components/reader/renderers/txt'

export interface PhoneSurfaceLive {
  mdHeadings: MdHeadingInfo[]
  mdActiveHeading: number | null
  /** A Markdown selection the renderer reported (its menu request). */
  mdSelection: { selection: MdSelectionInfo; point: { x: number; y: number } } | null
  /** The TXT box's current selection (`TxtRenderer.onSelectionChange`). */
  txtSelection: TxtSelectionInfo | null
  /** 0..100, Markdown / TXT. */
  textPercent: number
}

const EMPTY_LIVE: PhoneSurfaceLive = {
  mdHeadings: [],
  mdActiveHeading: null,
  mdSelection: null,
  txtSelection: null,
  textPercent: 0,
}

interface PhoneReaderChromeStore extends ChromeState {
  live: PhoneSurfaceLive
  dispatch: (event: ChromeEvent) => void
  /** Any touch / key on the page or a bar: restarts the idle countdown. */
  poke: () => void
  showToast: (text: string | null) => void
  openLayer: (layer: ChromeLayer) => void
  closeLayer: (layer: ChromeLayer) => void
  setLive: (patch: Partial<PhoneSurfaceLive>) => void
  /** A different book (or none): everything back to its opening state. */
  resetFor: (bookId: string | null) => void
}

let idleTimer: number | null = null
let toastTimer: number | null = null

function clearIdle() {
  if (idleTimer !== null) window.clearTimeout(idleTimer)
  idleTimer = null
}

export const usePhoneReaderChromeStore = create<PhoneReaderChromeStore>()((set, get) => {
  /** Keeps the idle countdown in step with the state: running only while `idleTimerRunning`. */
  const syncIdle = (restart: boolean) => {
    if (!idleTimerRunning(get())) {
      clearIdle()
      return
    }
    if (idleTimer !== null && !restart) return
    clearIdle()
    idleTimer = window.setTimeout(() => {
      idleTimer = null
      get().dispatch({ type: 'idle-elapsed' })
    }, CHROME_IDLE_MS)
  }

  return {
    ...initialChromeState(),
    live: EMPTY_LIVE,

    dispatch: (raw) => {
      // The store owns the clock: every tap / scroll is stamped here, so the one-tap-one-toggle rule and the scroll
      // grace after a tap (core `TAP_DEDUPE_MS` / `TAP_SCROLL_GRACE_MS`) hold whichever listener reported it.
      const event: ChromeEvent =
        (raw.type === 'tap-middle' || raw.type === 'scrolled') && raw.at === undefined
          ? { ...raw, at: performance.now() }
          : raw
      const before = get()
      const next = reduceChrome(before, event)
      if (next !== before) {
        const { bookId, barsVisible, layers, sliderDragging, toast, topInsetPx, lastTapAt } = next
        set({ bookId, barsVisible, layers, sliderDragging, toast, topInsetPx, lastTapAt })
      }
      // Every interaction restarts the countdown; the timer's own event and toasts do not count as one.
      syncIdle(event.type !== 'idle-elapsed' && event.type !== 'toast' && event.type !== 'toast-expired')
    },

    poke: () => syncIdle(true),

    showToast: (text) => {
      if (toastTimer !== null) window.clearTimeout(toastTimer)
      toastTimer = null
      if (!text) {
        const current = get().toast
        if (current) get().dispatch({ type: 'toast-expired', id: current.id })
        return
      }
      get().dispatch({ type: 'toast', text })
      const id = get().toast?.id
      toastTimer = window.setTimeout(() => {
        toastTimer = null
        if (id !== undefined) get().dispatch({ type: 'toast-expired', id })
      }, CHROME_TOAST_MS)
    },

    openLayer: (layer) => get().dispatch({ type: 'layer-open', layer }),
    closeLayer: (layer) => get().dispatch({ type: 'layer-close', layer }),

    setLive: (patch) => set({ live: { ...get().live, ...patch } }),

    resetFor: (bookId) => {
      if (get().bookId === bookId && bookId !== null) return
      clearIdle()
      if (toastTimer !== null) window.clearTimeout(toastTimer)
      toastTimer = null
      set({ live: EMPTY_LIVE })
      get().dispatch({ type: 'open-book', bookId })
    },
  }
})

/** Imperative reads for event handlers (no re-render). */
export const phoneChrome = {
  get: () => usePhoneReaderChromeStore.getState(),
  swipesAllowed: () => swipesAllowed(usePhoneReaderChromeStore.getState()),
}

export const useBarsVisible = () => usePhoneReaderChromeStore((s) => s.barsVisible)
export const useTopLayer = () => usePhoneReaderChromeStore((s) => topLayer(s))
export const useHasLayer = (layer: ChromeLayer) => usePhoneReaderChromeStore((s) => s.layers.includes(layer))
export const useSwipesAllowed = () => usePhoneReaderChromeStore((s) => swipesAllowed(s))
