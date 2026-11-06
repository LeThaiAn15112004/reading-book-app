import { notificationsApi } from '../../../bridge/notifications'

/**
 * Why notifications can't be turned on:
 * - `unsupported`: the OS / Electron reports it cannot show notifications (`Notification.isSupported()` in Main);
 * - `denied`: the notification permission for this app's web contents was refused;
 * - `error`: the check itself failed (Main unreachable…).
 */
export type NotificationPermissionResult = 'granted' | 'unsupported' | 'denied' | 'error'

/**
 * Settings → Notifications → Enable: OS support from Main first, then the renderer's notification
 * permission (Electron routes `Notification.requestPermission()` through the session permission
 * handler). Electron cannot read per-app OS switches such as Windows Focus Assist, so `granted`
 * means the app may show notifications, not that every one will be displayed.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  try {
    const { supported } = await notificationsApi.getSupport()
    if (!supported) return 'unsupported'
    if (typeof Notification === 'undefined') return 'unsupported'
    if (Notification.permission === 'granted') return 'granted'
    if (Notification.permission === 'denied') return 'denied'
    return (await Notification.requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'error'
  }
}
