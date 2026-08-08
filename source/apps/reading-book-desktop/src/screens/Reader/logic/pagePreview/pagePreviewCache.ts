/** Session-scoped JPEG thumbnail cache keyed by book + 1-based page. */

const MAX_CACHE_ENTRIES = 256

const cache = new Map<string, string>()

function cacheKey(bookId: string, page: number): string {
  return `${bookId}:${page}`
}

export function getPagePreviewFromCache(
  bookId: string | undefined,
  page: number,
): string | null {
  if (!bookId) return null
  return cache.get(cacheKey(bookId, page)) ?? null
}

export function setPagePreviewCache(
  bookId: string | undefined,
  page: number,
  src: string,
): void {
  if (!bookId || !src) return
  const key = cacheKey(bookId, page)
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, src)
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest == null) break
    cache.delete(oldest)
  }
}

/** Hydrate in-memory preview map from session cache for a book. */
export function hydratePagePreviewsFromCache(
  bookId: string | undefined,
  pageTotal: number,
): Map<number, { kind: 'image'; src: string }> {
  const map = new Map<number, { kind: 'image'; src: string }>()
  if (!bookId || pageTotal <= 0) return map
  for (let page = 1; page <= pageTotal; page += 1) {
    const src = getPagePreviewFromCache(bookId, page)
    if (src) map.set(page, { kind: 'image', src })
  }
  return map
}
