/**
 * Spec 016 (FR-011a, research R7): files picked in the multi-file "Add file" dialog. The renderer never receives a
 * path: it gets one opaque `pickId` per file and later asks Main to import that pick (`import:runJob`). A pick is used
 * once, and expires after 30 minutes (same rule as `zip-import/picked-zip.ts`).
 */
import { randomUUID } from 'node:crypto'

export const PICK_TTL_MS = 30 * 60 * 1000

const picks = new Map<string, { path: string; expiresAt: number }>()

function sweep(now: number): void {
  for (const [id, pick] of picks) if (pick.expiresAt <= now) picks.delete(id)
}

/** Keeps `filePath` for a later `takePickedFile`; returns its pick id. */
export function holdPickedFile(filePath: string, now = Date.now()): string {
  sweep(now)
  const id = randomUUID()
  picks.set(id, { path: filePath, expiresAt: now + PICK_TTL_MS })
  return id
}

/** The path of a pick, once; `null` when unknown, used or expired. */
export function takePickedFile(pickId: unknown, now = Date.now()): string | null {
  if (typeof pickId !== 'string') return null
  sweep(now)
  const pick = picks.get(pickId)
  picks.delete(pickId)
  return pick ? pick.path : null
}

/** Picks still held (for checks). */
export function heldPickCount(now = Date.now()): number {
  sweep(now)
  return picks.size
}
