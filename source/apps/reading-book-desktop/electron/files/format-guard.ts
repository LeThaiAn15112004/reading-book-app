import {
  isSupportedExtension,
  resolveFormatFromExtension,
  SUPPORTED_FORMATS,
} from '@reading-book/config'
import type { DocumentFormat } from '@reading-book/domain'
import path from 'node:path'

/** Stable code mapped to ImportErrorCode.unsupported_format. */
export class UnsupportedFormatError extends Error {
  readonly code = 'unsupported_format' as const

  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFormatError'
  }
}

const SUPPORTED_LABEL = SUPPORTED_FORMATS.map((d) => d.format.toUpperCase()).join(', ')

function extensionOf(filePathOrName: string): string {
  return path.extname(path.basename(filePathOrName)).toLowerCase()
}

function unsupportedMessage(ext: string): string {
  const shown = ext || '(none)'
  return `Unsupported format '${shown}'. Supported: ${SUPPORTED_LABEL}.`
}

/**
 * Assert path/URL basename uses a whitelist extension (FR-01 / T2.5).
 * Returns the resolved DocumentFormat when valid.
 */
export function assertSupportedExtension(filePathOrName: string): DocumentFormat {
  const ext = extensionOf(filePathOrName)
  const format = resolveFormatFromExtension(ext)
  if (!format) {
    throw new UnsupportedFormatError(unsupportedMessage(ext))
  }
  return format
}

/**
 * When a URL pathname has a file extension, reject early if unsupported.
 * No-op when pathname has no extension (Content-Disposition may supply one later).
 */
export function assertSupportedUrlPathExtension(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return
  }

  const base = path.basename(decodeURIComponent(parsed.pathname))
  if (!base || base === '/' || base === '.' || base === '..') return

  const ext = path.extname(base).toLowerCase()
  if (!ext) return

  if (!isSupportedExtension(ext)) {
    throw new UnsupportedFormatError(unsupportedMessage(ext))
  }
}
