/**
 * Glue between the signature verifier and the library: import-time checks and the on-demand
 * "check this book's signature" used by the Reader / Library UI. Verification only.
 */

import type { BookSignatureInfo } from '@reading-book/book-reader-sdk'
import type { BookSignatureDto, CheckSignatureResult } from '../ipc/api-types'
import { resolveBookFile } from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { resolveSignatureInfo } from './signature-check'

export function toSignatureDto(info: BookSignatureInfo): BookSignatureDto {
  const dto: BookSignatureDto = { status: info.status }
  if (info.signerName) dto.signerName = info.signerName
  if (info.signedAt) dto.signedAt = info.signedAt
  if (info.checkedAt) dto.checkedAt = info.checkedAt
  return dto
}

/**
 * Verify a file that is being imported. Never throws and never blocks the import: on any failure
 * the book is simply stored as "not checked yet" and gets verified the first time it is inspected.
 */
export async function verifyOnImport(
  format: string,
  filePath: string,
  known: { sha256: string; fileSizeBytes?: number },
): Promise<BookSignatureInfo | undefined> {
  try {
    const { info } = await resolveSignatureInfo({
      format,
      filePath,
      known: { sha256: known.sha256, fileSizeBytes: known.fileSizeBytes ?? 0 },
    })
    return info
  } catch (err) {
    console.warn('[signature] verification at import failed; book stored unchecked', err)
    return undefined
  }
}

/**
 * Current signature status of a library book. Re-uses the cached result only while the file on
 * disk still hashes to the value it was computed for; otherwise verifies again and stores the
 * fresh result in `books.metadata_json`. A missing / unreadable file is reported, not thrown, and
 * leaves the cache untouched.
 */
export async function checkBookSignature(bookId: string): Promise<CheckSignatureResult> {
  const store = getLibraryStore()
  const book = await store.findById(bookId)
  if (!book) return { ok: false, errorCode: 'not_found' }

  const file = await resolveBookFile(book)
  if (!file.ok) {
    return { ok: false, errorCode: file.code === 'missing_file' ? 'missing_file' : 'path_denied' }
  }

  try {
    const { info, fromCache } = await resolveSignatureInfo({
      format: book.format,
      filePath: file.path,
      cached: book.signature,
    })
    if (!fromCache) store.saveSignature(book.id, info)
    return { ok: true, signature: toSignatureDto(info) }
  } catch {
    return { ok: false, errorCode: 'read_failed' }
  }
}
