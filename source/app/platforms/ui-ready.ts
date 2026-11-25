/**
 * "The first real screen is on the display" — one window event the shared UI dispatches once, after the first route
 * that is not the boot splash has painted. The phone bridge forwards it to the host (`app.uiReady`), which then hides
 * the system splash screen, so a phone launch goes system splash → Library with no blank page or second splash in
 * between. Desktop has no listener: the event is a no-op there.
 */
export const UI_READY_EVENT = 'readmate:ui-ready'

let announced = false

/** Dispatches `UI_READY_EVENT` once, two frames from now (after the screen that is mounting has painted). */
export function announceUiReady(): void {
  if (announced || typeof window === 'undefined') return
  announced = true
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event(UI_READY_EVENT))))
}
