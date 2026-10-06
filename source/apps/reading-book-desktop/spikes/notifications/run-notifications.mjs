/**
 * Checks for Settings → Notifications (renderer store). Main's notifications:* IPC and the Web
 * Notification API are faked; Main is the source of truth for the prefs.
 *
 *   1. load / migration     -> Main's prefs mirrored; the old localStorage switch is moved to Main once
 *   2. enable, granted      -> optimistic ON + switch busy during the check, then Main saves ON
 *   3. enable, refused      -> OS unsupported / permission denied / check error → back to OFF, Main untouched
 *   4. save failures        -> Main couldn't write → its unchanged value is shown + error flag
 *   5. disable              -> Main saves OFF without any permission check
 *   6. reading reminders    -> enable / time saved by Main; failures revert
 *   7. races                -> clicks during a check are ignored; a reset during a check wins
 *   8. test reminder        -> sent / blocked / failed reported
 *
 * Run: npm run spike:settings:notifications
 */
import assert from 'node:assert/strict'

const LEGACY_KEY = 'reading-book.notifications.v1'
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const DEFAULTS = () => ({ enabled: false, reminder: { enabled: false, time: '20:00' } })

/** Fake Main (notifications:*). `writeOk: false` simulates an unwritable prefs file. */
const main = {
  prefs: DEFAULTS(),
  supported: true,
  supportFails: false,
  writeOk: true,
  gate: null,
  writes: [],
  testStatus: 'sent',
}
const answer = (apply) => {
  if (main.writeOk) apply()
  return { ok: main.writeOk, prefs: structuredClone(main.prefs) }
}
globalThis.window = {
  api: {
    notifications: {
      getSupport: async () => {
        if (main.gate) await main.gate
        if (main.supportFails) throw new Error('Main unreachable')
        return { supported: main.supported }
      },
      getPrefs: async () => structuredClone(main.prefs),
      setEnabled: async (enabled) => {
        main.writes.push({ enabled })
        return answer(() => (main.prefs.enabled = enabled))
      },
      setReminder: async (patch) => {
        main.writes.push({ reminder: patch })
        return answer(() => Object.assign(main.prefs.reminder, patch))
      },
      resetPrefs: async () => {
        main.writes.push('reset')
        return answer(() => (main.prefs = DEFAULTS()))
      },
      sendTestReminder: async () => ({ status: main.testStatus }),
      onOpenBook: () => () => {},
    },
  },
}

/** Fake Web Notification API (Electron routes it through the session permission handler). */
const web = { permission: 'default', answer: 'granted', requests: 0 }
class FakeNotification {
  static get permission() {
    return web.permission
  }
  static async requestPermission() {
    web.requests += 1
    web.permission = web.answer
    return web.answer
  }
}
globalThis.Notification = FakeNotification

const { useNotificationsStore } = await import('../../src/screens/Settings/logic/notificationsStore.ts')
const store = () => useNotificationsStore.getState()

async function fresh({ prefs = DEFAULTS(), supported = true, permission = 'default', answer: webAnswer = 'granted' } = {}) {
  Object.assign(main, { prefs, supported, supportFails: false, writeOk: true, gate: null, writes: [], testStatus: 'sent' })
  Object.assign(web, { permission, answer: webAnswer, requests: 0 })
  globalThis.Notification = FakeNotification
  storage.clear()
  useNotificationsStore.setState({ prefs: null, checking: false, blocked: null, saving: false, saveFailed: false, test: 'idle' })
  await store().load()
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Notifications')

// 1. Load / migration ---------------------------------------------------------

await check('load: mirrors Main (defaults: all off, reminder at 20:00)', async () => {
  await fresh()
  assert.deepEqual(store().prefs, DEFAULTS())
  assert.deepEqual(main.writes, [])
})

await check('migration: the old localStorage "enabled: true" is moved to Main once, then removed', async () => {
  await fresh()
  storage.set(LEGACY_KEY, JSON.stringify({ enabled: true }))
  await store().load()
  assert.equal(store().prefs.enabled, true)
  assert.equal(main.prefs.enabled, true)
  assert.ok(!storage.has(LEGACY_KEY))
  main.writes = []
  await store().load()
  assert.deepEqual(main.writes, [], 'nothing to migrate the second time')
})

await check('migration: an old "enabled: false" is just removed (Main untouched)', async () => {
  await fresh()
  storage.set(LEGACY_KEY, JSON.stringify({ enabled: false }))
  await store().load()
  assert.ok(!storage.has(LEGACY_KEY))
  assert.deepEqual(main.writes, [])
})

// 2. Enable, granted -----------------------------------------------------------

await check('enable, granted: optimistic ON + busy during the check, then Main saves ON', async () => {
  await fresh()
  let release
  main.gate = new Promise((resolve) => (release = resolve))
  const pending = store().setEnabled(true)
  assert.equal(store().prefs.enabled, true, 'switch answers the click immediately')
  assert.equal(store().checking, true, 'switch is disabled while checking')
  assert.deepEqual(main.writes, [], 'nothing saved before the check')
  release()
  await pending
  assert.equal(store().checking, false)
  assert.equal(main.prefs.enabled, true)
  assert.deepEqual(main.writes, [{ enabled: true }])
  assert.equal(web.requests, 1)
})

await check('enable when permission was already granted: no prompt', async () => {
  await fresh({ permission: 'granted' })
  await store().setEnabled(true)
  assert.equal(main.prefs.enabled, true)
  assert.equal(web.requests, 0)
})

// 3. Enable, refused ------------------------------------------------------------

for (const [label, setup, reason] of [
  ['OS unsupported', () => (main.supported = false), 'unsupported'],
  ['Web Notification API missing', () => (globalThis.Notification = undefined), 'unsupported'],
  ['permission prompt denied', () => (web.answer = 'denied'), 'denied'],
  ['permission already denied', () => (web.permission = 'denied'), 'denied'],
  ['check throws (Main unreachable)', () => (main.supportFails = true), 'error'],
]) {
  await check(`enable, ${label}: back to OFF, reason \`${reason}\`, Main untouched`, async () => {
    await fresh()
    setup()
    await store().setEnabled(true)
    assert.equal(store().prefs.enabled, false)
    assert.equal(store().blocked, reason)
    assert.equal(store().checking, false)
    assert.deepEqual(main.writes, [])
  })
}

await check('next toggle and Dismiss clear the warning', async () => {
  await fresh({ supported: false })
  await store().setEnabled(true)
  store().dismissBlocked()
  assert.equal(store().blocked, null)
  main.supported = true
  await store().setEnabled(true)
  assert.equal(store().blocked, null)
  assert.equal(main.prefs.enabled, true)
})

// 4. Save failures --------------------------------------------------------------

await check('Main can’t write the prefs: switch shows Main’s unchanged OFF + error flag', async () => {
  await fresh({ permission: 'granted' })
  main.writeOk = false
  await store().setEnabled(true)
  assert.equal(store().prefs.enabled, false)
  assert.equal(store().saveFailed, true)
})

// 5. Disable --------------------------------------------------------------------

await check('disable: Main saves OFF, no permission check', async () => {
  await fresh({ prefs: { enabled: true, reminder: { enabled: true, time: '20:00' } } })
  await store().setEnabled(false)
  assert.equal(main.prefs.enabled, false)
  assert.equal(web.requests, 0)
  assert.equal(main.prefs.reminder.enabled, true, 'reminder choice is kept (it just won’t fire)')
})

// 6. Reading reminders ------------------------------------------------------------

await check('reminder: enable + time are saved by Main', async () => {
  await fresh({ prefs: { enabled: true, reminder: { enabled: false, time: '20:00' } } })
  await store().setReminderEnabled(true)
  await store().setReminderTime('07:30')
  assert.deepEqual(main.prefs.reminder, { enabled: true, time: '07:30' })
  assert.deepEqual(store().prefs.reminder, { enabled: true, time: '07:30' })
  assert.deepEqual(main.writes, [{ reminder: { enabled: true } }, { reminder: { time: '07:30' } }])
  assert.equal(store().saving, false)
})

await check('reminder: Main rejects the write → previous value shown + error flag', async () => {
  await fresh({ prefs: { enabled: true, reminder: { enabled: true, time: '20:00' } } })
  main.writeOk = false
  await store().setReminderTime('06:00')
  assert.equal(store().prefs.reminder.time, '20:00')
  assert.equal(store().saveFailed, true)
})

// 7. Races --------------------------------------------------------------------------

await check('clicks during a running check are ignored', async () => {
  await fresh()
  let release
  main.gate = new Promise((resolve) => (release = resolve))
  const pending = store().setEnabled(true)
  await store().setEnabled(false)
  await store().setEnabled(true)
  release()
  await pending
  assert.deepEqual(main.writes, [{ enabled: true }])
})

await check('Reset App Settings during a check wins over the late answer', async () => {
  await fresh()
  let release
  main.gate = new Promise((resolve) => (release = resolve))
  const pending = store().setEnabled(true)
  assert.equal(await store().reset(), true)
  release()
  await pending
  assert.deepEqual(store().prefs, DEFAULTS())
  assert.equal(store().checking, false)
  assert.deepEqual(main.writes, ['reset'], 'the late permission answer never wrote ON')
})

// 8. Test reminder ----------------------------------------------------------------

await check('test reminder: sent / blocked / failed are reported', async () => {
  await fresh({ prefs: { enabled: true, reminder: { enabled: true, time: '20:00' } } })
  await store().sendTestReminder()
  assert.equal(store().test, 'sent')
  main.testStatus = 'blocked'
  await store().sendTestReminder()
  assert.equal(store().test, 'blocked')
  window.api.notifications.sendTestReminder = async () => {
    throw new Error('IPC failed')
  }
  await store().sendTestReminder()
  assert.equal(store().test, 'failed')
})

console.log(`\n${passed} checks passed.`)
