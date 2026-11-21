/** Stable codes for import failures (aligned with desktop ImportErrorCode). */
export type ImportErrorCode =
  | 'scheme'
  | 'timeout'
  | 'too_large'
  | 'network'
  | 'not_direct_file'
  | 'http_status'
  | 'unsupported_format'
  | 'duplicate'
  /** File could be opened but its content/metadata could not be parsed. */
  | 'corrupted'
  /** OS refused to read the file (EACCES / EPERM). */
  | 'access_denied'
  /** File vanished between being picked and being read (ENOENT). */
  | 'missing_file'
  /** Picked file lives inside the app's own data folder. */
  | 'inside_app_data'
  /** Copying into the library or writing the database row failed. */
  | 'save_failed'
  /** Cloud provider is not linked (or its token could not be refreshed). */
  | 'not_connected'
  /** User cancelled an in-flight download. */
  | 'cancelled'
  /** The picked file is an audiobook ZIP: not a failure — the platform opens the ZIP import preview instead. */
  | 'audiobook_zip'
  /** Spec 016: the file changed (size / modified time) or vanished while it was being imported. Retryable. */
  | 'file_changed'
  /** Spec 016: the phone app was stopped by the system while this import ran (shown after a relaunch). Retryable. */
  | 'interrupted'

/** Platform-agnostic import outcome for Library import UX hook. */
export type ImportClientResult = {
  ok: boolean
  bookId: string | null
  errorCode?: ImportErrorCode
  errorMessage?: string
}

export type ImportToastVariant = 'success' | 'error' | 'info'
