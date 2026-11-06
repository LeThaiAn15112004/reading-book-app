/**
 * IndexedDB cache for EPUB CSS page metrics.
 *
 * Key/fingerprint/record logic lives in the SDK (`buildPaginationCacheKey`,
 * `buildPaginationCacheRecord`); this file only owns the desktop storage.
 */

import {
  buildPaginationCacheRecord,
  isUsablePaginationRecord,
  type EpubPaginationCacheRecord,
} from '@reading-book/book-reader-sdk'

export {
  buildLayoutFingerprint,
  buildPaginationCacheKey,
  fingerprintEpubBytes,
  type EpubPaginationCacheKeyInput,
  type EpubPaginationCacheRecord,
} from '@reading-book/book-reader-sdk'

const DB_NAME = 'reading-book-epub-pagination'
const DB_VERSION = 1
const STORE_NAME = 'pageMetrics'

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
      return isUsablePaginationRecord(record) ? record : null
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
  const record = buildPaginationCacheRecord(input, Date.now())

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
