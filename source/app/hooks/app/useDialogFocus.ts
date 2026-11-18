import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]'),
  )
}

export type UseDialogFocusOptions = {
  /** Focused when the layer opens; default the first focusable element, else the container. */
  initialFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Keyboard focus of a modal layer (spec 015 FR-016, research R10): while `open`, Tab / Shift+Tab wrap inside
 * `containerRef`; on open the initial element is focused; on close or unmount focus goes back to the element that had
 * it before (when it is still in the document).
 */
export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  options: UseDialogFocusOptions = {},
): void {
  const initialRef = useRef(options.initialFocusRef)
  initialRef.current = options.initialFocusRef

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // After paint: the layer may be measured / placed first (menus start hidden).
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return
      const target = initialRef.current?.current ?? focusables(container)[0]
      if (target) target.focus()
      else {
        if (!container.hasAttribute('tabindex')) container.tabIndex = -1
        container.focus()
      }
    })

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      const items = focusables(container)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      const inside = active instanceof Node && container.contains(active)
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [open, containerRef])
}
