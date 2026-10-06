/** Typed wrappers for notifications:* IPC via window.api. */

export type NotificationSupport = Awaited<ReturnType<typeof window.api.notifications.getSupport>>

export const notificationsApi = {
  getSupport: () => window.api.notifications.getSupport(),
}
