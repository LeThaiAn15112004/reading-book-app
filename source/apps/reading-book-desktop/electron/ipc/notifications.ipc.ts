import { ipcMain, Notification } from 'electron'
import {
  getNotificationPrefs,
  resetNotificationPrefs,
  setNotificationsEnabled,
  updateReminderPrefs,
} from '../notifications/notification-settings'
import { sendTestReminder } from '../reminders/reading-reminders'
import type {
  NotificationPrefsDto,
  NotificationPrefsResult,
  NotificationSupportDto,
  ReadingReminderPrefsDto,
  TestReminderResult,
} from './api-types'
import { NotificationChannels } from './channels'

/** Only the known reminder fields, with the right types, are accepted from the renderer. */
function reminderPatchFrom(input: unknown): Partial<ReadingReminderPrefsDto> {
  if (typeof input !== 'object' || input === null) return {}
  const raw = input as Record<string, unknown>
  const patch: Partial<ReadingReminderPrefsDto> = {}
  if (typeof raw.enabled === 'boolean') patch.enabled = raw.enabled
  if (typeof raw.time === 'string') patch.time = raw.time
  return patch
}

function persist(apply: () => NotificationPrefsDto): NotificationPrefsResult {
  try {
    return { ok: true, prefs: apply() }
  } catch (err) {
    console.error('Notification prefs could not be saved:', err)
    return { ok: false, prefs: getNotificationPrefs() }
  }
}

/** Handlers for notifications:* — Settings → Notifications (master switch, Reading Reminders). */
export function registerNotificationsIpc(): void {
  for (const channel of Object.values(NotificationChannels)) ipcMain.removeHandler(channel)

  ipcMain.handle(
    NotificationChannels.getSupport,
    (): NotificationSupportDto => ({ supported: Notification.isSupported() }),
  )
  ipcMain.handle(NotificationChannels.getPrefs, (): NotificationPrefsDto => getNotificationPrefs())
  ipcMain.handle(NotificationChannels.setEnabled, (_event, enabled: unknown): NotificationPrefsResult => {
    if (typeof enabled !== 'boolean') return { ok: false, prefs: getNotificationPrefs() }
    return persist(() => setNotificationsEnabled(enabled))
  })
  ipcMain.handle(
    NotificationChannels.setReminder,
    (_event, patch: unknown): NotificationPrefsResult =>
      persist(() => updateReminderPrefs(reminderPatchFrom(patch))),
  )
  ipcMain.handle(
    NotificationChannels.resetPrefs,
    (): NotificationPrefsResult => persist(() => resetNotificationPrefs()),
  )
  ipcMain.handle(NotificationChannels.sendTestReminder, (): TestReminderResult => sendTestReminder())
}
