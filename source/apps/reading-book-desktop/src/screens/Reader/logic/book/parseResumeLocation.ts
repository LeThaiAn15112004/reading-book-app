import { CfiLocation, Location, PageRectLocation, TextOffsetLocation } from '@reading-book/book-reader-sdk'
import { toEpubjsDisplayCfi } from '../../../../reader/renderers/epub'

/**
 * Ignore absent, legacy or malformed saved locations. EPUB saves a CFI, PDF a page
 * (`PageRectLocation`), TXT a text offset (`TextOffsetLocation`); each renderer only accepts its
 * own kind (see ReaderScreen).
 */
export function parseResumeLocation(
  raw: string | undefined,
): CfiLocation | PageRectLocation | TextOffsetLocation | undefined {
  if (!raw?.trim()) return undefined
  try {
    const location = Location.parse(raw)
    if (location instanceof PageRectLocation) return location
    if (location instanceof TextOffsetLocation) return location
    if (!(location instanceof CfiLocation)) return undefined
    // Drop CFIs epubjs cannot display (garbage / empty after normalize).
    if (!toEpubjsDisplayCfi(location.cfi)) return undefined
    return location
  } catch {
    return undefined
  }
}
