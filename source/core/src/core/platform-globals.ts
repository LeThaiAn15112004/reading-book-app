/**
 * The SDK compiles against `lib: ES2022` with no DOM / Node typings, so the handful of
 * host-provided globals it can *optionally* use are described here and reached through a single
 * cast. Every member is optional: nothing may assume it exists (React Native has no
 * `crypto.subtle`, some JS engines lack `crypto` entirely).
 */
interface MaybeWebCrypto {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array) => Uint8Array
  subtle?: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
  }
}

interface MaybeConsole {
  debug?: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
}

export interface PlatformGlobals {
  crypto?: MaybeWebCrypto
  console?: MaybeConsole
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export const platformGlobals = globalThis as unknown as PlatformGlobals
