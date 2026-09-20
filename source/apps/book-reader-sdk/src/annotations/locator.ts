import { Location, TextOffsetLocation } from '../domain/index.js'
import type { NoteLocator } from '../domain/annotation/note.js'

/**
 * Pack/unpack the `notes.note_json.locatorExtended.locator` shape: a serialized domain
 * `Location` plus the `chapterIndex` captured at creation time (`NoteLocator` — see
 * `domain/annotation/note.ts`). Non-EPUB surfaces without a real renderer yet anchor to a
 * `TextOffsetLocation` whose `blockId` is `fake:<chapterIndex>` so a locator written before an
 * exact position exists still resolves to the right chapter.
 */
const FAKE_CHAPTER_RE = /^fake:(\d+)/

function clampChapter(index: number): number {
  return Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
}

/** Hydrate a domain `Location` from a stored `NoteLocator` (throws if malformed). */
export function hydrateLocator(locator: NoteLocator): Location {
  return Location.parse(JSON.stringify(locator))
}

/** Pack a hydrated `Location` + chapterIndex into the `NoteLocator` shape persisted on disk. */
export function toNoteLocator(location: Location, chapterIndex: number): NoteLocator {
  const plain = JSON.parse(location.toString()) as Record<string, unknown>
  plain.chapterIndex = clampChapter(chapterIndex)
  return plain as unknown as NoteLocator
}

export function packLocator(location: Location, chapterIndex: number): string {
  return JSON.stringify(toNoteLocator(location, chapterIndex))
}

export function chapterIndexOf(locator: NoteLocator): number {
  const raw = (locator as { chapterIndex?: unknown }).chapterIndex
  if (typeof raw === 'number' && Number.isFinite(raw)) return clampChapter(raw)
  // Rows written before chapterIndex existed encode the chapter as `fake:<n>` in the blockId.
  try {
    const location = hydrateLocator(locator)
    if (location instanceof TextOffsetLocation) {
      const match = location.blockId?.match(FAKE_CHAPTER_RE)
      if (match) return clampChapter(Number(match[1]))
    }
  } catch {
    /* keep 0 */
  }
  return 0
}

/**
 * Locator object (already JSON-parsed) → anchor. `undefined` for anything that is not a valid
 * location, so callers can drop stale rows instead of listing entries that can never jump.
 */
export function anchorFromLocator(value: unknown): { location: Location; chapterIndex: number } | undefined {
  if (!value || typeof value !== 'object') return undefined
  let location: Location
  try {
    location = hydrateLocator(value as NoteLocator)
  } catch {
    return undefined
  }
  return { location, chapterIndex: chapterIndexOf(value as NoteLocator) }
}

export function unpackLocator(raw: string | null | undefined): { location: Location; chapterIndex: number } | undefined {
  if (!raw?.trim()) return undefined
  try {
    return anchorFromLocator(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** A `fake:<chapterIndex>` anchor for surfaces without a real renderer yet. */
export function chapterAnchorLocation(chapterIndex: number): Location {
  return new TextOffsetLocation(0, `fake:${clampChapter(chapterIndex)}`)
}
