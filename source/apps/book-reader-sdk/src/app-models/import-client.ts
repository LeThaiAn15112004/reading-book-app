/** Stable codes for import failures (aligned with desktop ImportErrorCode). */
export type ImportErrorCode =
  | 'scheme'
  | 'timeout'
  | 'too_large'
  | 'network'
  | 'not_direct_file'
  | 'http_status'
  | 'copy_failed'
  | 'unsupported_format'
  | 'duplicate'

/** Platform-agnostic import outcome for Library import UX hook. */
export type ImportClientResult = {
  ok: boolean
  bookId: string | null
  errorCode?: ImportErrorCode
  errorMessage?: string
}

export type ImportToastVariant = 'success' | 'error' | 'info'
