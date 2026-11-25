import { create } from 'zustand'

/**
 * Layers (dialogs) that the phone's system Back closes before anything else (spec 014 FR-005, research R5).
 * Mobile-only store — reason (spec 008 `contracts/phone-ui.md`): Android's system Back exists only on the phone, where
 * the host turns it into `history.back()`; Desktop never registers a layer (`useBackClose` is a no-op there).
 *
 * Each open layer owns ONE history entry, tagged with its id, pushed on a 0 ms timer (React StrictMode mounts effects
 * twice in development; the first cleanup cancels the timer instead of pushing and popping) — the technique proven by
 * `PhoneBookSheet`. A `popstate` that leaves the top layer's entry closes that layer; closing a layer any other way
 * pops its entry again, so the next Back goes where it went before.
 */
type BackCloseLayer = { id: string; close: () => void; pushed: boolean; timer: number }

type BackCloseState = {
  stack: BackCloseLayer[]
  /** Registers an open layer; returns its id. */
  push: (close: () => void) => string
  /** The layer closed by its own controls (or unmounted): forget it and drop its history entry. */
  remove: (id: string) => void
}

const HISTORY_KEY = 'readmateBackClose'

function currentEntryId(): unknown {
  return (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY]
}

let listening = false
/**
 * History entries of layers that closed while another layer's entry was on top (a panel closed together with the
 * panels above it, spec 019 FR-001): they can only be popped later, so Back skips over them instead of doing nothing.
 */
const staleEntries = new Set<string>()

export const useBackCloseStore = create<BackCloseState>()((set, get) => ({
  stack: [],
  push: (close) => {
    ensureListening()
    const id = `${Date.now()}-${Math.random()}`
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state as object | null), [HISTORY_KEY]: id }, '')
      set({ stack: get().stack.map((layer) => (layer.id === id ? { ...layer, pushed: true } : layer)) })
    }, 0)
    set({ stack: [...get().stack, { id, close, pushed: false, timer }] })
    return id
  },
  remove: (id) => {
    const layer = get().stack.find((entry) => entry.id === id)
    if (!layer) return
    window.clearTimeout(layer.timer)
    set({ stack: get().stack.filter((entry) => entry.id !== id) })
    if (!layer.pushed) return
    if (currentEntryId() === id) window.history.back()
    else staleEntries.add(id)
  },
}))

function ensureListening() {
  if (listening) return
  listening = true
  window.addEventListener('popstate', () => {
    const landed = currentEntryId()
    if (typeof landed === 'string' && staleEntries.has(landed)) {
      // Landed on the entry of a layer that is already closed: step over it.
      staleEntries.delete(landed)
      window.history.back()
      return
    }
    const { stack } = useBackCloseStore.getState()
    const top = stack[stack.length - 1]
    if (!top || !top.pushed || currentEntryId() === top.id) return
    // Back left the top layer's entry: close that layer only (its entry is already gone).
    useBackCloseStore.setState({ stack: stack.slice(0, -1) })
    top.close()
  })
}
