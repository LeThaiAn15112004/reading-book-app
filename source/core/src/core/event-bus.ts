import type { Logger } from '../ports/platform.js'

export type Unsubscribe = () => void

export type EventListener<P> = (payload: P) => void

export interface EventSource<E extends Record<string, unknown>> {
  on<K extends keyof E & string>(type: K, listener: EventListener<E[K]>): Unsubscribe
}

export interface EventBus<E extends Record<string, unknown>> extends EventSource<E> {
  emit<K extends keyof E & string>(type: K, payload: E[K]): void
  clear(): void
}

/**
 * Minimal typed pub/sub. A throwing host listener is logged and swallowed so it can never abort
 * the store action that emitted the event.
 */
export function createEventBus<E extends Record<string, unknown>>(logger: Logger): EventBus<E> {
  const listeners = new Map<string, Set<EventListener<unknown>>>()

  return {
    on(type, listener) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      const erased = listener as EventListener<unknown>
      set.add(erased)
      return () => {
        set.delete(erased)
      }
    },
    emit(type, payload) {
      const set = listeners.get(type)
      if (!set) return
      for (const listener of [...set]) {
        try {
          listener(payload)
        } catch (err) {
          logger.error(`event listener for "${type}" threw`, { error: err })
        }
      }
    },
    clear() {
      listeners.clear()
    },
  }
}
