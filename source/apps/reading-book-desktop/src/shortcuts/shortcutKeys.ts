import { isMacPlatform, type ShortcutKeys } from './shortcutDefinitions'

const MODIFIER_ORDER = ['Mod', 'Alt', 'Shift']

const CODE_KEYS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  NumpadAdd: '=',
  NumpadSubtract: '-',
  NumpadEnter: 'Enter',
}

const NAMED_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'Delete',
  'Backspace',
  'Enter',
  'Tab',
  'Space',
])

/** Main key of a keyboard event as a token; null for a modifier on its own or an unsupported key. */
function mainKeyToken(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code)
  if (digit) return digit[1]
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  if (code in CODE_KEYS) return CODE_KEYS[code]
  if (NAMED_KEYS.has(code)) return code
  return null
}

/** The modifier / key fields of a `KeyboardEvent` that matter here (lets tests pass plain objects). */
export type KeyEventLike = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
>

/**
 * Combination pressed in `event` as normalized tokens, or null when it is only modifiers (or an
 * unsupported key). Uses `event.code` (the physical key) so ⌥/Shift don't change the key (⌥+O is
 * "ø" in `event.key`). `Mod` is Ctrl on Windows/Linux and ⌘ on macOS.
 */
export function shortcutKeysFromEvent(
  event: KeyEventLike,
  mac: boolean = isMacPlatform,
): string[] | null {
  const key = mainKeyToken(event.code)
  if (!key) return null
  const keys: string[] = []
  if (mac ? event.metaKey : event.ctrlKey) keys.push('Mod')
  if (event.altKey) keys.push('Alt')
  if (event.shiftKey) keys.push('Shift')
  keys.push(key)
  return keys
}

/** Canonical form: modifiers in `Mod, Alt, Shift` order without duplicates, letters upper-case. */
export function normalizeShortcutKeys(keys: ShortcutKeys): string[] {
  const modifiers = MODIFIER_ORDER.filter((m) => keys.includes(m))
  const main = keys
    .filter((k) => !MODIFIER_ORDER.includes(k))
    .map((k) => (k.length === 1 ? k.toUpperCase() : k))
  return [...modifiers, ...main.slice(-1)]
}

/** Stable string for comparing two combinations. */
export function shortcutKeysId(keys: ShortcutKeys): string {
  return normalizeShortcutKeys(keys).join('+')
}

function hasModifier(keys: ShortcutKeys): boolean {
  return keys.some((k) => MODIFIER_ORDER.includes(k))
}

/** Combinations the OS / text editing already own; taking them would break copy, paste, quit… */
const RESERVED = new Set(
  [
    ['Mod', 'C'],
    ['Mod', 'V'],
    ['Mod', 'X'],
    ['Mod', 'A'],
    ['Mod', 'Z'],
    ['Mod', 'Y'],
    ['Mod', 'Shift', 'Z'],
    ['Mod', 'Q'],
    ['Mod', 'W'],
    ['Alt', 'F4'],
  ].map(shortcutKeysId),
)

/** Main keys that stay usable without Ctrl/Alt for actions that opt in (`allowBare`). */
function isBareCapableKey(main: string): boolean {
  return (
    /^[A-Z0-9]$/.test(main) ||
    main.startsWith('Arrow') ||
    ['Home', 'End', 'PageUp', 'PageDown'].includes(main)
  )
}

export type ValidateShortcutOptions = {
  /** The action accepts a main key without Ctrl/Alt (see `ShortcutDefinition.allowBare`). */
  allowBare?: boolean
}

/**
 * True when no Ctrl/⌘ or Alt/⌥ is held — such a key (Shift aside) is also what the user types, so the
 * bridge ignores it while a text field has focus.
 */
export function isPlainShortcut(keys: ShortcutKeys): boolean {
  return !keys.includes('Mod') && !keys.includes('Alt')
}

/** Why `keys` can't be used as a shortcut at all (independent of other actions), or null. */
export function validateShortcutKeys(
  keys: ShortcutKeys,
  mac: boolean = isMacPlatform,
  options: ValidateShortcutOptions = {},
): string | null {
  const normalized = normalizeShortcutKeys(keys)
  const main = normalized[normalized.length - 1]
  if (!main || MODIFIER_ORDER.includes(main)) return 'Press a key together with the modifier.'
  const isFunctionKey = /^F\d+$/.test(main)
  if (!hasModifier(normalized) && !isFunctionKey) {
    if (!options.allowBare) {
      return `Add ${mac ? '⌘' : 'Ctrl'} or ${mac ? '⌥' : 'Alt'} — a plain key would break typing.`
    }
    if (!isBareCapableKey(main)) {
      return `Add ${mac ? '⌘' : 'Ctrl'} or ${mac ? '⌥' : 'Alt'} — this key can't be used on its own.`
    }
  }
  if (normalized.length === 2 && normalized[0] === 'Shift' && !isFunctionKey) {
    return 'Shift alone is used for typing — add another modifier.'
  }
  if (RESERVED.has(shortcutKeysId(normalized))) return 'This shortcut is reserved by the system.'
  return null
}

const KEY_LABELS: Record<string, { win: string; mac: string }> = {
  Mod: { win: 'Ctrl', mac: '⌘' },
  Alt: { win: 'Alt', mac: '⌥' },
  Shift: { win: 'Shift', mac: '⇧' },
  ArrowLeft: { win: '←', mac: '←' },
  ArrowRight: { win: '→', mac: '→' },
  ArrowUp: { win: '↑', mac: '↑' },
  ArrowDown: { win: '↓', mac: '↓' },
  PageUp: { win: 'Page Up', mac: 'Page Up' },
  PageDown: { win: 'Page Down', mac: 'Page Down' },
  Escape: { win: 'Esc', mac: 'Esc' },
}

/** Display label of one key token for the current platform. */
export function formatShortcutKey(key: string, mac: boolean = isMacPlatform): string {
  const label = KEY_LABELS[key]
  return label ? (mac ? label.mac : label.win) : key
}
