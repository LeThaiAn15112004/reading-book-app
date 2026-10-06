import {
  SHORTCUTS,
  getShortcut,
  type ShortcutId,
  type ShortcutKeys,
} from './shortcutDefinitions'
import { shortcutKeysId } from './shortcutKeys'

/** Effective keys of every shortcut. */
export type ShortcutKeyMap = Readonly<Record<ShortcutId, ShortcutKeys>>

/** Two actions can fire on the same key press only if they are active on a common screen. */
export function contextsOverlap(a: ShortcutId, b: ShortcutId): boolean {
  const other = getShortcut(b).contexts
  return getShortcut(a).contexts.some((context) => other.includes(context))
}

/**
 * Another action that would also fire for `keys` when assigned to `id`: same normalized
 * combination and an overlapping context. Duplicates across contexts that never coexist (e.g.
 * Search Library vs Search in Book) are not conflicts. Null when there is none.
 */
export function findShortcutConflict(
  id: ShortcutId,
  keys: ShortcutKeys,
  current: ShortcutKeyMap,
): ShortcutId | null {
  const combo = shortcutKeysId(keys)
  for (const s of SHORTCUTS) {
    if (s.id === id) continue
    if (shortcutKeysId(current[s.id]) === combo && contextsOverlap(id, s.id)) return s.id
  }
  return null
}
