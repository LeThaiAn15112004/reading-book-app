/**
 * Signature *status* of a book file (verification only — the app never creates signatures).
 *
 * Deliberately import-free so it can be loaded by plain node scripts (see
 * `spikes/signature-status`). Stored in `books.metadata_json` (see `persistence/books-json.ts`).
 */

/**
 * - `unsigned`    — the file was inspected and carries no digital signature.
 * - `valid`       — a digital signature is present and cryptographically intact: the signed bytes
 *                   are unchanged and the signature matches the signer certificate embedded in the
 *                   file. The certificate chain is NOT validated against a trust store and
 *                   revocation is not checked, so this is "untampered", not "trusted identity".
 * - `invalid`     — a digital signature is present but does not verify (content changed after
 *                   signing, signature bytes damaged, or data appended after the signed range).
 * - `unsupported` — the app has no verification mechanism for this format / signature type, so it
 *                   cannot say whether the file is signed. Never means "signed" or "unsigned".
 *
 * A book with *no* `signatureStatus` in its metadata has simply not been checked yet.
 */
export const SIGNATURE_STATUSES = ['unsigned', 'valid', 'invalid', 'unsupported'] as const

export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number]

export function isSignatureStatus(value: unknown): value is SignatureStatus {
  return typeof value === 'string' && (SIGNATURE_STATUSES as readonly string[]).includes(value)
}

/** Latest verification result for one book file, as cached in `books.metadata_json`. */
export interface BookSignatureInfo {
  status: SignatureStatus
  /** Common name of the signer certificate (`valid` / `invalid` results only, when readable). */
  signerName?: string
  /** ISO-8601 signing time claimed by the signature, when present. */
  signedAt?: string
  /** ISO-8601 time the verification ran. */
  checkedAt: string
  /**
   * SHA-256 of the file bytes this result was computed for. A cached result is only reusable while
   * the file still hashes to this value (see {@link isSignatureInfoCurrent}).
   */
  checkedSha256: string
}

/**
 * Whether a cached result still describes the file on disk. `currentSha256` must be the hash of the
 * file *now* — not `books.sha256`, which only records the file as imported and goes stale if the
 * user edits a referenced file in place.
 */
export function isSignatureInfoCurrent(
  info: BookSignatureInfo | undefined,
  currentSha256: string,
): info is BookSignatureInfo {
  if (!info || !currentSha256) return false
  return info.checkedSha256.toLowerCase() === currentSha256.toLowerCase()
}

/**
 * The signature members of `books.metadata_json` (camelCase; `null` ≡ absent, see books-json.ts).
 * `signatureStatus` is the single source of truth — there is no separate "is signed" flag.
 */
export interface SignatureMetadataFields {
  signatureStatus?: string | null
  signerName?: string | null
  signedAt?: string | null
  signatureCheckedAt?: string | null
  /** Which file bytes `signatureStatus` was computed for (cache key). */
  signatureCheckedSha256?: string | null
}

/**
 * Read the cached result out of metadata. Tolerant of hand-edited / legacy JSON: an unknown status
 * (e.g. the pre-022 `"unknown"` / `"expired"` defaults) reads as "not checked yet".
 */
export function signatureInfoFromMetadata(
  meta: SignatureMetadataFields,
): BookSignatureInfo | undefined {
  if (!isSignatureStatus(meta.signatureStatus)) return undefined
  const info: BookSignatureInfo = {
    status: meta.signatureStatus,
    checkedAt: typeof meta.signatureCheckedAt === 'string' ? meta.signatureCheckedAt : '',
    checkedSha256:
      typeof meta.signatureCheckedSha256 === 'string' ? meta.signatureCheckedSha256 : '',
  }
  if (typeof meta.signerName === 'string' && meta.signerName) info.signerName = meta.signerName
  if (typeof meta.signedAt === 'string' && meta.signedAt) info.signedAt = meta.signedAt
  return info
}

/**
 * Metadata members for `json_patch` (RFC 7396): every signature key is listed so a fresh result
 * replaces the previous one completely — an absent optional field becomes `null` = "delete key",
 * so a stale signer name can never outlive the result it belonged to. `undefined` clears them all.
 */
export function signatureMetadataPatch(
  info: BookSignatureInfo | undefined,
): Required<SignatureMetadataFields> {
  return {
    signatureStatus: info?.status ?? null,
    signerName: info?.signerName ?? null,
    signedAt: info?.signedAt ?? null,
    signatureCheckedAt: info?.checkedAt ?? null,
    signatureCheckedSha256: info?.checkedSha256 ?? null,
  }
}
