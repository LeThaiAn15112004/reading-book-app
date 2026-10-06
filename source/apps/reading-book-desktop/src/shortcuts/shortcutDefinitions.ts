/**
 * Single source of truth for the app's keyboard shortcuts. Settings → Keyboard Shortcuts renders
 * this list read-only; key handlers should read their bindings from here too, so a later
 * "Customize Shortcuts" only needs an override layer on top, not a rewrite.
 */

export type ShortcutGroupId = 'general'

/**
 * Key tokens are platform-neutral: `Mod` = Ctrl on Windows/Linux, ⌘ on macOS; `Alt` = ⌥ on macOS.
 * One binding is an ordered list of tokens pressed together, e.g. `['Mod', 'O']`.
 */
export type ShortcutKey = string

export type ShortcutDefinition = {
  id: string
  group: ShortcutGroupId
  label: string
  /** Alternatives; any one of them triggers the action. */
  bindings: readonly (readonly ShortcutKey[])[]
}

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroupId; label: string }[] = [
  { id: 'general', label: 'General' },
]

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: 'general.openBook', group: 'general', label: 'Open Book', bindings: [['Mod', 'O']] },
  { id: 'general.search', group: 'general', label: 'Search', bindings: [['Mod', 'F']] },
  { id: 'general.openSettings', group: 'general', label: 'Open Settings', bindings: [['Mod', ',']] },
  {
    id: 'general.backToLibrary',
    group: 'general',
    label: 'Back to Library',
    bindings: [['Alt', 'ArrowLeft']],
  },
]

export const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

const KEY_LABELS: Record<string, { win: string; mac: string }> = {
  Mod: { win: 'Ctrl', mac: '⌘' },
  Alt: { win: 'Alt', mac: '⌥' },
  Shift: { win: 'Shift', mac: '⇧' },
  ArrowLeft: { win: '←', mac: '←' },
  ArrowRight: { win: '→', mac: '→' },
}

/** Display label of one key token for the given platform. */
export function formatShortcutKey(key: ShortcutKey, mac: boolean = isMacPlatform): string {
  const label = KEY_LABELS[key]
  return label ? (mac ? label.mac : label.win) : key
}
