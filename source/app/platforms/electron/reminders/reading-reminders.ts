import { Notification, powerMonitor } from 'electron'
import type { TestReminderResult } from '../ipc/api-types'
import { getNotificationPrefs } from '../notifications/notification-settings'
import { getDatabase } from '../persistence/db'
import { readJsonPrefsFile, writeJsonPrefsFile } from '../prefs/json-prefs-file'
import { hasReadSince, lastBookInProgress, type BookInProgress } from './reading-activity'
import { reminderMessage } from './reminder-schedule'
import { createReminderWorker, type ReminderWorker } from './reminder-worker'

/**
 * Reading Reminders in Main: one minute-aligned worker (reminder-worker.ts) checks the rules
 * (reminder-schedule.ts) and shows a native notification; clicking it opens the book in progress.
 *
 * SQLite: only short read-only queries on the app's single connection (`getDatabase()`), and the
 * worker is stopped in `will-quit` before that connection is closed — nothing is opened or leaked.
 */

/** `{ lastSentDate }` — the worker's bookkeeping; kept apart from the prefs so a reset keeps it. */
const STATE_FILE = 'reading-reminder-state.json'

let lastSentDate: string | null = null
let worker: ReminderWorker | null = null
let openBookFromReminder: (book: BookInProgress | null) => void = () => {}
/** Shown notifications must stay referenced, or their click handler can be garbage-collected. */
const shown = new Set<Notification>()

function loadLastSentDate(): string | null {
  const raw = readJsonPrefsFile(STATE_FILE) as { lastSentDate?: unknown } | undefined
  const value = raw?.lastSentDate
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function saveLastSentDate(date: string | null): void {
  lastSentDate = date
  try {
    writeJsonPrefsFile(STATE_FILE, { lastSentDate: date })
  } catch (err) {
    // Memory still holds it, so this run can't send twice; worst case one repeat after a restart.
    console.error('Reading reminder state could not be saved:', err)
  }
}

function showReminder(): boolean {
  if (!Notification.isSupported()) return false
  let book: BookInProgress | null = null
  try {
    book = lastBookInProgress(getDatabase())
  } catch (err) {
    console.error('Reading reminder: could not look up the book in progress:', err)
  }
  const { title, body } = reminderMessage(book?.title || null)
  const notification = new Notification({ title, body })
  shown.add(notification)
  const release = () => shown.delete(notification)
  notification.on('click', () => {
    release()
    openBookFromReminder(book)
  })
  notification.on('close', release)
  notification.on('failed', release)
  notification.show()
  return true
}

function onResume(): void {
  worker?.checkNow()
}

/** Start after the DB is open and notification prefs are loaded. */
export function startReadingReminders(options: { openBook: (book: BookInProgress | null) => void }): void {
  if (worker) return
  openBookFromReminder = options.openBook
  lastSentDate = loadLastSentDate()
  worker = createReminderWorker({
    now: () => new Date(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    getPrefs: () => {
      const prefs = getNotificationPrefs()
      return {
        notificationsEnabled: prefs.enabled,
        reminderEnabled: prefs.reminder.enabled,
        time: prefs.reminder.time,
      }
    },
    getLastSentDate: () => lastSentDate,
    setLastSentDate: saveLastSentDate,
    hasReadSince: (since) => hasReadSince(getDatabase(), since),
    send: showReminder,
    onError: (err) => console.error('Reading reminder check failed:', err),
  })
  worker.start()
  // Timers don't run while the computer sleeps: check as soon as it is back.
  powerMonitor.on('resume', onResume)
  powerMonitor.on('unlock-screen', onResume)
}

/** Stop before the database closes (`will-quit`). */
export function stopReadingReminders(): void {
  worker?.stop()
  worker = null
  powerMonitor.removeListener('resume', onResume)
  powerMonitor.removeListener('unlock-screen', onResume)
}

/**
 * Settings → "Send test reminder": shows the reminder now, ignoring time / once-a-day / read-today
 * (and without recording it), but still only while notifications are on.
 */
export function sendTestReminder(): TestReminderResult {
  if (!getNotificationPrefs().enabled || !Notification.isSupported()) return { status: 'blocked' }
  try {
    return { status: showReminder() ? 'sent' : 'blocked' }
  } catch (err) {
    console.error('Test reminder failed:', err)
    return { status: 'failed' }
  }
}
