/** Promise that resolves after `ms` (uses global timers). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms)
  })
}

/** Reject if `promise` does not settle within `ms`. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s`))
    }, ms)

    promise.then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        globalThis.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function bootErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'App failed to initialize'
}
