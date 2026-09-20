/** Minimal ambient timer surface — the SDK core's tsconfig has no `dom`/`node` lib on purpose. */
interface TimerGlobal {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}
const timers = globalThis as unknown as TimerGlobal

/** Promise that resolves after `ms` (uses global timers). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms)
  })
}

/** Reject if `promise` does not settle within `ms`. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`))
    }, ms)

    promise.then(
      (value) => {
        timers.clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        timers.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function bootErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'App failed to initialize'
}
