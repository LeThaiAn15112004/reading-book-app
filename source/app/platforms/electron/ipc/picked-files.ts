/**
 * Spec 016 (FR-011a, research R7): files picked in the multi-file "Add file" dialog. The renderer never receives a
 * path: it gets one opaque `pickId` per file and later asks Main to import that pick (`import:runJob`).
 *
 * Spec 017 (US4, R8, FR-020): a pick is held for as long as its job waits in the queue — there is NO time limit (a long
 * queue used to fail its last books after 30 minutes). A pick is removed when it is taken (`takePickedFile`), when the
 * renderer releases it (`releasePicks`: the waiting job was cancelled, dismissed or cleared), or with the process.
 * At most `MAX_HELD_PICKS` are held; beyond that the oldest is released (its job then fails as "pick the file again").
 */
import { randomUUID } from 'node:crypto'

export const MAX_HELD_PICKS = 500

/** Insertion order = age (Map keeps it), so the first key is the oldest pick. */
const picks = new Map<string, { path: string }>()

/** Keeps `filePath` for a later `takePickedFile`; returns its pick id. */
export function holdPickedFile(filePath: string): string {
  const id = randomUUID()
  picks.set(id, { path: filePath })
  while (picks.size > MAX_HELD_PICKS) {
    const oldest = picks.keys().next().value
    if (oldest === undefined) break
    picks.delete(oldest)
  }
  return id
}

/** The path of a pick, once; `null` when unknown, used or released. */
export function takePickedFile(pickId: unknown): string | null {
  if (typeof pickId !== 'string') return null
  const pick = picks.get(pickId)
  picks.delete(pickId)
  return pick ? pick.path : null
}

/** `import:releasePicks`: forgets the given picks (unknown ids ignored). Untrusted input. Returns how many went. */
export function releasePicks(pickIds: unknown): number {
  if (!Array.isArray(pickIds)) return 0
  let released = 0
  for (const id of pickIds.slice(0, MAX_HELD_PICKS)) {
    if (typeof id === 'string' && picks.delete(id)) released++
  }
  return released
}

/** Picks still held (for checks). */
export function heldPickCount(): number {
  return picks.size
}
