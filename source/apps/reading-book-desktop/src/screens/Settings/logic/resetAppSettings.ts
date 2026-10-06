import { useShortcutsStore } from '../../../shortcuts/shortcutsStore'
import { useAppAppearanceStore } from '../../../theme/appAppearanceStore'
import { useLibraryBrowseStore } from '../../Library/logic/libraryBrowseStore'
import { useBackgroundStore } from './backgroundStore'
import { useNotificationsStore } from './notificationsStore'

/**
 * One group of application-level preferences that Reset App Settings restores. Each group's store
 * owns its defaults and persistence; `reset` writes those defaults back (selectively — only that
 * group's own keys/fields) and returns false when the write failed. Groups owned by Main (Background &
 * System Tray) answer asynchronously over IPC.
 */
export type AppSettingsResetter = {
  id: string
  label: string
  reset: () => boolean | Promise<boolean>
}

/**
 * Everything Settings → Advanced → Reset App Settings restores. A new resettable group adds a line here.
 *
 * Never listed: books, book files, collections, annotations, reading progress, book metadata,
 * reading or search history, per-book reading settings (SQLite `books.reading_state_json`) and the
 * global reading defaults in `GlobalReadingPrefs` — only its `theme` follows Appearance, via
 * `AppAppearanceBridge`.
 */
export const APP_SETTINGS_RESETTERS: readonly AppSettingsResetter[] = [
  { id: 'appearance', label: 'Appearance', reset: () => useAppAppearanceStore.getState().reset() },
  { id: 'library', label: 'Library', reset: () => useLibraryBrowseStore.getState().reset() },
  {
    id: 'notifications',
    label: 'Notifications',
    reset: () => useNotificationsStore.getState().reset(),
  },
  {
    id: 'background',
    label: 'Background & System Tray',
    reset: () => useBackgroundStore.getState().reset(),
  },
  {
    id: 'keyboard-shortcuts',
    label: 'Keyboard Shortcuts',
    reset: () => useShortcutsStore.getState().reset(),
  },
]

export type ResetAppSettingsResult = {
  /** Groups whose defaults could not be saved (in-memory state is still reset where possible). */
  failed: readonly AppSettingsResetter[]
}

/**
 * Restore every application preference group to its defaults. Each group runs on its own so one
 * failure does not stop the rest. Stores update in place, so the UI reflects the defaults at once.
 */
export async function resetAppSettings(
  resetters: readonly AppSettingsResetter[] = APP_SETTINGS_RESETTERS,
): Promise<ResetAppSettingsResult> {
  const failed: AppSettingsResetter[] = []
  for (const resetter of resetters) {
    try {
      if (!(await resetter.reset())) failed.push(resetter)
    } catch {
      failed.push(resetter)
    }
  }
  return { failed }
}
