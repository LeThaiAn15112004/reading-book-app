import type { Clock, HashAdapter, IdGenerator, Logger, Scheduler } from '../ports/platform.js'
import { SdkError } from './errors.js'
import { platformGlobals } from './platform-globals.js'

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
}

/** RFC 4122 v4 formatting of 16 random bytes. */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new SdkError('INVALID_ARGUMENT', 'uuidV4FromBytes needs 16 bytes')
  const b = Array.from(bytes.subarray(0, 16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function bytesToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** `undefined` when the platform has no secure random source — the host must inject `ids`. */
export function detectIdGenerator(): IdGenerator | undefined {
  const crypto = platformGlobals.crypto
  if (typeof crypto?.randomUUID === 'function') {
    const randomUUID = crypto.randomUUID.bind(crypto)
    return { newId: () => randomUUID() }
  }
  if (typeof crypto?.getRandomValues === 'function') {
    const getRandomValues = crypto.getRandomValues.bind(crypto)
    return { newId: () => uuidV4FromBytes(getRandomValues(new Uint8Array(16))) }
  }
  return undefined
}

export function detectHashAdapter(): HashAdapter | undefined {
  const subtle = platformGlobals.crypto?.subtle
  if (!subtle || typeof subtle.digest !== 'function') return undefined
  return {
    async sha256Hex(bytes) {
      return bytesToHex(await subtle.digest('SHA-256', bytes))
    },
  }
}

export function detectScheduler(): Scheduler | undefined {
  const { setTimeout, clearTimeout } = platformGlobals
  if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return undefined
  return {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle),
  }
}

export function createConsoleLogger(prefix = '[book-reader-sdk]'): Logger {
  const c = platformGlobals.console
  const emit =
    (fn: ((...args: unknown[]) => void) | undefined) =>
    (message: string, meta?: Record<string, unknown>) => {
      if (!fn) return
      if (meta) fn.call(c, `${prefix} ${message}`, meta)
      else fn.call(c, `${prefix} ${message}`)
    }
  return {
    debug: emit(c?.debug),
    info: emit(c?.info),
    warn: emit(c?.warn),
    error: emit(c?.error),
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
