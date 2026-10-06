/**
 * Checks for Settings → Background & System Tray (Main process; `electron` is a recording stub).
 *
 *   1. prefs           -> defaults, validation, "no background without tray", atomic file write
 *   2. tray            -> created / removed with the switch, menu = Open / Quit, icon file exists
 *   3. close decision  -> close button hides only in background mode; quitting always closes
 *   4. quitting flag   -> tray Quit / quitApp() raise it before app.quit(); a hidden window then closes
 *   5. failures        -> unwritable prefs leave everything unchanged; a failed tray never hides
 *   6. start at login  -> OS login item with --hidden-at-startup; a login launch is recognised
 *
 * Run: npm run spike:settings:background
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stub } from './electron-stub.mjs'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-background-'))
stub.userData = userData
const PREFS_FILE = path.join(userData, 'background-prefs.json')

const prefsModule = await import('../../electron/background/background-prefs.ts')
const mode = await import('../../electron/background/background-mode.ts')
const { decideWindowClose, afterHideFlush } = await import('../../electron/background/close-decision.ts')
const loginItem = await import('../../electron/background/login-item.ts')
const { DEFAULT_BACKGROUND_PREFS, normalizeBackgroundPrefs } = prefsModule

let shown = 0
const init = () => mode.initBackgroundMode({ showWindow: () => (shown += 1), publicDir: PUBLIC_DIR })
const liveTrays = () => stub.trays.filter((t) => !t.destroyed)
const storedPrefs = () => JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'))

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Background & System Tray')

// 1. Prefs ------------------------------------------------------------------

await check('defaults: tray on, run in background off', () => {
  assert.deepEqual(DEFAULT_BACKGROUND_PREFS, { showTray: true, runInBackground: false })
})

await check('validation: garbage → defaults; run in background is forced off without the tray', () => {
  assert.deepEqual(normalizeBackgroundPrefs(null), DEFAULT_BACKGROUND_PREFS)
  assert.deepEqual(normalizeBackgroundPrefs({ showTray: 'yes', runInBackground: 1 }), DEFAULT_BACKGROUND_PREFS)
  assert.deepEqual(normalizeBackgroundPrefs({ showTray: false, runInBackground: true }), {
    showTray: false,
    runInBackground: false,
  })
  assert.deepEqual(normalizeBackgroundPrefs({ showTray: true, runInBackground: true }), {
    showTray: true,
    runInBackground: true,
  })
})

await check('first run (no file) and a corrupt file both load the defaults', () => {
  init()
  assert.deepEqual(mode.getBackgroundPrefs(), DEFAULT_BACKGROUND_PREFS)
  fs.writeFileSync(PREFS_FILE, '{broken')
  assert.deepEqual(prefsModule.loadBackgroundPrefs(), DEFAULT_BACKGROUND_PREFS)
  fs.rmSync(PREFS_FILE)
})

// 2. Tray -------------------------------------------------------------------

await check('tray: created on start with tooltip, icon and Open / Quit menu', () => {
  assert.equal(liveTrays().length, 1)
  const [tray] = liveTrays()
  assert.equal(tray.tooltip, 'Readmate Reader')
  assert.ok(!tray.image.isEmpty(), `tray icon missing: ${tray.image.file}`)
  const labels = tray.menu.items.map((item) => item.label ?? item.type)
  assert.deepEqual(labels, ['Open Readmate', 'separator', 'Quit Readmate'])
})

await check('tray: "Open Readmate" and a left click show the window', () => {
  const [tray] = liveTrays()
  const before = shown
  tray.menu.items[0].click()
  if (process.platform !== 'darwin') tray.handlers.click()
  assert.equal(shown, before + (process.platform !== 'darwin' ? 2 : 1))
})

await check('enable Run in Background: persisted atomically, close button now hides', () => {
  const result = mode.updateBackgroundPrefs({ runInBackground: true })
  assert.deepEqual(result, { showTray: true, runInBackground: true })
  assert.deepEqual(storedPrefs(), { showTray: true, runInBackground: true })
  assert.ok(!fs.existsSync(`${PREFS_FILE}.tmp`), 'no temp file left behind')
  assert.equal(mode.shouldHideOnClose(), true)
  assert.equal(liveTrays().length, 1, 'no second tray')
})

await check('turn the tray off: tray removed, run in background forced off, close quits again', () => {
  const result = mode.updateBackgroundPrefs({ showTray: false })
  assert.deepEqual(result, { showTray: false, runInBackground: false })
  assert.equal(liveTrays().length, 0)
  assert.equal(mode.shouldHideOnClose(), false)
  // Asking for background mode without the tray is refused by validation.
  assert.deepEqual(mode.updateBackgroundPrefs({ runInBackground: true }), {
    showTray: false,
    runInBackground: false,
  })
})

await check('prefs survive a restart (reloaded from the file)', () => {
  mode.updateBackgroundPrefs({ showTray: true, runInBackground: true })
  init()
  assert.deepEqual(mode.getBackgroundPrefs(), { showTray: true, runInBackground: true })
  assert.equal(liveTrays().length, 1)
})

// 5. Failures ----------------------------------------------------------------

await check('unwritable prefs file: error reaches the caller, nothing changes', () => {
  const before = mode.getBackgroundPrefs()
  stub.userData = path.join(userData, 'missing', 'dir')
  try {
    assert.throws(() => mode.updateBackgroundPrefs({ showTray: false }))
  } finally {
    stub.userData = userData
  }
  assert.deepEqual(mode.getBackgroundPrefs(), before)
  assert.equal(liveTrays().length, 1, 'tray kept')
})

await check('tray creation fails: the close button never hides (no way back otherwise)', () => {
  mode.updateBackgroundPrefs({ showTray: false })
  stub.failTray = true
  try {
    mode.updateBackgroundPrefs({ showTray: true, runInBackground: true })
    assert.deepEqual(mode.getBackgroundPrefs(), { showTray: true, runInBackground: true })
    assert.equal(liveTrays().length, 0)
    assert.equal(mode.shouldHideOnClose(), false)
  } finally {
    stub.failTray = false
  }
  // Next change retries the tray.
  mode.updateBackgroundPrefs({ runInBackground: true })
  assert.equal(liveTrays().length, 1)
  assert.equal(mode.shouldHideOnClose(), true)
})

await check('Reset App Settings: defaults written, tray kept, close quits again', () => {
  const result = mode.resetBackgroundPrefs()
  assert.deepEqual(result, DEFAULT_BACKGROUND_PREFS)
  assert.deepEqual(storedPrefs(), DEFAULT_BACKGROUND_PREFS)
  assert.equal(liveTrays().length, 1)
  assert.equal(mode.shouldHideOnClose(), false)
  mode.updateBackgroundPrefs({ runInBackground: true })
})

// 6. Start at Login ----------------------------------------------------------

await check('start at login (Windows): registers exe + --hidden-at-startup, read back from the OS', () => {
  if (process.platform !== 'win32') return
  assert.deepEqual(loginItem.getStartAtLogin(), { supported: true, enabled: false })
  assert.deepEqual(loginItem.setStartAtLogin(true), { supported: true, enabled: true })
  const call = stub.loginCalls.at(-1)
  assert.equal(call.openAtLogin, true)
  assert.equal(call.path, process.execPath)
  assert.ok(call.args.includes(loginItem.HIDDEN_AT_STARTUP_ARG))
  assert.deepEqual(loginItem.setStartAtLogin(false), { supported: true, enabled: false })
  assert.equal(stub.loginItem, null)
})

await check('a login launch is recognised by its argument; a normal launch is not', () => {
  assert.equal(loginItem.wasLaunchedAtLogin(['electron.exe', '.', '--hidden-at-startup']), true)
  assert.equal(loginItem.wasLaunchedAtLogin(['electron.exe', '.']), false)
})

// 3. Close decision -----------------------------------------------------------

await check('close decision table', () => {
  const d = (flushing, sessionFlushed, hideOnClose) => decideWindowClose({ flushing, sessionFlushed, hideOnClose })
  assert.equal(d(false, false, false), 'flush-then-close', 'normal close saves the session first')
  assert.equal(d(false, true, false), 'close', 'second pass after the flush closes')
  assert.equal(d(false, false, true), 'flush-then-hide', 'background mode hides')
  assert.equal(d(false, true, true), 'flush-then-hide', 'hides again after being reopened')
  assert.equal(d(true, false, false), 'close', 'a close during a flush is not blocked')
  assert.equal(d(true, false, true), 'close', 'a close during a flush is not blocked (background)')
  assert.equal(afterHideFlush(false), 'hide')
  assert.equal(afterHideFlush(true), 'close-and-quit', 'a quit during the save is not swallowed')
})

/**
 * Minimal model of main.ts: one window, `close` runs decideWindowClose; flushes finish instantly.
 * `app.quit()` → before-quit (markQuitting) → close; the quit only completes when the window closed.
 */
function simulateWindow() {
  const w = { open: true, visible: true, sessionFlushed: false, flushing: false }
  function close() {
    if (!w.open) return
    const decision = decideWindowClose({
      flushing: w.flushing,
      sessionFlushed: w.sessionFlushed,
      hideOnClose: mode.shouldHideOnClose(),
    })
    if (decision === 'close') {
      w.open = false
      return
    }
    w.flushing = true // flush-then-* : cancelled, renderer saves…
    w.flushing = false
    if (decision === 'flush-then-hide') {
      if (afterHideFlush(mode.isQuitting()) === 'hide') {
        w.visible = false
        return
      }
    }
    w.sessionFlushed = true
    close()
  }
  return { w, close }
}

// 4. Quitting flag (last: it is one-way for the process) ----------------------

await check('close button in background mode hides; the app keeps running', () => {
  assert.equal(mode.shouldHideOnClose(), true)
  const { w, close } = simulateWindow()
  close()
  assert.deepEqual({ open: w.open, visible: w.visible }, { open: true, visible: false })
  close() // reopened from the tray and closed again → hides again
  assert.deepEqual({ open: w.open, visible: w.visible }, { open: true, visible: false })
  assert.equal(stub.quitCalls, 0)
})

await check('tray "Quit Readmate": flag first, then app.quit(); the hidden window then closes', () => {
  const { w, close } = simulateWindow()
  close()
  assert.equal(w.visible, false)
  const quitsBefore = stub.quitCalls
  const [tray] = liveTrays()
  tray.menu.items[2].click()
  assert.equal(mode.isQuitting(), true)
  assert.equal(stub.quitCalls, quitsBefore + 1)
  assert.equal(mode.shouldHideOnClose(), false, 'quitting overrides Run in Background')
  close() // app.quit() closes every window
  assert.equal(w.open, false, 'window closed → the quit completes')
})

await check('while quitting, prefs changes can’t turn hiding back on', () => {
  mode.updateBackgroundPrefs({ showTray: true, runInBackground: true })
  assert.equal(mode.shouldHideOnClose(), false)
})

fs.rmSync(userData, { recursive: true, force: true })
console.log(`\n${passed} checks passed.`)
