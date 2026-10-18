/**
 * What has to be written to bring the persisted TXT document up to date with the in-memory one.
 *
 * The persisted side is described by `TxtPersistedState` (the committed text, its revision and a
 * signature per annotation row); the live side is a `TxtDocument`. `planTxtCommit` is a pure diff
 * between the two, so a failed save simply leaves the persisted state untouched and the next
 * attempt re-derives the same (or a larger) plan — nothing is tracked by "dirty flags" that could
 * drift.
 */

import {
  packTxtAnnotationRef,
  type TxtReaderHighlight,
} from './txt-annotations.js'
import { packSelectionTextRef } from '../app-models/highlight-location.js'

export interface TxtPersistedState {
  /** Text of the last successful commit (or as opened). */
  text: string
  /** Revision of that text: 0 = the original file, +1 per committed text change. */
  revision: number
  /** Annotation id → signature of the row as last written. */
  rows: ReadonlyMap<string, string>
}

/** Everything about a row that is stored — two rows with equal signatures need no write. */
export function txtHighlightSignature(h: TxtReaderHighlight): string {
  return JSON.stringify([
    h.startOffset,
    h.endOffset,
    h.styleKind,
    h.colorHex,
    h.note ?? null,
    h.tags,
    h.selectionText ?? null,
  ])
}

export function createTxtPersistedState(
  text: string,
  revision: number,
  highlights: readonly TxtReaderHighlight[],
): TxtPersistedState {
  return { text, revision, rows: new Map(highlights.map((h) => [h.id, txtHighlightSignature(h)])) }
}

export interface TxtCommitPlan {
  textChanged: boolean
  /** Rows to insert or rewrite. */
  upserts: TxtReaderHighlight[]
  /** Rows to delete. */
  deletedIds: string[]
  /** Nothing to write. */
  empty: boolean
}

export function planTxtCommit(
  persisted: TxtPersistedState,
  current: { text: string; highlights: readonly TxtReaderHighlight[] },
): TxtCommitPlan {
  const textChanged = current.text !== persisted.text
  const upserts = current.highlights.filter((h) => persisted.rows.get(h.id) !== txtHighlightSignature(h))
  const live = new Set(current.highlights.map((h) => h.id))
  const deletedIds = [...persisted.rows.keys()].filter((id) => !live.has(id))
  return {
    textChanged,
    upserts,
    deletedIds,
    empty: !textChanged && upserts.length === 0 && deletedIds.length === 0,
  }
}

/** The persisted state once a plan made from `current` was committed as `revision`. */
export function committedTxtState(
  current: { text: string; highlights: readonly TxtReaderHighlight[] },
  revision: number,
): TxtPersistedState {
  return createTxtPersistedState(current.text, revision, current.highlights)
}

/** Wire shape of one annotation row (the desktop adds `bookId` and sends it as `SaveHighlightInput`). */
export interface TxtHighlightWire {
  id: string
  locatorRef: string
  styleKind: TxtReaderHighlight['styleKind']
  colorHex: string
  note?: string
  tags: string[]
  selectionTextRef?: string
  txtAnnotationRef: string
  createdAt: string
}

export function txtHighlightToWire(h: TxtReaderHighlight): TxtHighlightWire {
  return {
    id: h.id,
    locatorRef: h.locatorRef,
    styleKind: h.styleKind,
    colorHex: h.colorHex,
    note: h.note,
    tags: h.tags,
    selectionTextRef: packSelectionTextRef(h.selectionText),
    txtAnnotationRef: packTxtAnnotationRef({ startOffset: h.startOffset, endOffset: h.endOffset }),
    createdAt: h.createdAt,
  }
}
