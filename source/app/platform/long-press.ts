/**
 * Long press = right-click, on the Mobile host only (spec 008, T071; `contracts/phone-ui.md`, Touch replacements).
 *
 * `withLongPress(onContextMenu)` returns the props to spread on the element that already has an `onContextMenu`:
 *   - In Electron it returns `{ onContextMenu }` and nothing else, so Desktop's behaviour is the same object as before.
 *   - On the Mobile host it adds touch pointer handlers: a 500 ms press that moves less than 10 px calls the same
 *     handler with a synthetic event at the press point, and the click that ends the press is swallowed.
 *     Android WebView may also fire a native `contextmenu` for the same press (risk R1): that one is dropped, so the
 *     menu opens once.
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { isMobileHost } from './index'

export const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

type ContextMenuHandler<E extends Element> = (event: ReactMouseEvent<E>) => void

export interface LongPressProps<E extends Element> {
  onContextMenu: ContextMenuHandler<E>
  onPointerDown?: (event: ReactPointerEvent<E>) => void
  onPointerMove?: (event: ReactPointerEvent<E>) => void
  onPointerUp?: (event: ReactPointerEvent<E>) => void
  onPointerCancel?: (event: ReactPointerEvent<E>) => void
  onClickCapture?: (event: ReactMouseEvent<E>) => void
}

/** The fields the existing handlers read from the event. */
function syntheticContextMenu<E extends Element>(target: E, x: number, y: number): ReactMouseEvent<E> {
  return {
    clientX: x,
    clientY: y,
    currentTarget: target,
    target,
    preventDefault: () => {},
    stopPropagation: () => {},
  } as unknown as ReactMouseEvent<E>
}

/**
 * One press at a time (the primary touch), kept outside the props: the element may re-render during the press, and
 * the handlers of the new render must still see and clear the timer of the old one. Usable inside `.map`, unlike a hook.
 */
let timer: ReturnType<typeof setTimeout> | undefined
let start: { x: number; y: number } | undefined
/** When a long press last fired: the native contextmenu and the click of that same press are dropped. */
let firedAt = 0

function clear() {
  if (timer) clearTimeout(timer)
  timer = undefined
  start = undefined
}

const justFired = () => Date.now() - firedAt < 1000

export function withLongPress<E extends Element>(onContextMenu: ContextMenuHandler<E>): LongPressProps<E> {
  if (!isMobileHost()) return { onContextMenu }

  return {
    onContextMenu(event) {
      if (justFired()) {
        event.preventDefault()
        return
      }
      onContextMenu(event)
    },
    onPointerDown(event) {
      if (event.pointerType !== 'touch' || !event.isPrimary) return
      clear()
      const target = event.currentTarget
      start = { x: event.clientX, y: event.clientY }
      const at = start
      timer = setTimeout(() => {
        timer = undefined
        firedAt = Date.now()
        onContextMenu(syntheticContextMenu(target, at.x, at.y))
      }, LONG_PRESS_MS)
    },
    onPointerMove(event) {
      if (!start) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onClickCapture(event) {
      if (!justFired()) return
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
