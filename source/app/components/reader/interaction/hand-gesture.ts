/**
 * Hand-tool gesture rules shared by reading surfaces that live in the app document (PDF text layer,
 * placeholder canvas). The EPUB renderer runs the same rules inside its iframes (`EpubRenderer`),
 * with the same constants. Each surface keeps its own hit-test, selection toggling and scrolling.
 * See docs/implementation_plan/hand_mode_unified.md.
 */
import { HAND_HOVER_CURSOR_DELAY_MS, PAN_DRAG_THRESHOLD_PX } from './interaction-hit'

/**
 * Hover dwell: the cursor stays `grab` while the pointer skims across text, and switches to
 * I-beam / pointer (`armed`) only after it rests on a text or link target for `delayMs`. Pressing
 * on text while armed selects natively; any other press pans.
 */
export type HandHoverDwell = {
  /** Feed a hover (no button down) with the surface's own "over text / link" hit-test. */
  update: (overTarget: boolean) => void
  /** Back to `grab` and drop any pending timer (pan start, pointer left, tool switch, blur). */
  disarm: () => void
  isArmed: () => boolean
  /** Clear the timer for good (unmount). */
  dispose: () => void
}

export function createHandHoverDwell(
  onArmedChange: (armed: boolean) => void,
  delayMs: number = HAND_HOVER_CURSOR_DELAY_MS,
): HandHoverDwell {
  let armed = false
  let overTarget = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }
  const setArmed = (next: boolean) => {
    if (armed === next) return
    armed = next
    onArmedChange(next)
  }

  return {
    update(over) {
      if (over === overTarget) return
      overTarget = over
      clearTimer()
      if (!over) {
        setArmed(false)
        return
      }
      // Already armed — stay on I-beam while moving within text.
      if (armed) return
      timer = setTimeout(() => {
        timer = null
        if (overTarget) setArmed(true)
      }, delayMs)
    },
    disarm() {
      clearTimer()
      overTarget = false
      setArmed(false)
    },
    isArmed: () => armed,
    dispose() {
      clearTimer()
      overTarget = false
      armed = false
    },
  }
}

/** A press that travelled this far is a drag (pan / selection), never a click or center tap. */
export function exceedsDragThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
): boolean {
  return Math.hypot(x - startX, y - startY) >= PAN_DRAG_THRESHOLD_PX
}

/** Center tap zone: the middle half of the reading area's width. */
export function isInCenterTapZone(clientX: number, area: { left: number; width: number }): boolean {
  if (area.width <= 0) return false
  const x = clientX - area.left
  return x >= area.width * 0.25 && x <= area.width * 0.75
}
