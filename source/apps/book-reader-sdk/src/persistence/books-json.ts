/**
 * Shapes + tolerant parsers for the three JSON columns of `books` (migration 020):
 * `metadata_json`, `genres_json`, `reading_state_json`.
 *
 * Convention: camelCase keys, and `null` ≡ "absent" — writers omit unset fields and
 * `json_patch` (RFC 7396) treats a `null` member as "delete this key".
 */

import type { SignatureMetadataFields } from '../domain/book/book-signature.js'

/**
 * `signatureStatus`, `signerName`, `signedAt`, `signatureCheckedAt` and `signatureCheckedSha256`
 * (from SignatureMetadataFields) cache the latest signature *verification* result; they are
 * preserved on every partial update because updates go through json_patch.
 */
export interface BookMetadataJson extends SignatureMetadataFields {
  fileSizeBytes?: number | null
  pageCount?: number | null
  description?: string | null
}

export interface ReadingStateJson {
  /** Packed Location JSON (see session-location.ts) or the legacy `Started` label. */
  lastReadLocation?: string | null
  percent?: number | null
  fontFamily?: string | null
  fontSize?: number | null
  fontWeight?: string | null
  lineHeight?: number | null
  textAlign?: string | null
  layoutMode?: string | null
  pageTurnMode?: string | null
  marginsEnabled?: boolean | null
  marginPreset?: string | null
  isLandscape?: boolean | null
  /** ISO-8601. Also the stale-write guard for `saveSessionState`. */
  updatedAt?: string | null
}

function parseObject<T extends object>(raw: string | null | undefined): T {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as T
  } catch {
    // Corrupt JSON must never take the Library down — behave as "no data".
  }
  return {} as T
}

export function parseMetadata(raw: string | null | undefined): BookMetadataJson {
  return parseObject<BookMetadataJson>(raw)
}

export function parseReadingState(raw: string | null | undefined): ReadingStateJson {
  return parseObject<ReadingStateJson>(raw)
}

export function parseGenres(raw: string | null | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    if (Array.isArray(value)) {
      return value.filter((genre): genre is string => typeof genre === 'string')
    }
  } catch {
    // see parseObject
  }
  return []
}

/**
 * Trim, drop empties, de-duplicate case-insensitively (first spelling wins) and sort A→Z by
 * code unit — the same order the migration's `ORDER BY g.name` produced.
 */
export function normalizeGenreNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const trimmed = name.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
