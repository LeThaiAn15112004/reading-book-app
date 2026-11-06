import type { NotificationPrefsDto, ReadingReminderPrefsDto } from '../ipc/api-types'
import {
  DEFAULT_NOTIFICATION_PREFS,
  loadNotificationPrefs,
  normalizeNotificationPrefs,
  normalizeReminderTime,
  saveNotificationPrefs,
} from './notification-prefs'

/** In-memory copy of Main's notification prefs; the reminder worker reads it on every tick. */
let prefs: NotificationPrefsDto = structuredClone(DEFAULT_NOTIFICATION_PREFS) as NotificationPrefsDto

export function initNotificationSettings(): void {
  prefs = loadNotificationPrefs()
}

export function getNotificationPrefs(): NotificationPrefsDto {
  return { enabled: prefs.enabled, reminder: { ...prefs.reminder } }
}

/** Persist first, then apply — on a write error nothing changes and the error reaches the caller. */
function commit(next: unknown): NotificationPrefsDto {
  const normalized = normalizeNotificationPrefs(next)
  saveNotificationPrefs(normalized)
  prefs = normalized
  return getNotificationPrefs()
}

export function setNotificationsEnabled(enabled: boolean): NotificationPrefsDto {
  return commit({ ...prefs, enabled })
}

/** An invalid `time` keeps the current one (normalization never stores garbage). */
export function updateReminderPrefs(patch: Partial<ReadingReminderPrefsDto>): NotificationPrefsDto {
  const reminder = { ...prefs.reminder, ...patch }
  if (patch.time !== undefined) reminder.time = normalizeReminderTime(patch.time) ?? prefs.reminder.time
  return commit({ ...prefs, reminder })
}

export function resetNotificationPrefs(): NotificationPrefsDto {
  return commit(DEFAULT_NOTIFICATION_PREFS)
}
