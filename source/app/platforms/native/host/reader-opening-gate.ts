/**
 * Spec 017 (US3, FR-018, contracts/opening-ipc.md): the host's copy of "a book is opening in the WebView, its first
 * page is not drawn yet", sent by the bridge as `app.setReaderOpening { opening }`. The file service's chunk loops
 * (copy / hash fallbacks of an import) wait on it between chunks — each wait at most 10 s, so a lost "drawn" never
 * blocks an import.
 */
export const OPENING_MAX_MS = 10_000

export interface ReaderOpeningGate {
  set(opening: boolean): void
  isOpening(): boolean
  /** Undefined when no book is opening (no await needed), else resolves when it is drawn or after 10 s. */
  whenNotOpening(): Promise<void> | undefined
}

export function createReaderOpeningGate(options: { maxMs?: number } = {}): ReaderOpeningGate {
  const maxMs = options.maxMs ?? OPENING_MAX_MS
  let opening = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let waiters: (() => void)[] = []

  const release = () => {
    const ready = waiters
    waiters = []
    for (const resolve of ready) resolve()
  }

  return {
    set(next) {
      if (timer) clearTimeout(timer)
      timer = null
      opening = next
      if (!opening) release()
      // The longest anything waits, like the WebView's own gate: the host clears it by itself.
      else timer = setTimeout(() => this.set(false), maxMs)
    },
    isOpening: () => opening,
    whenNotOpening() {
      if (!opening) return undefined
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(t)
          resolve()
        }
        const t = setTimeout(done, maxMs)
        waiters.push(done)
      })
    },
  }
}
