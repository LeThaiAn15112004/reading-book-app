import {
  CfiLocation,
  type Location,
  type LocationCodec,
  type LocationDecodeResult,
  type LocationEncodeInput,
} from '@reading-book/domain'

/**
 * epubjs location / relocated payload shape used for encode.
 * Accepts either a full location object or a bare `{ cfi }` / `{ start: { cfi } }`.
 */
export type EpubCfiEncodeInput = {
  cfi?: string
  start?: { cfi?: string }
  end?: { cfi?: string }
}

/** Opaque handle for `rendition.display(cfi)`. */
export type EpubCfiDecodeResult = {
  cfi: string
}

function extractCfi(input: unknown): string | undefined {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed || undefined
  }
  if (!input || typeof input !== 'object') return undefined

  const obj = input as EpubCfiEncodeInput
  if (typeof obj.cfi === 'string' && obj.cfi.trim()) {
    return obj.cfi.trim()
  }
  if (typeof obj.start?.cfi === 'string' && obj.start.cfi.trim()) {
    return obj.start.cfi.trim()
  }
  return undefined
}

/**
 * EPUB LocationCodec adapter (T4.1 / SDS §2.6, §2.10.1).
 * Pure — no epubjs import; maps engine CFI payloads ↔ domain `CfiLocation`.
 */
export class CfiCodec implements LocationCodec {
  encode(input: LocationEncodeInput): CfiLocation {
    const cfi = extractCfi(input)
    if (!cfi) {
      throw new Error('CfiCodec.encode: missing or empty CFI in input')
    }
    return new CfiLocation(cfi)
  }

  decode(location: Location): LocationDecodeResult {
    if (!(location instanceof CfiLocation)) {
      throw new Error(
        `CfiCodec.decode: expected kind "cfi", got "${location.kind}"`,
      )
    }
    return { cfi: location.cfi } satisfies EpubCfiDecodeResult
  }
}

/** Singleton adapter — stateless. */
export const cfiCodec = new CfiCodec()

/** Try encode without throwing; returns undefined when CFI is not ready yet. */
export function tryEncodeCfi(input: unknown): CfiLocation | undefined {
  try {
    return cfiCodec.encode(input)
  } catch {
    return undefined
  }
}
