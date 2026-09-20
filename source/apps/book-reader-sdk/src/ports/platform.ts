/** Wall clock. Injected so tests and sync/replay can control timestamps. */
export interface Clock {
  /** Current time as an ISO-8601 string (the format every persisted timestamp uses). */
  nowIso(): string
}

/** Mints ids for new books / annotations. Must return globally unique strings (UUID v4 by default). */
export interface IdGenerator {
  newId(): string
}

/** Opaque timer handle — whatever the host's `setTimeout` returns. */
export type TimerHandle = unknown

/** Timers for debounced autosave. Absent scheduler ⇒ the SDK only saves on explicit flush. */
export interface Scheduler {
  setTimeout(callback: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

/** SHA-256 over raw bytes, lowercase hex. Used for duplicate detection on import (BR-03). */
export interface HashAdapter {
  sha256Hex(bytes: Uint8Array): Promise<string>
}
