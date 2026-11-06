import { localDateKey, msUntilNextMinute, startOfLocalDay, decideReminder } from './reminder-schedule'
import type { ReminderDecision } from './reminder-schedule'

/**
 * Minute-aligned reminder loop. Instead of `setInterval` (which drifts and can overlap a slow tick)
 * each tick re-schedules the next one for just after the next local minute boundary, measured from
 * the real clock — so ticks stay on :00 and never pile up. Everything external is injected, so the
 * loop runs with fake clocks / timers in spikes/reminders.
 */
export type ReminderWorkerDeps = {
  now: () => Date
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  getPrefs: () => { notificationsEnabled: boolean; reminderEnabled: boolean; time: string }
  getLastSentDate: () => string | null
  /** Persist before the notification is shown, so a crash can't produce a second one today. */
  setLastSentDate: (date: string | null) => void
  hasReadSince: (since: Date) => boolean
  /** Show the reminder. Returns false when it couldn't be shown (nothing is recorded then). */
  send: () => boolean
  onError?: (err: unknown) => void
}

export type ReminderWorker = {
  start: () => void
  stop: () => void
  /** Run one check right away (e.g. after the computer wakes up); no-op while stopped. */
  checkNow: () => ReminderDecision | null
}

export function createReminderWorker(deps: ReminderWorkerDeps): ReminderWorker {
  let timer: unknown = null
  let running = false
  let ticking = false

  function check(): ReminderDecision | null {
    if (!running || ticking) return null
    ticking = true
    try {
      const now = deps.now()
      const prefs = deps.getPrefs()
      const decision = decideReminder({
        now,
        notificationsEnabled: prefs.notificationsEnabled,
        reminderEnabled: prefs.reminderEnabled,
        time: prefs.time,
        lastSentDate: deps.getLastSentDate(),
        readToday: () => deps.hasReadSince(startOfLocalDay(now)),
      })
      if (decision.send) {
        const today = localDateKey(now)
        const previous = deps.getLastSentDate()
        deps.setLastSentDate(today)
        // Couldn't show it: undo so a later tick inside the window can retry.
        if (!deps.send() && previous !== today) deps.setLastSentDate(previous)
      }
      return decision
    } catch (err) {
      deps.onError?.(err)
      return null
    } finally {
      ticking = false
    }
  }

  function scheduleNext(): void {
    if (!running) return
    timer = deps.setTimer(() => {
      timer = null
      check()
      scheduleNext()
    }, msUntilNextMinute(deps.now()))
  }

  return {
    start() {
      if (running) return
      running = true
      check()
      scheduleNext()
    },
    stop() {
      running = false
      if (timer !== null) deps.clearTimer(timer)
      timer = null
    },
    checkNow: () => check(),
  }
}
