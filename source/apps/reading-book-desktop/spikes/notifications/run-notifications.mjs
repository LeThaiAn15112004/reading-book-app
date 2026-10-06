/**
 * Checks for Settings → Notifications → "Enable Notifications" (renderer store + permission flow;
 * Main's `notifications:getSupport` and the Web Notification API are faked).
 *
 *   1. defaults / load      -> OFF on first run and for corrupt storage; persisted value reloads
 *   2. enable, granted      -> optimistic ON + switch busy during the check, then persisted ON
 *   3. enable, refused      -> OS unsupported / permission denied / check error → back to OFF + reason
 *   4. disable              -> OFF persisted without any OS / IPC call
 *   5. races                -> clicks during a check are ignored; a reset during a check wins
 *
 * Run: npm run spike:settings:notifications
 */
import assert from 'node:assert/strict'

const KEY = 'reading-book.notifications.v1'
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

/** Fake Main: `notifications:getSupport`. */
const main = { supported: true, fail: false, calls: 0, gate: null }
globalThis.window = {
  api: {
    notifications: {
      getSupport: async () => {
        main.calls += 1
        if (main.gate) await main.gate
        if (main.fail) throw new Error('Main unreachable')
        return { supported: main.supported }
      },
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

storage.set(KEY, '{not json')
const { DEFAULT_NOTIFICATION_PREFS, useNotificationsStore } = await import(
  '../../src/screens/Settings/logic/notificationsStore.ts'
)

const store = () => useNotificationsStore.getState()
const stored = () => JSON.parse(storage.get(KEY))

function fresh({ supported = true, fail = false, permission = 'default', answer = 'granted' } = {}) {
  Object.assign(main, { supported, fail, calls: 0, gate: null })
  Object.assign(web, { permission, answer, requests: 0 })
  globalThis.Notification = FakeNotification
  useNotificationsStore.setState({ notifications: { enabled: false }, checking: false, blocked: null })
  storage.set(KEY, JSON.stringify({ enabled: false }))
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Notifications')

await check('defaults: OFF on first run, corrupt storage falls back to the default', () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFS, { enabled: false })
  assert.deepEqual(store().notifications, { enabled: false })
  assert.equal(store().checking, false)
  assert.equal(store().blocked, null)
})

await check('enable, granted: optimistic ON + busy during the check, then persisted ON', async () => {
  fresh()
  let release
  main.gate = new Promise((resolve) => (release = resolve))
  const pending = store().setEnabled(true)
  assert.deepEqual(store().notifications, { enabled: true }, 'switch answers the click immediately')
  assert.equal(store().checking, true, 'switch is disabled while checking')
  assert.deepEqual(stored(), { enabled: false }, 'nothing persisted before the check')
  release()
  await pending
  assert.deepEqual(store().notifications, { enabled: true })
  assert.equal(store().checking, false)
  assert.equal(store().blocked, null)
  assert.deepEqual(stored(), { enabled: true })
  assert.equal(main.calls, 1)
  assert.equal(web.requests, 1, 'permission requested when still `default`')
})

await check('enable when permission was already granted: no prompt', async () => {
  fresh({ permission: 'granted' })
  await store().setEnabled(true)
  assert.deepEqual(stored(), { enabled: true })
  assert.equal(web.requests, 0)
})

await check('enable, OS unsupported: back to OFF, reason `unsupported`, no permission prompt', async () => {
  fresh({ supported: false })
  await store().setEnabled(true)
  assert.deepEqual(store().notifications, { enabled: false })
  assert.equal(store().blocked, 'unsupported')
  assert.equal(store().checking, false)
  assert.deepEqual(stored(), { enabled: false })
  assert.equal(web.requests, 0)
})

await check('enable, Web Notification API missing: treated as unsupported', async () => {
  fresh()
  globalThis.Notification = undefined
  await store().setEnabled(true)
  assert.equal(store().blocked, 'unsupported')
  assert.deepEqual(store().notifications, { enabled: false })
})

await check('enable, permission prompt denied: back to OFF, reason `denied`', async () => {
  fresh({ answer: 'denied' })
  await store().setEnabled(true)
  assert.deepEqual(store().notifications, { enabled: false })
  assert.equal(store().blocked, 'denied')
  assert.deepEqual(stored(), { enabled: false })
})

await check('enable, permission already denied: no prompt, reason `denied`', async () => {
  fresh({ permission: 'denied' })
  await store().setEnabled(true)
  assert.equal(store().blocked, 'denied')
  assert.equal(web.requests, 0)
})

await check('enable, check throws (Main unreachable): back to OFF, reason `error`', async () => {
  fresh({ fail: true })
  await store().setEnabled(true)
  assert.deepEqual(store().notifications, { enabled: false })
  assert.equal(store().blocked, 'error')
  assert.equal(store().checking, false)
})

await check('next toggle and Dismiss clear the warning', async () => {
  fresh({ supported: false })
  await store().setEnabled(true)
  store().dismissBlocked()
  assert.equal(store().blocked, null)
  await store().setEnabled(true)
  assert.equal(store().blocked, 'unsupported')
  main.supported = true
  await store().setEnabled(true)
  assert.equal(store().blocked, null)
  assert.deepEqual(stored(), { enabled: true })
})

await check('disable: OFF persisted, no OS / IPC call', async () => {
  fresh({ permission: 'granted' })
  await store().setEnabled(true)
  main.calls = 0
  await store().setEnabled(false)
  assert.deepEqual(store().notifications, { enabled: false })
  assert.deepEqual(stored(), { enabled: false })
  assert.equal(main.calls, 0)
})

await check('clicks during a running check are ignored', async () => {
  fresh()
  let release
  main.gate = new Promise((resolve) => (release = resolve))
  const pending = store().setEnabled(true)
  await store().setEnabled(false)
  await store().setEnabled(true)
  assert.equal(main.calls, 1)
  release()
  await pending
  assert.deepEqual(stored(), { enabled: true })
})

await check('Reset App Settings during a check wins over the late answer', async () => {
  fresh()
  let release
  main.gate = new Promise((resolve) => (release = resolve))
  const pending = store().setEnabled(true)
  assert.equal(store().reset(), true)
  release()
  await pending
  assert.deepEqual(store().notifications, DEFAULT_NOTIFICATION_PREFS)
  assert.equal(store().checking, false)
  assert.deepEqual(stored(), DEFAULT_NOTIFICATION_PREFS)
})

console.log(`\n${passed} checks passed.`)
