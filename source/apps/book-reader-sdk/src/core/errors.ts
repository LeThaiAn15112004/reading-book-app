export type SdkErrorCode =
  | 'INVALID_CONFIG'
  | 'ADAPTER_MISSING'
  | 'ADAPTER_INVALID'
  | 'INVALID_ARGUMENT'
  | 'INVALID_LOCATION'
  | 'UNSUPPORTED_FORMAT'
  | 'NOT_FOUND'
  | 'NO_BOOK_OPEN'
  | 'STORAGE_FAILED'
  | 'EPUB_MALFORMED'
  | 'DISPOSED'

/**
 * The only error type the SDK throws on purpose. Hosts should branch on `code`, never on
 * `message` (messages are for logs and may change).
 */
export class SdkError extends Error {
  readonly code: SdkErrorCode

  constructor(code: SdkErrorCode, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SdkError'
    this.code = code
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause
  }
}

/**
 * Structural check instead of `instanceof`: a host that loads both `index.mjs` and `index.cjs`
 * (e.g. Electron main in CJS + a bundled renderer in ESM) ends up with two distinct `SdkError`
 * classes, and `instanceof` would silently fail across them.
 */
export function isSdkError(value: unknown): value is SdkError {
  return (
    value instanceof Error &&
    value.name === 'SdkError' &&
    typeof (value as { code?: unknown }).code === 'string'
  )
}

/** Wrap any thrown value as an `SdkError`, preserving an existing one untouched. */
export function toSdkError(value: unknown, code: SdkErrorCode, message: string): SdkError {
  if (isSdkError(value)) return value
  return new SdkError(code, message, { cause: value })
}
