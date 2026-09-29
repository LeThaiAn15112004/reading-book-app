/**
 * Format-specific signature verification behind one entry point (mirrors `adapters/importer-registry`).
 * Verification only: the app never creates or requests signatures.
 *
 * | format          | mechanism                                   | result                         |
 * |-----------------|---------------------------------------------|--------------------------------|
 * | pdf             | ISO 32000 signature dictionaries (CMS)      | unsigned / valid / invalid / unsupported |
 * | epub            | none implemented (see `verifyEpub`)         | always unsupported             |
 * | txt, md, docx, doc | no signature mechanism the app verifies  | always unsupported             |
 */

import type { SignatureStatus } from '@reading-book/book-reader-sdk'
import { verifyPdfSignatures } from './pdf-signatures.ts'

export interface SignatureVerification {
  status: SignatureStatus
  signerName?: string
  signedAt?: string
  /** Why the status is not `valid`/`unsigned` (diagnostics only; not persisted). */
  reason?: string
}

/** Bytes of a whole book file → verdict. Must not throw for malformed input. */
export type SignatureVerifier = (data: Buffer) => SignatureVerification

export function verifyPdf(data: Buffer): SignatureVerification {
  return verifyPdfSignatures(data)
}

/**
 * EPUB has no signature check in this project. The EPUB OCF spec does allow an optional
 * `META-INF/signatures.xml` (W3C XML-DSig), but no XML-DSig / canonicalisation library is a
 * dependency and no signing profile is defined for the app's books, so nothing here can decide
 * whether an EPUB is signed. Reporting `unsigned` would be a guess; `unsupported` is the honest
 * answer. Implementing it means adding a verifier here and registering it below.
 */
export function verifyEpub(): SignatureVerification {
  return { status: 'unsupported', reason: 'EPUB signature verification is not implemented' }
}

interface Registration {
  verify: SignatureVerifier
  /** Whether the verdict depends on the file's bytes (false → same answer for every file). */
  readsContent: boolean
}

const VERIFIERS: Readonly<Record<string, Registration>> = {
  pdf: { verify: verifyPdf, readsContent: true },
  epub: { verify: verifyEpub, readsContent: false },
}

/** Whether the file's bytes must be read to answer (false → the format alone decides). */
export function signatureNeedsFileContent(format: string): boolean {
  return VERIFIERS[format]?.readsContent ?? false
}

export function verifySignature(format: string, data: Buffer): SignatureVerification {
  const registration = VERIFIERS[format]
  if (!registration) {
    return { status: 'unsupported', reason: `no signature verification for ${format} files` }
  }
  return registration.verify(data)
}
