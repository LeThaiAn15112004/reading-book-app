import { ipcMain, Notification } from 'electron'
import type { NotificationSupportDto } from './api-types'
import { NotificationChannels } from './channels'

/** Handlers for notifications:* — Settings → Notifications. */
export function registerNotificationsIpc(): void {
  ipcMain.removeHandler(NotificationChannels.getSupport)
  ipcMain.handle(
    NotificationChannels.getSupport,
    (): NotificationSupportDto => ({ supported: Notification.isSupported() }),
  )
}
