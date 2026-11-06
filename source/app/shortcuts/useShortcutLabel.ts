import { effectiveShortcutKeys, useShortcutsStore } from './shortcutsStore'
import { formatShortcutKey } from './shortcutKeys'
import type { ShortcutId } from './shortcutDefinitions'

/** Current keys of a shortcut as display text (`Ctrl+=`), following the user's customization. */
export function useShortcutLabel(id: ShortcutId): string {
  const overrides = useShortcutsStore((s) => s.overrides)
  return effectiveShortcutKeys(overrides)[id].map((key) => formatShortcutKey(key)).join('+')
}
