import { useCallback, useEffect, useRef, useState } from 'react'

const EDGE_PX = 14
const HIDE_DELAY_MS = 900

export type ImmersiveChromeReveal = {
  top: boolean
  bottom: boolean
}

const HIDDEN: ImmersiveChromeReveal = {
  top: false,
  bottom: false,
}

type UseImmersiveChromeRevealOptions = {
  enabled: boolean
}

/**
 * Edge-hover reveal for immersive fullscreen: top → tools, bottom → footer.
 * Chrome auto-hides after the pointer leaves.
 */
export function useImmersiveChromeReveal({
  enabled,
}: UseImmersiveChromeRevealOptions) {
  const [reveal, setReveal] = useState<ImmersiveChromeReveal>(HIDDEN)
  const hideTimerRef = useRef<number | null>(null)
  const revealRef = useRef(reveal)
  revealRef.current = reveal

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setReveal(HIDDEN)
      hideTimerRef.current = null
    }, HIDE_DELAY_MS)
  }, [clearHideTimer])

  const show = useCallback(
    (edge: keyof ImmersiveChromeReveal) => {
      clearHideTimer()
      setReveal((prev) => (prev[edge] ? prev : { ...HIDDEN, [edge]: true }))
    },
    [clearHideTimer],
  )

  const keepVisible = useCallback(() => {
    clearHideTimer()
  }, [clearHideTimer])

  const requestHide = useCallback(() => {
    scheduleHide()
  }, [scheduleHide])

  const hideNow = useCallback(() => {
    clearHideTimer()
    setReveal(HIDDEN)
  }, [clearHideTimer])

  useEffect(() => {
    if (!enabled) {
      clearHideTimer()
      setReveal(HIDDEN)
      return
    }

    function onPointerMove(event: PointerEvent) {
      const { clientY } = event
      const h = window.innerHeight

      if (clientY <= EDGE_PX) {
        show('top')
        return
      }
      if (clientY >= h - EDGE_PX) {
        show('bottom')
        return
      }

      // Pointer is in the reading area — start hide countdown unless over chrome.
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          '[data-immersive-chrome], #reader-tools-chrome, [aria-label="Sidebar navigation"]',
        )
      ) {
        keepVisible()
        return
      }

      if (
        revealRef.current.top ||
        revealRef.current.bottom
      ) {
        scheduleHide()
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      clearHideTimer()
    }
  }, [clearHideTimer, enabled, keepVisible, scheduleHide, show])

  return {
    reveal,
    anyRevealed: reveal.top || reveal.bottom,
    keepVisible,
    requestHide,
    hideNow,
    showTop: () => show('top'),
    showBottom: () => show('bottom'),
  }
}
