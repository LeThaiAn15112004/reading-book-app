import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Progressive collapse for the tools strip. `level` is how many collapsible groups are currently
 * folded into dropdowns (0 = everything inline, `maxLevel` = all folded). The strip folds one more
 * group whenever its content is wider than the container, and unfolds one when the container has
 * grown back to the width that overflowed at that level.
 */
export function useToolbarOverflow(containerRef: RefObject<HTMLElement | null>, maxLevel: number) {
  const [level, setLevel] = useState(0)
  const levelRef = useRef(level)
  levelRef.current = Math.min(level, maxLevel)
  /** `needed[l]` — content width measured while at level `l` and still overflowing. */
  const needed = useRef<number[]>([])

  const adjust = useCallback(
    (allowExpand: boolean) => {
      const el = containerRef.current
      if (!el) return
      const current = levelRef.current
      if (el.scrollWidth > el.clientWidth + 1) {
        if (current < maxLevel) {
          needed.current[current] = el.scrollWidth
          setLevel(current + 1)
        }
      } else if (allowExpand && current > 0 && el.clientWidth >= (needed.current[current - 1] ?? 0)) {
        setLevel(current - 1)
      }
    },
    [containerRef, maxLevel],
  )

  // Fold right after a render that overflows (so a freshly folded level is re-measured at once).
  useLayoutEffect(() => {
    adjust(false)
  }, [adjust, level, maxLevel])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => adjust(true))
    observer.observe(el)
    return () => observer.disconnect()
  }, [adjust, containerRef])

  return Math.min(level, maxLevel)
}
