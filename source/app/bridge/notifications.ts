/** Typed wrappers for notifications:* IPC via window.api. */

export type NotificationSupport = Awaited<ReturnType<typeof window.api.notifications.getSupport>>

export type NotificationPrefs = Awaited<ReturnType<typeof window.api.notifications.getPrefs>>
export type NotificationPrefsResult = Awaited<ReturnType<typeof window.api.notifications.setEnabled>>
export type ReadingReminderPrefs = NotificationPrefs['reminder']
export type TestReminderResult = Awaited<ReturnType<typeof window.api.notifications.sendTestReminder>>
export type ReminderOpenBook = Parameters<Parameters<typeof window.api.notifications.onOpenBook>[0]>[0]

export const notificationsApi = {
  getSupport: () => window.api.notifications.getSupport(),
  getPrefs: () => window.api.notifications.getPrefs(),
  setEnabled: (enabled: boolean) => window.api.notifications.setEnabled(enabled),
  setReminder: (patch: Partial<ReadingReminderPrefs>) => window.api.notifications.setReminder(patch),
  resetPrefs: () => window.api.notifications.resetPrefs(),
  sendTestReminder: () => window.api.notifications.sendTestReminder(),
  onOpenBook: (handler: (target: ReminderOpenBook) => void) => window.api.notifications.onOpenBook(handler),
}
