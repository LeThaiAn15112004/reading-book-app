/**
 * Can Readmate write annotations into this PDF right now? Checked before EVERY write
 * (docs/implementation_plan/pdf_annotation_two_way_sync.md §2): write-back is always on, so this is the
 * only gate between a Readmate edit and the user's file. Must not import `electron`.
 *
 * A blocked file is never written and never reported as written: the caller keeps the data pending
 * in SQLite and tells the user why.
 */
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { PdfWriteError, assertPdfWritable } from './pdf-incremental-writer'

export type WriteBlockReason =
  /** App-owned copy under `{userData}/books` (URL / cloud downloads): not the user's file, read-only. */
  | 'managed_copy'
  /** The file or its folder can't be written (read-only attribute, no permission). */
  | 'read_only'
  | 'encrypted'
  /** The trailer / structure can't be appended to safely. */
  | 'unsupported_pdf'
  /** Digitally signed (or a signature that couldn't be evaluated): needs an explicit confirmation. */
  | 'signed'

export type WriteEligibility = { ok: true } | { ok: false; reason: WriteBlockReason; signerName?: string }

export type WriteEligibilityInput = {
  filePath: string
  bytes: Uint8Array
  /** True for a file the user owns (`referenced`); false for an app-owned copy. */
  isReferenced: (filePath: string) => boolean
  /** Signature verdict (`verifyPdf`). Anything but `unsigned` — including `unsupported` — blocks. */
  verifySignature: (bytes: Buffer) => { status: string; signerName?: string }
  /** The user confirmed writing into a signed file for this session. */
  allowSigned: boolean
}

export async function checkPdfWritable(input: WriteEligibilityInput): Promise<WriteEligibility> {
  if (!input.isReferenced(input.filePath)) return { ok: false, reason: 'managed_copy' }

  try {
    await fsp.access(input.filePath, fs.constants.W_OK)
    await fsp.access(path.dirname(input.filePath), fs.constants.W_OK)
  } catch {
    return { ok: false, reason: 'read_only' }
  }

  try {
    assertPdfWritable(input.bytes)
  } catch (err) {
    return { ok: false, reason: err instanceof PdfWriteError && err.code === 'encrypted' ? 'encrypted' : 'unsupported_pdf' }
  }

  if (!input.allowSigned) {
    let signature: { status: string; signerName?: string }
    try {
      signature = input.verifySignature(Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength))
    } catch {
      // Can't tell whether it is signed: prefer not writing.
      return { ok: false, reason: 'signed' }
    }
    if (signature.status !== 'unsigned') return { ok: false, reason: 'signed', signerName: signature.signerName }
  }
  return { ok: true }
}
