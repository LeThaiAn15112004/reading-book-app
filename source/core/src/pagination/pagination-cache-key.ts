/**
 * Cache key + record shape for measured EPUB page metrics. Keyed by book fingerprint + reading
 * layout fingerprint so reopening the same book with the same typography/viewport can restore
 * pageTotal immediately. Storage is the host's (IndexedDB on desktop, AsyncStorage/SQLite on mobile).
 */

import { buildSectionOffsets } from './epub-pagination.js'

export const PAGINATION_CACHE_RECORD_VERSION = 1

export type EpubPaginationCacheKeyInput = {
  bookFingerprint: string
  spineLength: number
  width: number
  height: number
  layout: string
  fontSize: number
  fontFamily: string
  fontWeight: number
  lineHeight: number
  textAlign: string
  marginsEnabled: boolean
  marginPreset: string
  chromeHidden: boolean
}

export type EpubPaginationCacheRecord = {
  key: string
  version: number
  bookFingerprint: string
  spineLength: number
  sectionPages: number[]
  sectionOffsets: number[]
  pageTotal: number
  createdAt: number
  layoutFingerprint: string
}



/** Stable layout portion of the cache key (everything except book id). */
export function buildLayoutFingerprint(
  input: Omit<EpubPaginationCacheKeyInput, 'bookFingerprint'>,
): string {
  return [
    `s${input.spineLength}`,
    `w${Math.round(input.width)}`,
    `h${Math.round(input.height)}`,
    `ly:${input.layout}`,
    `fs:${Math.round(input.fontSize)}`,
    `ff:${input.fontFamily}`,
    `fw:${input.fontWeight}`,
    `lh:${Number(input.lineHeight).toFixed(3)}`,
    `ta:${input.textAlign}`,
    `me:${input.marginsEnabled ? 1 : 0}`,
    `mp:${input.marginPreset}`,
    `ch:${input.chromeHidden ? 1 : 0}`,
  ].join('|')
}

export function buildPaginationCacheKey(
  input: EpubPaginationCacheKeyInput,
): string {
  const layout = buildLayoutFingerprint(input)
  return `${input.bookFingerprint}::${layout}`
}

/**
 * Cheap content fingerprint from EPUB bytes (no crypto dependency).
 * Good enough to separate books; not a cryptographic hash.
 */
export function fingerprintEpubBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  const len = view.byteLength
  if (len === 0) return 'empty'

  let hash = len >>> 0
  const step = Math.max(1, Math.floor(len / 4096))
  for (let i = 0; i < len; i += step) {
    hash = (Math.imul(hash, 31) + (view[i] ?? 0)) >>> 0
  }
  // Mix head / mid / tail samples for short books.
  const mid = Math.floor(len / 2)
  const tail = Math.max(0, len - 64)
  for (let i = 0; i < 64 && i < len; i += 1) {
    hash = (Math.imul(hash, 33) + (view[i] ?? 0)) >>> 0
    hash = (Math.imul(hash, 33) + (view[Math.min(len - 1, mid + i)] ?? 0)) >>> 0
    hash = (Math.imul(hash, 33) + (view[Math.min(len - 1, tail + i)] ?? 0)) >>> 0
  }
  return `b${len.toString(16)}-${hash.toString(16)}`
}

/** Normalised record ready to persist (page counts floored to ≥ 1, offsets/total derived). */
export function buildPaginationCacheRecord(
  input: {
    key: string
    bookFingerprint: string
    layoutFingerprint: string
    spineLength: number
    sectionPages: number[]
  },
  now: number,
): EpubPaginationCacheRecord {
  const sectionPages = input.sectionPages.map((n) => Math.max(1, Math.floor(n || 1)))
  const pageTotal = sectionPages.reduce((sum, n) => sum + n, 0)
  return {
    key: input.key,
    version: PAGINATION_CACHE_RECORD_VERSION,
    bookFingerprint: input.bookFingerprint,
    spineLength: input.spineLength,
    sectionPages,
    sectionOffsets: buildSectionOffsets(sectionPages),
    pageTotal: Math.max(1, pageTotal),
    createdAt: now,
    layoutFingerprint: input.layoutFingerprint,
  }
}

/** True when a record read back from storage matches this version and has page data. */
export function isUsablePaginationRecord(
  record: EpubPaginationCacheRecord | null | undefined,
): record is EpubPaginationCacheRecord {
  return (
    !!record &&
    record.version === PAGINATION_CACHE_RECORD_VERSION &&
    Array.isArray(record.sectionPages) &&
    record.sectionPages.length > 0
  )
}
