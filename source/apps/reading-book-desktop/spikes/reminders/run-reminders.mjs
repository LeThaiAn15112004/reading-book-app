/**
 * Checks for Reading Reminders (Main process; `electron` is the recording stub from spikes/background).
 * Runs with the process time zone forced to UTC+7, so local-vs-UTC mistakes show up as failures.
 *
 *   1. local time      -> dates / "today" / the reminder minute follow LOCAL wall-clock time, not UTC
 *   2. rules           -> on / off, before / at / within grace / after the window, once a day, read today
 *   3. SQLite          -> "read today" + "book in progress" on the real migrated schema (node:sqlite)
 *   4. worker          -> minute-aligned ticks (no setInterval drift), no overlap, retry, stop
 *   5. prefs           -> defaults 20:00 / off, time validation, atomic file, reset keeps lastSentDate apart
 *
 * Run: npm run spike:settings:reminders
 */
process.env.TZ = 'Asia/Ho_Chi_Minh' // UTC+7, no DST

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { stub } from '../background/electron-stub.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-reminders-'))
stub.userData = userData

const schedule = await import('../../electron/reminders/reminder-schedule.ts')
const activity = await import('../../electron/reminders/reading-activity.ts')
const { createReminderWorker } = await import('../../electron/reminders/reminder-worker.ts')
const prefsModule = await import('../../electron/notifications/notification-prefs.ts')
const settings = await import('../../electron/notifications/notification-settings.ts')
const { decideReminder, localDateKey, startOfLocalDay, msUntilNextMinute, reminderMessage, REMINDER_GRACE_MINUTES } =
  schedule

/** A LOCAL wall-clock moment (y, m 1-based, d, h, min, s). */
const local = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms)

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Reading Reminders (TZ = UTC+7)')

// 1. Local time -----------------------------------------------------------------

await check('the process really runs at UTC+7', () => {
  assert.equal(new Date('2026-10-05T23:30:00Z').getHours(), 6)
  assert.equal(new Date('2026-10-05T23:30:00Z').getTimezoneOffset(), -420)
})

await check('localDateKey uses the local date (00:30 local is still "yesterday" in UTC)', () => {
  const justAfterMidnight = local(2026, 10, 6, 0, 30)
  assert.equal(justAfterMidnight.toISOString().slice(0, 10), '2026-10-05', 'UTC date is the day before')
  assert.equal(localDateKey(justAfterMidnight), '2026-10-06')
  assert.equal(localDateKey(local(2026, 10, 6, 23, 59)), '2026-10-06')
})

await check('startOfLocalDay = local midnight (17:00 UTC the day before)', () => {
  assert.equal(startOfLocalDay(local(2026, 10, 6, 21, 15)).toISOString(), '2026-10-05T17:00:00.000Z')
})

await check('msUntilNextMinute lands just past the next :00', () => {
  assert.equal(msUntilNextMinute(local(2026, 10, 6, 19, 59, 30, 0)), 30_500)
  assert.equal(msUntilNextMinute(local(2026, 10, 6, 20, 0, 0, 900)), 59_600)
})

// 2. Rules ----------------------------------------------------------------------

const base = {
  notificationsEnabled: true,
  reminderEnabled: true,
  time: '20:00',
  lastSentDate: null,
  readToday: () => false,
}
const decide = (overrides) => decideReminder({ ...base, now: local(2026, 10, 6, 20, 0), ...overrides })

await check('sends at the reminder minute (local 20:00, i.e. 13:00 UTC)', () => {
  assert.deepEqual(decide({}), { send: true })
  // 20:00 UTC is 03:00 local the next day — must NOT be treated as reminder time.
  assert.equal(decide({ now: new Date('2026-10-06T20:00:00Z') }).send, false)
})

await check('respects both switches', () => {
  assert.deepEqual(decide({ notificationsEnabled: false }), { send: false, reason: 'notifications-off' })
  assert.deepEqual(decide({ reminderEnabled: false }), { send: false, reason: 'reminder-off' })
})

await check('before / within the grace window / after it', () => {
  assert.deepEqual(decide({ now: local(2026, 10, 6, 19, 59) }), { send: false, reason: 'not-time-yet' })
  assert.deepEqual(decide({ now: local(2026, 10, 6, 20, 37) }), { send: true }, 'missed minute (sleep) caught up')
  const last = local(2026, 10, 6, 20, REMINDER_GRACE_MINUTES - 1)
  assert.deepEqual(decide({ now: last }), { send: true })
  assert.deepEqual(decide({ now: local(2026, 10, 6, 21, 0) }), { send: false, reason: 'window-passed' })
})

await check('maximum 1 per day: already sent today → skip; sent yesterday → send', () => {
  assert.deepEqual(decide({ lastSentDate: '2026-10-06' }), { send: false, reason: 'already-sent-today' })
  assert.deepEqual(decide({ lastSentDate: '2026-10-05' }), { send: true })
})

await check('already read today → skip; the DB is only asked when everything else passed', () => {
  assert.deepEqual(decide({ readToday: () => true }), { send: false, reason: 'read-today' })
  let asked = 0
  decide({ now: local(2026, 10, 6, 9, 0), readToday: () => (asked += 1, false) })
  decide({ lastSentDate: '2026-10-06', readToday: () => (asked += 1, false) })
  assert.equal(asked, 0)
})

await check('malformed time never fires', () => {
  assert.equal(decide({ time: '8pm' }).send, false)
})

await check('message names the book in progress', () => {
  assert.deepEqual(reminderMessage('Dune'), { title: '📚 Time to read', body: 'Continue reading Dune?' })
  assert.equal(reminderMessage(null).title, '📚 Time to read')
})

// 3. SQLite (real schema) --------------------------------------------------------

const migrationsDir = path.join(__dirname, '../../electron/persistence/migrations')
const db = new DatabaseSync(':memory:')
// 021 builds an FTS5 index over book_chunks (node:sqlite ships without FTS5) and never touches `books`.
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.startsWith('021_')).sort()) {
  db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
}
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'epub', ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const addBook = (id, title, status, updatedAt) =>
  insertBook.run(id, title, `/${id}.epub`, `sha-${id}`, status, JSON.stringify(updatedAt ? { updatedAt, percent: 40 } : {}))

const today = local(2026, 10, 6, 20, 0)
const midnight = startOfLocalDay(today)

await check('"read today": nothing read yet / only yesterday → false', () => {
  addBook('never', 'Never opened', 'not-started', null)
  // 23:50 local yesterday = 16:50 UTC on 10-05.
  addBook('yesterday', 'Yesterday', 'reading', local(2026, 10, 5, 23, 50).toISOString())
  assert.equal(activity.hasReadSince(db, midnight), false)
})

await check('"read today": 00:10 local today (still 10-05 in UTC) counts as today', () => {
  addBook('early', 'Early bird', 'completed', local(2026, 10, 6, 0, 10).toISOString())
  assert.equal(local(2026, 10, 6, 0, 10).toISOString().slice(0, 10), '2026-10-05')
  assert.equal(activity.hasReadSince(db, midnight), true)
  db.prepare("DELETE FROM books WHERE id = 'early'").run()
})

await check('"read today": timestamps with an explicit offset are compared correctly (julianday)', () => {
  addBook('offset', 'Offset', 'reading', '2026-10-06T07:00:00+07:00') // = 00:00 UTC 10-06 = 07:00 local
  assert.equal(activity.hasReadSince(db, midnight), true)
  db.prepare("DELETE FROM books WHERE id = 'offset'").run()
  assert.equal(activity.hasReadSince(db, midnight), false)
})

await check('book in progress = most recently read "reading" book (completed ones ignored)', () => {
  addBook('older', 'Older read', 'reading', local(2026, 10, 1, 21, 0).toISOString())
  addBook('done', 'Finished', 'completed', local(2026, 10, 5, 23, 59).toISOString())
  assert.deepEqual(activity.lastBookInProgress(db), { bookId: 'yesterday', title: 'Yesterday' })
})

await check('no book in progress → null', () => {
  const empty = new DatabaseSync(':memory:')
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && !f.startsWith('021_')).sort()) {
    empty.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  assert.equal(activity.lastBookInProgress(empty), null)
  assert.equal(activity.hasReadSince(empty, midnight), false)
  empty.close()
})

// 4. Worker ----------------------------------------------------------------------

/** Fake clock + one-shot timers; `advance(ms)` fires due timers in order. */
function fakeTime(start) {
  let now = start.getTime()
  const timers = []
  let nextId = 1
  return {
    now: () => new Date(now),
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.push({ id, at: now + ms, fn })
      return id
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    pending: () => timers.length,
    /** Move the clock; `lateMs` simulates a timer firing late (busy event loop). */
    advance(ms, lateMs = 0) {
      const end = now + ms
      for (;;) {
        timers.sort((a, b) => a.at - b.at)
        const due = timers[0]
        if (!due || due.at > end) break
        timers.shift()
        // An overdue timer (clock jumped / computer slept) fires at the current time, never earlier.
        now = Math.max(now, due.at) + lateMs
        due.fn()
      }
      now = Math.max(now, end)
    },
    set: (date) => (now = date.getTime()),
  }
}

function makeWorker(clock, overrides = {}) {
  const log = { sent: [], tickTimes: [], lastSentDate: null, errors: [] }
  const deps = {
    now: clock.now,
    setTimer: (fn, ms) =>
      clock.setTimer(() => {
        log.tickTimes.push(clock.now())
        fn()
      }, ms),
    clearTimer: clock.clearTimer,
    getPrefs: () => ({ notificationsEnabled: true, reminderEnabled: true, time: '20:00' }),
    getLastSentDate: () => log.lastSentDate,
    setLastSentDate: (d) => (log.lastSentDate = d),
    hasReadSince: () => false,
    send: () => (log.sent.push(clock.now()), true),
    onError: (err) => log.errors.push(err),
    ...overrides,
  }
  return { worker: createReminderWorker(deps), log, deps }
}

await check('worker: ticks on each local minute boundary and sends exactly once at 20:00', () => {
  const clock = fakeTime(local(2026, 10, 6, 19, 58, 17))
  const { worker, log } = makeWorker(clock)
  worker.start()
  clock.advance(10 * 60_000)
  assert.equal(log.sent.length, 1)
  assert.equal(log.sent[0].getHours(), 20)
  assert.equal(log.sent[0].getMinutes(), 0)
  assert.equal(log.lastSentDate, '2026-10-06')
  for (const t of log.tickTimes) assert.equal(t.getSeconds(), 0, `tick at ${t.toTimeString()}`)
  assert.equal(clock.pending(), 1, 'exactly one timer pending (no pile-up)')
  worker.stop()
})

await check('worker: late timers don’t drift — the next tick re-aligns to :00', () => {
  const clock = fakeTime(local(2026, 10, 6, 10, 0, 0, 600))
  const { worker, log } = makeWorker(clock)
  worker.start()
  clock.advance(5 * 60_000, 3_000) // every timer fires 3 s late
  for (const t of log.tickTimes) assert.ok(t.getSeconds() <= 3, `tick drifted to ${t.toTimeString()}`)
  assert.equal(log.tickTimes.length, 5)
  worker.stop()
})

await check('worker: next day sends again; read today → no reminder', () => {
  const clock = fakeTime(local(2026, 10, 6, 19, 59, 50))
  let readToday = false
  const { worker, log } = makeWorker(clock, { hasReadSince: () => readToday })
  worker.start()
  clock.advance(60_000)
  assert.equal(log.sent.length, 1)
  clock.set(local(2026, 10, 7, 19, 59, 50))
  readToday = true
  clock.advance(5 * 60_000)
  assert.equal(log.sent.length, 1, 'already read on 10-07')
  clock.set(local(2026, 10, 8, 19, 59, 50))
  readToday = false
  clock.advance(60_000)
  assert.equal(log.sent.length, 2)
  assert.equal(log.lastSentDate, '2026-10-08')
  worker.stop()
})

await check('worker: lastSentDate is saved before showing; a failed show is undone and retried', () => {
  const clock = fakeTime(local(2026, 10, 6, 19, 59, 50))
  let attempts = 0
  const seen = []
  const { worker, log } = makeWorker(clock, {
    send: () => {
      seen.push(log.lastSentDate)
      attempts += 1
      return attempts > 1 // first attempt fails
    },
  })
  worker.start()
  clock.advance(3 * 60_000)
  assert.equal(attempts, 2)
  assert.deepEqual(seen, ['2026-10-06', '2026-10-06'], 'recorded before each show')
  assert.equal(log.lastSentDate, '2026-10-06')
  worker.stop()
})

await check('worker: a DB error is reported and the loop keeps going', () => {
  const clock = fakeTime(local(2026, 10, 6, 19, 59, 50))
  let fail = true
  const { worker, log } = makeWorker(clock, {
    hasReadSince: () => {
      if (fail) throw new Error('database is locked')
      return false
    },
  })
  worker.start()
  clock.advance(60_000)
  assert.equal(log.errors.length, 1)
  assert.equal(log.sent.length, 0)
  fail = false
  clock.advance(60_000)
  assert.equal(log.sent.length, 1)
  worker.stop()
})

await check('worker: no overlap — a check while one is running is skipped', () => {
  const clock = fakeTime(local(2026, 10, 6, 20, 0, 5))
  let inner = 'not called'
  let sends = 0
  const ref = {}
  const { worker } = makeWorker(clock, {
    send: () => {
      sends += 1
      inner = ref.worker.checkNow()
      return true
    },
  })
  ref.worker = worker
  worker.start()
  assert.equal(inner, null)
  assert.equal(sends, 1)
  worker.stop()
})

await check('worker: stop() clears the timer and checkNow is a no-op afterwards', () => {
  const clock = fakeTime(local(2026, 10, 6, 12, 0))
  const { worker } = makeWorker(clock)
  worker.start()
  assert.equal(clock.pending(), 1)
  worker.stop()
  assert.equal(clock.pending(), 0)
  assert.equal(worker.checkNow(), null)
})

await check('worker: switches are read live on every tick (turned on mid-evening)', () => {
  const clock = fakeTime(local(2026, 10, 6, 19, 59, 50))
  let on = false
  const { worker, log } = makeWorker(clock, {
    getPrefs: () => ({ notificationsEnabled: true, reminderEnabled: on, time: '20:00' }),
  })
  worker.start()
  clock.advance(2 * 60_000)
  assert.equal(log.sent.length, 0)
  on = true
  clock.advance(60_000)
  assert.equal(log.sent.length, 1, 'still inside the grace window')
  worker.stop()
})

// 5. Prefs ----------------------------------------------------------------------

const PREFS_FILE = path.join(userData, 'notification-prefs.json')

await check('prefs: defaults are off with the reminder at 20:00', () => {
  assert.deepEqual(prefsModule.DEFAULT_NOTIFICATION_PREFS, { enabled: false, reminder: { enabled: false, time: '20:00' } })
  settings.initNotificationSettings()
  assert.deepEqual(settings.getNotificationPrefs(), prefsModule.DEFAULT_NOTIFICATION_PREFS)
})

await check('prefs: time validation (24h HH:MM, padded)', () => {
  const n = prefsModule.normalizeReminderTime
  assert.equal(n('8:05'), '08:05')
  assert.equal(n('23:59'), '23:59')
  for (const bad of ['24:00', '20:60', '8pm', '', null, 2000]) assert.equal(n(bad), null, String(bad))
})

await check('prefs: saved atomically; an invalid time keeps the current one', () => {
  settings.setNotificationsEnabled(true)
  settings.updateReminderPrefs({ enabled: true, time: '7:30' })
  assert.deepEqual(JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')), { enabled: true, reminder: { enabled: true, time: '07:30' } })
  assert.ok(!fs.existsSync(`${PREFS_FILE}.tmp`))
  settings.updateReminderPrefs({ time: '25:99' })
  assert.equal(settings.getNotificationPrefs().reminder.time, '07:30')
})

await check('prefs: corrupt file → defaults; reload restores what was saved', () => {
  settings.initNotificationSettings()
  assert.equal(settings.getNotificationPrefs().reminder.time, '07:30')
  fs.writeFileSync(PREFS_FILE, '{oops')
  settings.initNotificationSettings()
  assert.deepEqual(settings.getNotificationPrefs(), prefsModule.DEFAULT_NOTIFICATION_PREFS)
})

await check('prefs: unwritable file → error to the caller, nothing changes', () => {
  settings.setNotificationsEnabled(true)
  const before = settings.getNotificationPrefs()
  stub.userData = path.join(userData, 'missing', 'dir')
  try {
    assert.throws(() => settings.updateReminderPrefs({ enabled: true }))
  } finally {
    stub.userData = userData
  }
  assert.deepEqual(settings.getNotificationPrefs(), before)
})

await check('prefs: Reset App Settings writes the defaults (lastSentDate lives in another file)', () => {
  fs.writeFileSync(path.join(userData, 'reading-reminder-state.json'), JSON.stringify({ lastSentDate: '2026-10-06' }))
  assert.deepEqual(settings.resetNotificationPrefs(), prefsModule.DEFAULT_NOTIFICATION_PREFS)
  assert.deepEqual(JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')), prefsModule.DEFAULT_NOTIFICATION_PREFS)
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(userData, 'reading-reminder-state.json'), 'utf8')).lastSentDate,
    '2026-10-06',
    'a reset can’t make today’s reminder fire twice',
  )
})

db.close()
fs.rmSync(userData, { recursive: true, force: true })
console.log(`\n${passed} checks passed.`)
