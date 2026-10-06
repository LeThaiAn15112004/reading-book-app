import {
  SHORTCUT_GROUPS,
  SHORTCUTS,
  formatShortcutKey,
  type ShortcutDefinition,
} from '../../../../shortcuts/shortcutDefinitions'
import { SettingsCard } from '../layout/SettingsCard'

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-lib-border bg-lib-chip px-1.5 font-[inherit] text-[12px] font-semibold text-lib-text-strong shadow-[inset_0_-1px_0_var(--color-lib-border)]">
      {children}
    </kbd>
  )
}

function ShortcutBindings({ shortcut }: { shortcut: ShortcutDefinition }) {
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      {shortcut.bindings.map((binding, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <span className="mr-1 text-[12px] text-lib-faint">or</span> : null}
          {binding.map((key, k) => (
            <span key={k} className="flex items-center gap-1">
              {k > 0 ? <span className="text-[12px] text-lib-faint">+</span> : null}
              <Kbd>{formatShortcutKey(key)}</Kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

/** SCR-06 Settings → Keyboard Shortcuts: read-only list of the app's shortcuts, per group. */
export function KeyboardShortcutsSettings() {
  return (
    <div className="flex flex-col gap-[var(--ui-density-gap)]">
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsCard key={group.id} title={group.label}>
          <ul
            className="m-0 list-none divide-y divide-lib-border-soft overflow-hidden rounded-lg border border-lib-border-soft p-0"
            aria-label={`${group.label} shortcuts`}
          >
            {SHORTCUTS.filter((s) => s.group === group.id).map((shortcut) => (
              <li
                key={shortcut.id}
                className="flex min-h-[var(--ui-density-row)] items-center justify-between gap-3 px-3 py-1.5 text-[13px]"
              >
                <span className="min-w-0 truncate font-medium text-lib-text-strong">
                  {shortcut.label}
                </span>
                <ShortcutBindings shortcut={shortcut} />
              </li>
            ))}
          </ul>
        </SettingsCard>
      ))}
    </div>
  )
}
