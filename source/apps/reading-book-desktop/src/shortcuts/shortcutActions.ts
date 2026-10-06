import { useEffect, useRef } from 'react'
import type { ShortcutId } from './shortcutDefinitions'

type Handler = () => void

/** Handlers registered by mounted screens, newest last — the newest one wins. */
const handlers = new Map<ShortcutId, Handler[]>()
/** Actions waiting for a screen that isn't mounted yet (Open Book from Reader → Library). */
const queued = new Set<ShortcutId>()

/** Run the newest handler for `id`. False when no mounted screen handles it. */
export function runShortcutAction(id: ShortcutId): boolean {
  const list = handlers.get(id)
  const handler = list?.[list.length - 1]
  if (!handler) return false
  handler()
  return true
}

/** Run `id` as soon as a screen registers a handler for it. */
export function queueShortcutAction(id: ShortcutId): void {
  queued.add(id)
}

/**
 * Let the current screen handle a shortcut while it is mounted (and `enabled`). The handler can
 * change between renders without re-registering.
 */
export function useShortcutAction(id: ShortcutId, handler: Handler, enabled = true): void {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!enabled) return
    const run: Handler = () => ref.current()
    handlers.set(id, [...(handlers.get(id) ?? []), run])
    if (queued.delete(id)) queueMicrotask(run)
    return () => {
      handlers.set(
        id,
        (handlers.get(id) ?? []).filter((h) => h !== run),
      )
    }
  }, [id, enabled])
}
