/**
 * Reading reminder rules — pure (no Electron / SQLite), so they can be checked with any clock and
 * time zone (spikes/reminders). Every date here is the system's LOCAL wall-clock date: a reminder
 * at 20:00 means 20:00 where the user is, and "today" starts at local midnight — never UTC.
 */

/**
 * If the computer is asleep / the app isn't running at the exact minute, the reminder may still go
 * out up to this long after the chosen time — but never later, so nobody gets pinged at midnight.
 */
export const REMINDER_GRACE_MINUTES = 60

/** Local calendar date as `YYYY-MM-DD` (what `lastSentDate` stores). */
export function localDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Local midnight that starts `date`'s day. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Minutes since local midnight for `HH:MM`; NaN when malformed. */
export function reminderMinuteOfDay(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return Number.NaN
  return Number(match[1]) * 60 + Number(match[2])
}

/** Delay until the next local minute boundary (+ a small margin past :00). */
export function msUntilNextMinute(now: Date, marginMs = 500): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + marginMs
}

export type ReminderSkipReason =
  | 'notifications-off'
  | 'reminder-off'
  | 'not-time-yet'
  | 'window-passed'
  | 'already-sent-today'
  | 'read-today'

export type ReminderDecision = { send: true } | { send: false; reason: ReminderSkipReason }

/**
 * Decide one tick. `readToday` is only needed (a SQLite query) when every cheaper condition passed,
 * so it is a callback, evaluated last.
 */
export function decideReminder(input: {
  now: Date
  notificationsEnabled: boolean
  reminderEnabled: boolean
  /** `HH:MM`, local. */
  time: string
  /** `YYYY-MM-DD` (local) of the last reminder sent, or null. */
  lastSentDate: string | null
  readToday: () => boolean
}): ReminderDecision {
  if (!input.notificationsEnabled) return { send: false, reason: 'notifications-off' }
  if (!input.reminderEnabled) return { send: false, reason: 'reminder-off' }

  const due = reminderMinuteOfDay(input.time)
  const nowMinute = input.now.getHours() * 60 + input.now.getMinutes()
  if (Number.isNaN(due) || nowMinute < due) return { send: false, reason: 'not-time-yet' }
  if (nowMinute >= due + REMINDER_GRACE_MINUTES) return { send: false, reason: 'window-passed' }

  if (input.lastSentDate === localDateKey(input.now)) return { send: false, reason: 'already-sent-today' }
  if (input.readToday()) return { send: false, reason: 'read-today' }
  return { send: true }
}

/** Notification copy. `bookTitle` = the book in progress the click will open, if any. */
export function reminderMessage(bookTitle: string | null): { title: string; body: string } {
  return {
    title: '📚 Time to read',
    body: bookTitle ? `Continue reading ${bookTitle}?` : 'Pick a book from your library and read a few pages?',
  }
}
