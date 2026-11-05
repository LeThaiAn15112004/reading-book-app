import { toSdkError, type SdkError } from '../core/errors.js'
import type { SdkScope } from '../core/events.js'
import type { SdkRuntime } from '../core/runtime.js'

/**
 * Public shape of every SDK store. Structurally identical to zustand's `ReadonlyStoreApi`, so a
 * React host that already has zustand can use `useStore(sdk.stores.annotations, selector)`
 * directly — while the SDK's own type declarations never reference the `zustand` package (it is
 * bundled into `dist`, not required from `node_modules`).
 *
 * There is no public `setState`: state changes only through the actions on the state object,
 * which keep persistence, the render surface and undo history consistent.
 */
export interface ReadonlyStore<T> {
  getState(): T
  getInitialState(): T
  subscribe(listener: (state: T, previousState: T) => void): () => void
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** React's `useSyncExternalStore`, passed in by the host so the SDK never imports React. */
export type UseSyncExternalStore = <Snapshot>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot?: () => Snapshot,
) => Snapshot

/**
 * Bind a store to any React-compatible renderer (React DOM, React Native) without the SDK
 * depending on React:
 *
 *   const useAnnotations = createStoreHook(sdk.stores.annotations, React.useSyncExternalStore)
 *   const items = useAnnotations((s) => s.items)
 *
 * Selectors must return stable references (a state field, a primitive) — returning a freshly
 * built array/object on every call re-renders forever, exactly as with zustand.
 */
export function createStoreHook<T>(store: ReadonlyStore<T>, useSyncExternalStore: UseSyncExternalStore) {
  return function useSdkStore<U>(selector: (state: T) => U): U {
    return useSyncExternalStore(
      store.subscribe,
      () => selector(store.getState()),
      () => selector(store.getInitialState()),
    )
  }
}

/** Log + emit a failed store operation. Returns the normalized error. */
export function reportStoreError(
  rt: SdkRuntime,
  scope: SdkScope,
  operation: string,
  err: unknown,
): SdkError {
  const error = toSdkError(err, 'STORAGE_FAILED', `${scope}.${operation} failed`)
  rt.logger.error(`${scope}.${operation} failed`, { code: error.code, error })
  rt.events.emit('error', { scope, operation, error })
  return error
}

/**
 * Serializes async writes per key (e.g. per annotation id) so a quick color change followed by
 * a note edit can never land in the database in the opposite order, and tracks every pending
 * write for `whenIdle()`.
 */
export function createWriteQueue() {
  const tails = new Map<string, Promise<unknown>>()
  const pending = new Set<Promise<unknown>>()

  return {
    enqueue<R>(key: string, task: () => Promise<R>): Promise<R> {
      const previous = tails.get(key) ?? Promise.resolve()
      const run = previous.then(task, task)
      const settled = run.then(
        () => undefined,
        () => undefined,
      )
      tails.set(key, settled)
      pending.add(settled)
      void settled.then(() => {
        pending.delete(settled)
        if (tails.get(key) === settled) tails.delete(key)
      })
      return run
    },
    async whenIdle(): Promise<void> {
      while (pending.size > 0) await Promise.all([...pending])
    },
  }
}
