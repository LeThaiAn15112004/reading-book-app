/**
 * Spec 018 (US5, contracts/mini-player-ipc.md): the audiobook mini player's rules in Main, plus static wiring checks.
 *
 *   1. state validation   -> a malformed snapshot is dropped whole; lengths / cover scheme / enums enforced
 *   2. command validation -> only the contract's commands; seek needs a finite, non-negative position
 *   3. auto-open / close  -> minimise / hide opens only with a session, auto-open on, not closed by the user; showing
 *                            the window closes only a window that opened by itself; a new book resets "closed by user"
 *   4. prefs + position   -> defaults; off-screen point moved onto the nearest display; fits → kept
 *   5. tray entry         -> only title / play state (no rebuild per position tick)
 *   6. wiring (static)    -> preload exposes ONLY window.miniPlayerWindow in the floating window; floating-window
 *                            channels refused from other senders; main.ts hooks; mini player never outlives the window
 *
 * Run: npm run spike:audio:mini-player
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rules = await import('../../mini-player/mini-player-rules.ts')

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}\n     ${error.message}`)
  }
}
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const GOOD = {
  bookId: 'b1',
  title: 'A book',
  subtitle: 'Chapter 1',
  author: 'Someone',
  coverUrl: 'rb-cover://b1',
  playing: true,
  status: 'ready',
  positionSeconds: 12,
  durationSeconds: 3600,
  skipBackSeconds: 15,
  skipForwardSeconds: 30,
  canPrevious: true,
  canNext: false,
  theme: 'paper',
  uiLanguage: 'vi',
}

await check('state: a good snapshot passes unchanged; null = no session', () => {
  assert.deepEqual(rules.validateMiniPlayerState(GOOD), GOOD)
  assert.equal(rules.validateMiniPlayerState(null), null)
  assert.deepEqual(rules.validateMiniPlayerState({ ...GOOD, subtitle: null, author: null, coverUrl: null, durationSeconds: null }), {
    ...GOOD,
    subtitle: null,
    author: null,
    coverUrl: null,
    durationSeconds: null,
  })
})

await check('state: anything malformed is dropped whole', () => {
  for (const bad of [
    { ...GOOD, title: 'x'.repeat(501) },
    { ...GOOD, coverUrl: 'file:///C:/secret.jpg' },
    { ...GOOD, status: 'playing' },
    { ...GOOD, theme: 'blue' },
    { ...GOOD, positionSeconds: -1 },
    { ...GOOD, positionSeconds: Number.NaN },
    { ...GOOD, bookId: '' },
    { ...GOOD, playing: 'yes' },
    'state',
    42,
  ]) {
    assert.equal(rules.validateMiniPlayerState(bad), undefined, JSON.stringify(bad).slice(0, 60))
  }
})

await check('commands: only the contract, seek needs a finite position', () => {
  for (const type of ['toggle', 'play', 'pause', 'skipBack', 'skipForward', 'previous', 'next', 'retryTrack', 'openPlayer', 'endSession']) {
    assert.deepEqual(rules.validateMiniPlayerCommand({ type }), { type })
  }
  assert.deepEqual(rules.validateMiniPlayerCommand({ type: 'seek', positionSeconds: 5 }), { type: 'seek', positionSeconds: 5 })
  assert.equal(rules.validateMiniPlayerCommand({ type: 'seek', positionSeconds: -2 }), null)
  assert.equal(rules.validateMiniPlayerCommand({ type: 'seek' }), null)
  assert.equal(rules.validateMiniPlayerCommand({ type: 'deleteBook' }), null)
  assert.equal(rules.validateMiniPlayerCommand(null), null)
})

await check('auto-open: only with a session, auto-open on, not closed by the user, not already open', () => {
  const on = { autoOpen: true }
  const base = { ...rules.INITIAL_FLAGS, sessionActive: true }
  assert.equal(rules.shouldAutoOpen(base, on), true)
  assert.equal(rules.shouldAutoOpen({ ...base, sessionActive: false }, on), false)
  assert.equal(rules.shouldAutoOpen(base, { autoOpen: false }), false)
  assert.equal(rules.shouldAutoOpen({ ...base, closedByUserThisSession: true }, on), false)
  assert.equal(rules.shouldAutoOpen({ ...base, windowOpen: true }, on), false)
})

await check('auto-close: only a window that opened by itself', () => {
  assert.equal(rules.shouldAutoClose({ ...rules.INITIAL_FLAGS, windowOpen: true, openedAutomatically: true }), true)
  assert.equal(rules.shouldAutoClose({ ...rules.INITIAL_FLAGS, windowOpen: true, openedAutomatically: false }), false)
  assert.equal(rules.shouldAutoClose(rules.INITIAL_FLAGS), false)
})

await check('session flags: a new book (or no session) resets "closed by the user"; the same book keeps it', () => {
  const closed = { ...rules.INITIAL_FLAGS, sessionActive: true, closedByUserThisSession: true }
  assert.equal(rules.flagsForState(closed, 'b1', GOOD).closedByUserThisSession, true)
  assert.equal(rules.flagsForState(closed, 'b0', GOOD).closedByUserThisSession, false)
  const ended = rules.flagsForState(closed, 'b1', null)
  assert.deepEqual([ended.sessionActive, ended.closedByUserThisSession], [false, false])
})

await check('prefs: defaults and normalisation', () => {
  assert.deepEqual(rules.normalizeMiniPlayerPrefs(undefined), { autoOpen: true, x: null, y: null })
  assert.deepEqual(rules.normalizeMiniPlayerPrefs({ autoOpen: false, x: 10.4, y: 'a' }), { autoOpen: false, x: 10, y: null })
})

await check('position: kept when it fits, else moved onto the nearest display, default bottom-right', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }
  const second = { x: 1920, y: 0, width: 1280, height: 1000 }
  assert.deepEqual(rules.visiblePosition({ x: null, y: null }, [primary], primary), { x: 1920 - 360 - 24, y: 1040 - 132 - 24 })
  assert.deepEqual(rules.visiblePosition({ x: 100, y: 100 }, [primary, second], primary), { x: 100, y: 100 })
  assert.deepEqual(rules.visiblePosition({ x: 2500, y: 300 }, [primary, second], primary), { x: 2500, y: 300 })
  // The second monitor was disconnected: the point moves onto the primary display, fully visible.
  assert.deepEqual(rules.visiblePosition({ x: 2500, y: 300 }, [primary], primary), { x: 1920 - 360, y: 300 })
  assert.deepEqual(rules.visiblePosition({ x: -800, y: -50 }, [primary], primary), { x: 0, y: 0 })
})

await check('tray entry: only title and play state', () => {
  assert.equal(rules.trayEntryFor(null), null)
  assert.deepEqual(rules.trayEntryFor(GOOD), { title: 'A book', playing: true })
  assert.deepEqual(rules.trayEntryFor({ ...GOOD, positionSeconds: 99 }), rules.trayEntryFor(GOOD))
})

await check('wiring (static): preload, IPC sender checks, main window hooks, quit safety', () => {
  const preload = read('preload.ts')
  assert.match(preload, /process\.argv\.includes\(MINI_PLAYER_WINDOW_ARG\)/)
  assert.match(preload, /exposeInMainWorld\('miniPlayerWindow', miniPlayerWindow\)\n\} else \{\n {2}contextBridge\.exposeInMainWorld\('api', api\)/)
  const ipc = read('ipc/mini-player.ipc.ts')
  for (const channel of ['windowCommand', 'returnToApp', 'closeWindow', 'minimizeWindow']) {
    assert.match(ipc, new RegExp(`MiniPlayerChannels\\.${channel}, \\(event[^)]*\\) => \\{\\n {4}if \\(!?fromFloatingWindow\\(event\\.sender\\)\\)`), channel)
  }
  assert.match(ipc, /publishState, \(event, input: unknown\) => \{\n {4}if \(fromFloatingWindow\(event\.sender\)\) return/)
  const main = read('main.ts')
  for (const hook of ["win.on('minimize', () => onMainWindowHidden())", "win.on('hide', () => onMainWindowHidden())", "win.on('restore', () => onMainWindowShown())", "win.on('show', () => onMainWindowShown())"]) {
    assert.ok(main.includes(hook), hook)
  }
  assert.match(main, /win\.on\('closed', \(\) => \{[\s\S]*?closeMiniPlayerWindow\(\)/)
  assert.match(main, /markQuitting\(\)\n {2}closeMiniPlayerWindow\(\)\n\}\)/)
  const windowFile = read('mini-player/mini-player-window.ts')
  assert.match(windowFile, /alwaysOnTop: true/)
  assert.match(windowFile, /sandbox: true/)
  assert.match(windowFile, /additionalArguments: \['--readmate-window=mini-player'\]/)
  // The floating window's UI reaches Main only through the platform adapter, and main.tsx mounts its own root.
  const app = read('../../main.tsx')
  assert.match(app, /floatingMiniPlayer \? <MiniPlayerWindowRoot \/> : <App \/>/)
  assert.doesNotMatch(read('../../screens/MiniPlayerWindow/MiniPlayerWindow.tsx'), /window\.miniPlayerWindow|window\.api/)
})

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
