/**
 * Single source of truth for the app's keyboard shortcuts: their defaults and the contexts they are
 * active in. Settings → Keyboard Shortcuts lists these, `shortcutsStore` keeps the user's changes as
 * overrides on top, and `ShortcutsBridge` matches key presses against the effective keys.
 */

export type ShortcutGroupId = 'general'

/**
 * Screens a shortcut can be active on. They are routes, so exactly one is current at a time: two
 * actions can only fire on the same key press when their contexts share a screen (see
 * `shortcutConflicts.ts`).
 */
export type ShortcutContext = 'library' | 'reader' | 'settings'

export type ShortcutId =
  | 'general.openBook'
  | 'general.openSettings'
  | 'general.backToLibrary'
  | 'general.searchLibrary'
  | 'general.searchBook'

/**
 * Platform-neutral key tokens pressed together: `Mod` (Ctrl on Windows/Linux, ⌘ on macOS), `Alt`
 * (⌥ on macOS), `Shift`, then the main key — always in that order. See `shortcutKeys.ts`.
 */
export type ShortcutKeys = readonly string[]

export type ShortcutDefinition = {
  id: ShortcutId
  group: ShortcutGroupId
  label: string
  contexts: readonly ShortcutContext[]
  defaultKeys: ShortcutKeys
}

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroupId; label: string }[] = [
  { id: 'general', label: 'General' },
]

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'general.openBook',
    group: 'general',
    label: 'Open Book',
    contexts: ['library', 'reader', 'settings'],
    defaultKeys: ['Mod', 'O'],
  },
  {
    id: 'general.searchLibrary',
    group: 'general',
    label: 'Search Library',
    contexts: ['library'],
    defaultKeys: ['Mod', 'F'],
  },
  {
    id: 'general.searchBook',
    group: 'general',
    label: 'Search in Book',
    contexts: ['reader'],
    defaultKeys: ['Mod', 'F'],
  },
  {
    id: 'general.openSettings',
    group: 'general',
    label: 'Open Settings',
    contexts: ['library', 'reader'],
    defaultKeys: ['Mod', ','],
  },
  {
    id: 'general.backToLibrary',
    group: 'general',
    label: 'Back to Library',
    contexts: ['reader', 'settings'],
    defaultKeys: ['Alt', 'ArrowLeft'],
  },
]

export function getShortcut(id: ShortcutId): ShortcutDefinition {
  const def = SHORTCUTS.find((s) => s.id === id)
  if (!def) throw new Error(`Unknown shortcut: ${id}`)
  return def
}

export const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
