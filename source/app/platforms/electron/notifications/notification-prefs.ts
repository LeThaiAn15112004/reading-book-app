import type { NotificationPrefsDto, ReadingReminderPrefsDto } from '../ipc/api-types'
import { readJsonPrefsFile, writeJsonPrefsFile } from '../prefs/json-prefs-file'

/**
 * Settings → Notifications (master switch + Reading Reminders). Owned by Main because the reminder
 * worker runs there, also while the window is hidden: `{userData}/notification-prefs.json`.
 * The worker's own bookkeeping (`lastSentDate`) is state, not a preference — see reminder-state.ts.
 */

/** Single source of the defaults (first run, corrupt file, Settings → Reset App Settings). */
export const DEFAULT_NOTIFICATION_PREFS: Readonly<NotificationPrefsDto> = {
  enabled: false,
  reminder: { enabled: false, time: '20:00' },
}

const FILE = 'notification-prefs.json'

/** `H:MM` / `HH:MM`, 24-hour local wall-clock time → normalized `HH:MM`, or null. */
export function normalizeReminderTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function normalizeReminder(raw: unknown): ReadingReminderPrefsDto {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_NOTIFICATION_PREFS.reminder.enabled,
    time: normalizeReminderTime(value.time) ?? DEFAULT_NOTIFICATION_PREFS.reminder.time,
  }
}

/** Validate any stored / incoming value; unknown or malformed fields fall back to the defaults. */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefsDto {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_NOTIFICATION_PREFS.enabled,
    reminder: normalizeReminder(value.reminder),
  }
}

export function loadNotificationPrefs(): NotificationPrefsDto {
  return normalizeNotificationPrefs(readJsonPrefsFile(FILE))
}

/** Atomic write. Throws when the file can't be written. */
export function saveNotificationPrefs(prefs: NotificationPrefsDto): void {
  writeJsonPrefsFile(FILE, prefs)
}
