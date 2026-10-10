/**
 * Single source of truth for the app's keyboard shortcuts: their defaults and the contexts they are
 * active in. Settings → Keyboard Shortcuts lists these, `shortcutsStore` keeps the user's changes as
 * overrides on top, and `ShortcutsBridge` matches key presses against the effective keys.
 *
 * A definition says what a key *should* do. Whether the open screen can actually do it is decided by
 * the handler a screen registers with `useShortcutAction` (see `shortcutActions.ts`).
 */

export type ShortcutGroupId = 'general' | 'navigation' | 'search' | 'view'

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
  | 'navigation.nextPage'
  | 'navigation.previousPage'
  | 'navigation.firstPage'
  | 'navigation.lastPage'
  | 'navigation.goToPage'
  | 'navigation.addBookmark'
  | 'navigation.toggleToc'
  | 'search.nextResult'
  | 'search.previousResult'
  | 'search.close'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.resetZoom'
  | 'view.toggleFullscreen'

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
  /**
   * Fixed alternate keys (`→` + `Page Down`). They are matched at runtime and take part in conflict
   * detection like the main keys, but the user can't change them.
   */
  aliases?: readonly ShortcutKeys[]
  /** The user may rebind the main key to one without Ctrl/Alt (letters, arrows, Home/End…). */
  allowBare?: boolean
  /** Not rebindable — shown in Settings for reference (Enter / Shift+Enter / Esc in search). */
  locked?: boolean
  /**
   * Behaviour is owned by an existing hard-coded handler (Esc chains through popovers, tools and
   * panels); the bridge doesn't match it, Settings only lists it.
   */
  displayOnly?: boolean
  /** Fire again while the key is held (page turning); other shortcuts ignore auto-repeat. */
  allowRepeat?: boolean
  /** Leave the key to a focused text field even with Ctrl/⌘ held (view zoom keeps text editing intact). */
  ignoreInTextFields?: boolean
}

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroupId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'search', label: 'Search' },
  { id: 'view', label: 'View' },
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
  {
    id: 'navigation.nextPage',
    group: 'navigation',
    label: 'Next Page',
    contexts: ['reader'],
    defaultKeys: ['ArrowRight'],
    aliases: [['PageDown']],
    allowBare: true,
    allowRepeat: true,
  },
  {
    id: 'navigation.previousPage',
    group: 'navigation',
    label: 'Previous Page',
    contexts: ['reader'],
    defaultKeys: ['ArrowLeft'],
    aliases: [['PageUp']],
    allowBare: true,
    allowRepeat: true,
  },
  {
    id: 'navigation.firstPage',
    group: 'navigation',
    label: 'Start of Book',
    contexts: ['reader'],
    defaultKeys: ['Home'],
    allowBare: true,
  },
  {
    id: 'navigation.lastPage',
    group: 'navigation',
    label: 'End of Book',
    contexts: ['reader'],
    defaultKeys: ['End'],
    allowBare: true,
  },
  {
    id: 'navigation.goToPage',
    group: 'navigation',
    label: 'Go to Page',
    contexts: ['reader'],
    defaultKeys: ['Mod', 'G'],
  },
  {
    id: 'navigation.addBookmark',
    group: 'navigation',
    label: 'Add Bookmark',
    contexts: ['reader'],
    defaultKeys: ['Mod', 'D'],
  },
  {
    id: 'navigation.toggleToc',
    group: 'navigation',
    label: 'Table of Contents',
    contexts: ['reader'],
    defaultKeys: ['T'],
    allowBare: true,
  },
  {
    id: 'general.searchLibrary',
    group: 'search',
    label: 'Search Library',
    contexts: ['library'],
    defaultKeys: ['Mod', 'F'],
  },
  {
    id: 'general.searchBook',
    group: 'search',
    label: 'Search in Book',
    contexts: ['reader'],
    defaultKeys: ['Mod', 'F'],
  },
  {
    id: 'search.nextResult',
    group: 'search',
    label: 'Next Result',
    contexts: ['reader'],
    defaultKeys: ['Enter'],
    locked: true,
  },
  {
    id: 'search.previousResult',
    group: 'search',
    label: 'Previous Result',
    contexts: ['reader'],
    defaultKeys: ['Shift', 'Enter'],
    locked: true,
  },
  {
    id: 'search.close',
    group: 'search',
    label: 'Close Search / Cancel',
    contexts: ['reader'],
    defaultKeys: ['Escape'],
    locked: true,
    displayOnly: true,
  },
  {
    id: 'view.zoomIn',
    group: 'view',
    label: 'Zoom In',
    contexts: ['reader'],
    defaultKeys: ['Mod', '='],
    // Ctrl/⌘ + "+" (Shift held on layouts where + shares the = key) has always zoomed in too.
    aliases: [['Mod', 'Shift', '=']],
    ignoreInTextFields: true,
  },
  {
    id: 'view.zoomOut',
    group: 'view',
    label: 'Zoom Out',
    contexts: ['reader'],
    defaultKeys: ['Mod', '-'],
    aliases: [['Mod', 'Shift', '-']],
    ignoreInTextFields: true,
  },
  {
    id: 'view.resetZoom',
    group: 'view',
    label: 'Reset Zoom',
    contexts: ['reader'],
    defaultKeys: ['Mod', '0'],
    ignoreInTextFields: true,
  },
  {
    id: 'view.toggleFullscreen',
    group: 'view',
    label: 'Toggle Fullscreen',
    // Window-level, so it works on every screen (it used to be handled by the Main process).
    contexts: ['library', 'reader', 'settings'],
    defaultKeys: ['F11'],
  },
]

export function getShortcut(id: ShortcutId): ShortcutDefinition {
  const def = SHORTCUTS.find((s) => s.id === id)
  if (!def) throw new Error(`Unknown shortcut: ${id}`)
  return def
}

export const isMacPlatform = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
