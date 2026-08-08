/** Pointer drag helpers for typewriter textbox reposition (T5.6c). */

export const TYPEWRITER_DRAG_THRESHOLD_PX = 4

export type TypewriterDragSession = {
  id: string
  pointerId: number
  startClientX: number
  startClientY: number
  originXPct: number
  originYPct: number
  boundsWidth: number
  boundsHeight: number
  moved: boolean
}

export type TypewriterPct = { xPct: number; yPct: number }

export function clampTypewriterPct(xPct: number, yPct: number): TypewriterPct {
  return {
    xPct: Math.min(100, Math.max(0, xPct)),
    yPct: Math.min(100, Math.max(0, yPct)),
  }
}

export function pctFromClientInBounds(
  clientX: number,
  clientY: number,
  bounds: DOMRect,
): TypewriterPct {
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { xPct: 0, yPct: 0 }
  }
  return clampTypewriterPct(
    ((clientX - bounds.left) / bounds.width) * 100,
    ((clientY - bounds.top) / bounds.height) * 100,
  )
}

export function beginTypewriterDrag(input: {
  id: string
  pointerId: number
  clientX: number
  clientY: number
  originXPct: number
  originYPct: number
  bounds: DOMRect
}): TypewriterDragSession {
  return {
    id: input.id,
    pointerId: input.pointerId,
    startClientX: input.clientX,
    startClientY: input.clientY,
    originXPct: input.originXPct,
    originYPct: input.originYPct,
    boundsWidth: input.bounds.width,
    boundsHeight: input.bounds.height,
    moved: false,
  }
}

/** Update session from pointer move; returns live pct once past threshold. */
export function tickTypewriterDrag(
  session: TypewriterDragSession,
  clientX: number,
  clientY: number,
): { session: TypewriterDragSession; preview: TypewriterPct | null } {
  const dx = clientX - session.startClientX
  const dy = clientY - session.startClientY
  const dist = Math.hypot(dx, dy)
  if (!session.moved && dist < TYPEWRITER_DRAG_THRESHOLD_PX) {
    return { session, preview: null }
  }
  const next = { ...session, moved: true }
  if (session.boundsWidth <= 0 || session.boundsHeight <= 0) {
    return {
      session: next,
      preview: clampTypewriterPct(session.originXPct, session.originYPct),
    }
  }
  const xPct = session.originXPct + (dx / session.boundsWidth) * 100
  const yPct = session.originYPct + (dy / session.boundsHeight) * 100
  return { session: next, preview: clampTypewriterPct(xPct, yPct) }
}
