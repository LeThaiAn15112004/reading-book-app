import {
  SHORTCUTS,
  getShortcut,
  type ShortcutDefinition,
  type ShortcutId,
  type ShortcutKeys,
} from './shortcutDefinitions'
import { shortcutKeysId } from './shortcutKeys'

/** Effective main keys of every shortcut (aliases are fixed and live on the definition). */
export type ShortcutKeyMap = Readonly<Record<ShortcutId, ShortcutKeys>>

/** Two actions can fire on the same key press only if they are active on a common screen. */
export function contextsOverlap(a: ShortcutId, b: ShortcutId): boolean {
  const other = getShortcut(b).contexts
  return getShortcut(a).contexts.some((context) => other.includes(context))
}

/**
 * Every normalized combination that triggers `shortcut`: its effective main keys plus its fixed
 * aliases. The bridge matches against this, and conflict detection compares against it, so an alias
 * can never silently shadow (or be shadowed by) another action.
 */
export function shortcutComboIds(shortcut: ShortcutDefinition, current: ShortcutKeyMap): string[] {
  return [current[shortcut.id], ...(shortcut.aliases ?? [])].map(shortcutKeysId)
}

/**
 * Another action that would also fire for `keys` when assigned to `id`: same normalized
 * combination (main keys or alias) and an overlapping context. Duplicates across contexts that never
 * coexist (e.g. Search Library vs Search in Book) are not conflicts. Returns `id` itself when `keys`
 * is already one of the action's own aliases; null when there is no conflict.
 */
export function findShortcutConflict(
  id: ShortcutId,
  keys: ShortcutKeys,
  current: ShortcutKeyMap,
): ShortcutId | null {
  const combo = shortcutKeysId(keys)
  const own = getShortcut(id)
  if ((own.aliases ?? []).some((alias) => shortcutKeysId(alias) === combo)) return id
  for (const s of SHORTCUTS) {
    if (s.id === id) continue
    if (shortcutComboIds(s, current).includes(combo) && contextsOverlap(id, s.id)) return s.id
  }
  return null
}
