/**
 * Platform adapter `longPress`, Desktop renderer (spec 009 T042). Desktop has a real right-click, so the props are
 * `{ onContextMenu }` and nothing else: the same object as before the adapter. The touch version is `longPress.native.ts`.
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

export const LONG_PRESS_MS = 500

type ContextMenuHandler<E extends Element> = (event: ReactMouseEvent<E>) => void

export interface LongPressProps<E extends Element> {
  onContextMenu: ContextMenuHandler<E>
  onPointerDown?: (event: ReactPointerEvent<E>) => void
  onPointerMove?: (event: ReactPointerEvent<E>) => void
  onPointerUp?: (event: ReactPointerEvent<E>) => void
  onPointerCancel?: (event: ReactPointerEvent<E>) => void
  onClickCapture?: (event: ReactMouseEvent<E>) => void
}

export function withLongPress<E extends Element>(onContextMenu: ContextMenuHandler<E>): LongPressProps<E> {
  return { onContextMenu }
}
