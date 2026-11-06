/**
 * Resolve the signature status of one book file, reusing the cached result only while it still
 * describes the file on disk.
 *
 * The cache key is the file's SHA-256 *now* — not `books.sha256`, which records the file as it was
 * imported: a referenced book lives at the user's own path and can be edited in place afterwards.
 * (A SHA-256 is only that key — it says nothing about whether the file is signed.)
 *
 * Node-only I/O with no Electron / database imports, so it can be exercised by plain node scripts.
 */

import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import { isSignatureInfoCurrent, type BookSignatureInfo } from '@reading-book/book-reader-sdk'
import { hashFile } from '../files/file-hash.ts'
import { signatureNeedsFileContent, verifySignature } from './signature-service.ts'

/** Files larger than this are not read into memory for verification. */
export const MAX_VERIFY_BYTES = 512 * 1024 * 1024

export interface SignatureIo {
  hashFile(path: string): Promise<{ sha256: string; fileSizeBytes: number }>
  readFile(path: string): Promise<Buffer>
}

const defaultIo: SignatureIo = {
  hashFile,
  readFile: (path) => fsp.readFile(path),
}

export interface ResolveSignatureInput {
  format: string
  /** A path already validated by `resolveBookFile`. */
  filePath: string
  /** Result stored in the book's metadata, if any. */
  cached?: BookSignatureInfo
  /** Hash + size of `filePath` when the caller just computed them (import), to skip re-hashing. */
  known?: { sha256: string; fileSizeBytes: number }
  now?: () => Date
  io?: SignatureIo
}

export interface ResolvedSignature {
  info: BookSignatureInfo
  /** `true` when `cached` was still current and no verification ran. */
  fromCache: boolean
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function resolveSignatureInfo(input: ResolveSignatureInput): Promise<ResolvedSignature> {
  const io = input.io ?? defaultIo
  const now = input.now ?? (() => new Date())

  const hashed = input.known ?? (await io.hashFile(input.filePath))
  if (isSignatureInfoCurrent(input.cached, hashed.sha256)) {
    return { info: input.cached, fromCache: true }
  }

  let verification: ReturnType<typeof verifySignature>
  let checkedSha256 = hashed.sha256
  if (!signatureNeedsFileContent(input.format)) {
    // The answer depends on the format alone; skip reading the file.
    verification = verifySignature(input.format, Buffer.alloc(0))
  } else if (hashed.fileSizeBytes > MAX_VERIFY_BYTES) {
    verification = { status: 'unsupported', reason: 'file is too large to verify' }
  } else {
    const data = await io.readFile(input.filePath)
    // Record the hash of the bytes actually verified, even if the file changed since it was hashed.
    checkedSha256 = sha256Hex(data)
    verification = verifySignature(input.format, data)
  }

  const info: BookSignatureInfo = {
    status: verification.status,
    checkedAt: now().toISOString(),
    checkedSha256,
  }
  if (verification.signerName) info.signerName = verification.signerName
  if (verification.signedAt) info.signedAt = verification.signedAt
  return { info, fromCache: false }
}
