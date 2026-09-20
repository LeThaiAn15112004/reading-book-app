import { compareCfi, cfiRangesOverlap } from '../cfi/index.js'
import type { BookmarkRecord } from '../domain/annotation/bookmark.js'
import type { HighlightRecord, HighlightStyleKind } from '../domain/annotation/highlight.js'
import type { NoteLocator } from '../domain/annotation/note.js'
import { type Location } from '../domain/index.js'
import { chapterIndexOf, hydrateLocator } from './locator.js'

interface Anchored {
  locator: NoteLocator
  createdAt?: string
}

/**
 * Document-order comparator for anything anchored: chapter first, then the location itself
 * (CFI order for EPUB, page/rect for PDF, offset for text), then creation time as a tiebreak.
 */
export function compareAnchors(a: Anchored, b: Anchored): number {
  const chapterA = chapterIndexOf(a.locator)
  const chapterB = chapterIndexOf(b.locator)
  if (chapterA !== chapterB) return chapterA - chapterB

  const la = a.locator as { kind: string; cfi?: string; page?: number; rect?: { x: number; y: number }; offset?: number }
  const lb = b.locator as { kind: string; cfi?: string; page?: number; rect?: { x: number; y: number }; offset?: number }
  let diff = 0
  if (la.kind === 'cfi' && lb.kind === 'cfi') diff = compareCfi(la.cfi ?? '', lb.cfi ?? '')
  else if (la.kind === 'page-rect' && lb.kind === 'page-rect') {
    diff =
      (la.page ?? 0) - (lb.page ?? 0) ||
      (la.rect?.y ?? 0) - (lb.rect?.y ?? 0) ||
      (la.rect?.x ?? 0) - (lb.rect?.x ?? 0)
  } else if (la.kind === 'text-offset' && lb.kind === 'text-offset') diff = (la.offset ?? 0) - (lb.offset ?? 0)
  if (diff !== 0) return diff
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
}

export function sortByDocumentOrder<T extends Anchored>(items: readonly T[]): T[] {
  return [...items].sort(compareAnchors)
}

export function groupByChapter<T extends Anchored>(items: readonly T[]): Map<number, T[]> {
  const groups = new Map<number, T[]>()
  for (const item of items) {
    const chapterIndex = chapterIndexOf(item.locator)
    const list = groups.get(chapterIndex)
    if (list) list.push(item)
    else groups.set(chapterIndex, [item])
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a - b))
}

export interface MarkupFilter {
  styleKinds?: readonly HighlightStyleKind[]
  /** Match highlights carrying ALL of these tags (case-insensitive). */
  tags?: readonly string[]
  /** Case-insensitive substring over selected text, note and tags. */
  text?: string
  chapterIndex?: number
}

export function filterMarkups<T extends HighlightRecord>(items: readonly T[], filter: MarkupFilter): T[] {
  const kinds = filter.styleKinds?.length ? new Set(filter.styleKinds) : null
  const tags = (filter.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)
  const needle = filter.text?.trim().toLowerCase() ?? ''

  return items.filter((m) => {
    if (kinds && !kinds.has(m.styleKind)) return false
    if (filter.chapterIndex !== undefined && chapterIndexOf(m.locator) !== filter.chapterIndex) return false
    if (tags.length > 0) {
      const own = new Set(m.tags.map((t) => t.toLowerCase()))
      if (!tags.every((t) => own.has(t))) return false
    }
    if (needle) {
      const haystack = [m.selectionText?.highlight, m.note, ...m.tags].filter(Boolean).join('\n').toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
}

/** Every distinct tag with its usage count, most used first. */
export function collectTags(items: readonly HighlightRecord[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const m of items) {
    for (const tag of m.tags) {
      const key = tag.toLowerCase()
      const entry = counts.get(key)
      if (entry) entry.count += 1
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Highlights whose CFI range overlaps `cfiRange` — e.g. "is this selection already highlighted?". */
export function findMarkupsOverlapping<T extends HighlightRecord>(items: readonly T[], cfiRange: string): T[] {
  return items.filter((m) => m.locator.kind === 'cfi' && cfiRangesOverlap(m.locator.cfi, cfiRange))
}

export function findBookmarksAt<T extends BookmarkRecord>(items: readonly T[], location: Location): T[] {
  return items.filter((b) => {
    try {
      return hydrateLocator(b.locator).equals(location)
    } catch {
      return false
    }
  })
}
