import { CfiLocation, type Location } from '../domain/index.js'
import { SdkError } from '../core/errors.js'

/**
 * Engine payload → `CfiLocation`. Accepts a bare CFI string, epub.js `{ cfi }`, or a relocated
 * payload `{ start: { cfi } }`. Pure: no epub.js import (ported from `CfiCodec`).
 */
export function encodeCfiLocation(input: unknown): CfiLocation {
  const cfi = extractCfi(input)
  if (!cfi) throw new SdkError('INVALID_LOCATION', 'encodeCfiLocation: missing or empty CFI in input')
  return new CfiLocation(cfi)
}

export function tryEncodeCfiLocation(input: unknown): CfiLocation | undefined {
  const cfi = extractCfi(input)
  return cfi ? new CfiLocation(cfi) : undefined
}

/** `CfiLocation` → the CFI string an engine's `display()` accepts. Throws for other kinds. */
export function decodeCfiLocation(location: Location): string {
  if (!(location instanceof CfiLocation)) {
    throw new SdkError('INVALID_LOCATION', `decodeCfiLocation: expected kind "cfi", got "${location.kind}"`)
  }
  return location.cfi
}

function extractCfi(input: unknown): string | undefined {
  if (typeof input === 'string') return input.trim() || undefined
  if (!input || typeof input !== 'object') return undefined
  const obj = input as { cfi?: unknown; start?: { cfi?: unknown } }
  if (typeof obj.cfi === 'string' && obj.cfi.trim()) return obj.cfi.trim()
  if (typeof obj.start?.cfi === 'string' && obj.start.cfi.trim()) return obj.start.cfi.trim()
  return undefined
}
