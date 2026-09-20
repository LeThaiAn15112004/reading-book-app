/**
 * IndexedDB cache for EPUB CSS page metrics.
 *
 * Keyed by book fingerprint + reading layout fingerprint so reopening the
 * same book with the same typography/viewport restores pageTotal immediately.
 */

import { buildSectionOffsets } from './epub-pagination'

const DB_NAME = 'reading-book-epub-pagination'
const DB_VERSION = 1
const STORE_NAME = 'pageMetrics'
const CACHE_RECORD_VERSION = 1

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open pagination cache'))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('bookFingerprint', 'bookFingerprint', {
          unique: false,
        })
      }
    }
  })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
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
    hash = (Math.imul(hash, 31) + view[i]) >>> 0
  }
  // Mix head / mid / tail samples for short books.
  const mid = Math.floor(len / 2)
  const tail = Math.max(0, len - 64)
  for (let i = 0; i < 64 && i < len; i += 1) {
    hash = (Math.imul(hash, 33) + view[i]) >>> 0
    hash = (Math.imul(hash, 33) + view[Math.min(len - 1, mid + i)]) >>> 0
    hash = (Math.imul(hash, 33) + view[Math.min(len - 1, tail + i)]) >>> 0
  }
  return `b${len.toString(16)}-${hash.toString(16)}`
}

export async function readPaginationCache(
  key: string,
): Promise<EpubPaginationCacheRecord | null> {
  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const record = (await idbRequest(
        store.get(key),
      )) as EpubPaginationCacheRecord | undefined
      if (!record || record.version !== CACHE_RECORD_VERSION) return null
      if (
        !Array.isArray(record.sectionPages) ||
        record.sectionPages.length === 0
      ) {
        return null
      }
      return record
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

export async function writePaginationCache(input: {
  key: string
  bookFingerprint: string
  layoutFingerprint: string
  spineLength: number
  sectionPages: number[]
}): Promise<void> {
  const sectionPages = input.sectionPages.map((n) =>
    Math.max(1, Math.floor(n || 1)),
  )
  const sectionOffsets = buildSectionOffsets(sectionPages)
  const pageTotal = sectionPages.reduce((sum, n) => sum + n, 0)
  const record: EpubPaginationCacheRecord = {
    key: input.key,
    version: CACHE_RECORD_VERSION,
    bookFingerprint: input.bookFingerprint,
    spineLength: input.spineLength,
    sectionPages,
    sectionOffsets,
    pageTotal: Math.max(1, pageTotal),
    createdAt: Date.now(),
    layoutFingerprint: input.layoutFingerprint,
  }

  try {
    const db = await openDb()
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      await idbRequest(store.put(record))
    } finally {
      db.close()
    }
  } catch {
    /* Cache write failures must never break reading. */
  }
}
