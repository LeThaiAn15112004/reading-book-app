import type { Location } from '@reading-book/book-reader-sdk'

/** Trailing quiet period after a relocate before writing. */
export const READING_SESSION_DEBOUNCE_MS = 750
/** Cap so a long burst of relocates still checkpoints within this window. */
export const READING_SESSION_MAX_WAIT_MS = 5000

export type SessionThemeFields = {
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
}

export type SessionNavMeta = {
  label?: string
  /** Scrubber map 0–100; not "% complete". */
  percent: number
}

export type SessionLatestSnapshot = {
  location?: Location
  meta: SessionNavMeta
  theme: SessionThemeFields
}

/** Platform-agnostic DTO for persisting session (desktop IPC / mobile store). */
export type SaveReadingSessionStateInput = {
  bookId: string
  lastReadLocation?: string
  lastReadLabel?: string
  percent?: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
  updatedAt?: string
}

export type ReadingSessionSaveResult = {
  ok: boolean
}

export type ReadingSessionSaveClient = {
  saveSessionState: (
    input: SaveReadingSessionStateInput,
  ) => Promise<ReadingSessionSaveResult>
}

export type PendingSessionSnapshot = {
  bookId: string
  lastReadLocation?: string
  lastReadLabel?: string
  percent: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  lineHeight?: number
  textAlign?: string
  layoutMode?: string
  pageTurnMode?: string
  marginsEnabled?: boolean
  marginPreset?: string
  isLandscape?: boolean
}

export function pendingFromSessionParts(
  id: string,
  location: Location | undefined,
  meta: SessionNavMeta,
  theme: SessionThemeFields,
): PendingSessionSnapshot {
  const lastReadLocation = location?.toString()
  return {
    bookId: id,
    lastReadLocation: lastReadLocation?.trim() || undefined,
    lastReadLabel: meta.label?.trim() || undefined,
    percent: Number.isFinite(meta.percent) ? meta.percent : 0,
    fontSize: theme.fontSize,
    fontFamily: theme.fontFamily,
    fontWeight: theme.fontWeight,
    lineHeight: theme.lineHeight,
    textAlign: theme.textAlign,
    layoutMode: theme.layoutMode,
    pageTurnMode: theme.pageTurnMode,
    marginsEnabled: theme.marginsEnabled,
    marginPreset: theme.marginPreset,
    isLandscape: theme.isLandscape,
  }
}

export function toSaveInput(
  snapshot: PendingSessionSnapshot,
  now = new Date().toISOString(),
): SaveReadingSessionStateInput {
  return {
    bookId: snapshot.bookId,
    lastReadLocation: snapshot.lastReadLocation,
    lastReadLabel: snapshot.lastReadLabel,
    percent: snapshot.percent,
    fontSize: snapshot.fontSize,
    fontFamily: snapshot.fontFamily,
    fontWeight: snapshot.fontWeight,
    lineHeight: snapshot.lineHeight,
    textAlign: snapshot.textAlign,
    layoutMode: snapshot.layoutMode,
    pageTurnMode: snapshot.pageTurnMode,
    marginsEnabled: snapshot.marginsEnabled,
    marginPreset: snapshot.marginPreset,
    isLandscape: snapshot.isLandscape,
    updatedAt: now,
  }
}
