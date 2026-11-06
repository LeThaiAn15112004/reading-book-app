import { useEffect, useState } from 'react'

/** Docked width of the right sidebar on wide viewports. */
export const RIGHT_SIDEBAR_WIDTH_PX = 360

/** Below this width the sidebar overlays the page instead of shrinking it (Tailwind `md`). */
const DOCK_MEDIA_QUERY = '(min-width: 768px)'

/** Whether the viewport is wide enough to dock the right sidebar beside the page. */
export function useRightSidebarDocked(): boolean {
  const [docked, setDocked] = useState(
    () => typeof window === 'undefined' || window.matchMedia(DOCK_MEDIA_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(DOCK_MEDIA_QUERY)
    const onChange = (e: MediaQueryListEvent) => setDocked(e.matches)
    setDocked(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return docked
}

/** Right padding the reading area reserves for the sidebar (0 when closed or overlaying). */
export function rightSidebarContentInset(open: boolean, docked: boolean): number {
  return open && docked ? RIGHT_SIDEBAR_WIDTH_PX : 0
}
