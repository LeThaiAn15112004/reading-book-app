import { CfiLocation, Location } from '@reading-book/domain'
import { toEpubjsDisplayCfi } from '../../../../reader/renderers/epub'

/** Ignore absent, legacy, malformed, or non-EPUB saved locations. */
export function parseResumeLocation(
  raw: string | undefined,
): CfiLocation | undefined {
  if (!raw?.trim()) return undefined
  try {
    const location = Location.parse(raw)
    if (!(location instanceof CfiLocation)) return undefined
    // Drop CFIs epubjs cannot display (garbage / empty after normalize).
    if (!toEpubjsDisplayCfi(location.cfi)) return undefined
    return location
  } catch {
    return undefined
  }
}
