import { useEffect } from 'react'
import { create } from 'zustand'

/** Success notices hide by themselves after this long without interaction (spec 016 FR / 2026-11-23 request). */
export const AUTO_HIDE_MS = 10_000

type AutoHideState = {
  /** Notices whose countdown is paused: the pointer is over them or they hold keyboard focus. */
  held: Record<string, boolean>
  /** Bumped when the window is shown / focused again, so a waiting countdown starts. */
  visibleTick: number
  setHeld: (key: string, held: boolean) => void
}

const useAutoHideStore = create<AutoHideState>((set) => ({
  held: {},
  visibleTick: 0,
  setHeld: (key, held) => set((s) => (s.held[key] === held ? s : { held: { ...s.held, [key]: held } })),
}))

let listening = false
function listenToWindow(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  const bump = () => useAutoHideStore.setState((s) => ({ visibleTick: s.visibleTick + 1 }))
  document.addEventListener('visibilitychange', bump)
  window.addEventListener('focus', bump)
  window.addEventListener('blur', bump)
}

/**
 * A notice that hides by itself after `ms` (10 s) without interaction. The count runs only while the window is shown
 * and focused, pauses while the pointer is over the notice or it holds keyboard focus, and starts again from zero when
 * they leave (spec 016 contracts/import-ui.md). Spread the returned handlers on the notice's root element.
 */
export function useAutoHide(key: string, active: boolean, onHide: () => void, ms: number = AUTO_HIDE_MS) {
  const held = useAutoHideStore((s) => s.held[key] === true)
  const visibleTick = useAutoHideStore((s) => s.visibleTick)
  const setHeld = useAutoHideStore((s) => s.setHeld)

  useEffect(() => listenToWindow(), [])
  useEffect(() => () => setHeld(key, false), [key, setHeld])
  useEffect(() => {
    if (!active || held) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    const timer = window.setTimeout(onHide, ms)
    return () => window.clearTimeout(timer)
  }, [active, held, visibleTick, onHide, ms])

  return {
    onMouseEnter: () => setHeld(key, true),
    onMouseLeave: () => setHeld(key, false),
    onFocus: () => setHeld(key, true),
    onBlur: () => setHeld(key, false),
  }
}
