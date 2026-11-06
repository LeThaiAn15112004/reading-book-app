/** Typed wrappers for notifications:* IPC via api. */

import { api } from '../platforms/api'
export type NotificationSupport = Awaited<ReturnType<typeof api.notifications.getSupport>>

export type NotificationPrefs = Awaited<ReturnType<typeof api.notifications.getPrefs>>
export type NotificationPrefsResult = Awaited<ReturnType<typeof api.notifications.setEnabled>>
export type ReadingReminderPrefs = NotificationPrefs['reminder']
export type TestReminderResult = Awaited<ReturnType<typeof api.notifications.sendTestReminder>>
export type ReminderOpenBook = Parameters<Parameters<typeof api.notifications.onOpenBook>[0]>[0]

export const notificationsApi = {
  getSupport: () => api.notifications.getSupport(),
  getPrefs: () => api.notifications.getPrefs(),
  setEnabled: (enabled: boolean) => api.notifications.setEnabled(enabled),
  setReminder: (patch: Partial<ReadingReminderPrefs>) => api.notifications.setReminder(patch),
  resetPrefs: () => api.notifications.resetPrefs(),
  sendTestReminder: () => api.notifications.sendTestReminder(),
  onOpenBook: (handler: (target: ReminderOpenBook) => void) => api.notifications.onOpenBook(handler),
}
