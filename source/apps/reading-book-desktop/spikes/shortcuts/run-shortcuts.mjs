/**
 * Checks for Settings → Keyboard Shortcuts (customize + context-aware conflicts). Pure logic: the
 * key normalizer, validation, conflict detection and the zustand store; no DOM.
 *
 *   1. normalization    -> Ctrl on Windows/Linux and ⌘ on macOS both become `Mod`; modifier order / key case
 *   2. validation       -> modifier-only, plain keys, reserved system shortcuts are rejected; F keys allowed
 *   3. conflicts        -> same combo + overlapping context = conflict; same combo in contexts that never
 *                          coexist (Search Library vs Search in Book) = fine
 *   4. store            -> a conflict never overwrites / swaps / persists; valid keys persist
 *   5. reset            -> per shortcut and all; Reset App Settings group is registered
 *   6. loading          -> invalid / conflicting stored values are dropped
 *
 * Not covered here (needs the real renderer): Escape cancelling the recording chip, the hover /
 * conflict styling, and that the existing handlers still fire after customizing.
 *
 * Run: npm run spike:settings:shortcuts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => void storage.set(key, String(value)),
  removeItem: (key) => void storage.delete(key),
}

const defs = await import('../../src/shortcuts/shortcutDefinitions.ts')
const keys = await import('../../src/shortcuts/shortcutKeys.ts')
const conflicts = await import('../../src/shortcuts/shortcutConflicts.ts')
const { useShortcutsStore, effectiveShortcutKeys, SHORTCUTS_STORAGE_KEY } = await import(
  '../../src/shortcuts/shortcutsStore.ts'
)

let failures = 0
async function check(name, fn) {
  try {
    useShortcutsStore.getState().reset()
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL ${name}\n     ${error.message}`)
  }
}

const press = (code, mods = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})
const store = () => useShortcutsStore.getState()
const current = () => effectiveShortcutKeys(store().overrides)

await check('Ctrl (Windows/Linux) and ⌘ (macOS) both normalize to Mod', () => {
  assert.deepEqual(keys.shortcutKeysFromEvent(press('KeyO', { ctrlKey: true }), false), ['Mod', 'O'])
  assert.deepEqual(keys.shortcutKeysFromEvent(press('KeyO', { metaKey: true }), true), ['Mod', 'O'])
  assert.equal(keys.shortcutKeysFromEvent(press('KeyO', { metaKey: true }), false)?.[0], 'O') // ⌘ means nothing on Windows
})

await check('modifier order and key case do not create different shortcuts', () => {
  assert.equal(keys.shortcutKeysId(['Shift', 'Mod', 'o']), keys.shortcutKeysId(['Mod', 'Shift', 'O']))
  assert.deepEqual(keys.normalizeShortcutKeys(['Alt', 'Mod', 'a']), ['Mod', 'Alt', 'A'])
  assert.deepEqual(
    keys.shortcutKeysFromEvent(press('KeyO', { altKey: true, shiftKey: true, ctrlKey: true }), false),
    ['Mod', 'Alt', 'Shift', 'O'],
  )
})

await check('the physical key is used, so Alt/Shift do not change it', () => {
  assert.deepEqual(keys.shortcutKeysFromEvent(press('Comma', { ctrlKey: true }), false), ['Mod', ','])
  assert.deepEqual(keys.shortcutKeysFromEvent(press('ArrowLeft', { altKey: true }), false), ['Alt', 'ArrowLeft'])
  for (const code of ['PageUp', 'PageDown', 'Home', 'End', 'Enter', 'Space', 'F5', 'F12']) {
    assert.ok(keys.shortcutKeysFromEvent(press(code, { ctrlKey: true }), false), code)
  }
})

await check('modifier-only presses are not shortcuts', () => {
  for (const code of ['ControlLeft', 'ShiftRight', 'AltLeft', 'MetaLeft']) {
    assert.equal(keys.shortcutKeysFromEvent(press(code, { ctrlKey: true }), false), null)
  }
  assert.ok(keys.validateShortcutKeys(['Mod']))
  assert.ok(keys.validateShortcutKeys(['Mod', 'Shift']))
})

await check('plain keys, Shift-only and reserved system shortcuts are rejected; F keys are fine', () => {
  assert.ok(keys.validateShortcutKeys(['O']))
  assert.ok(keys.validateShortcutKeys(['Shift', 'O']))
  for (const reserved of [['Mod', 'C'], ['Mod', 'V'], ['Mod', 'X'], ['Mod', 'A'], ['Mod', 'W'], ['Mod', 'Q'], ['Alt', 'F4']]) {
    assert.ok(keys.validateShortcutKeys(reserved), reserved.join('+'))
  }
  assert.equal(keys.validateShortcutKeys(['F11']), null)
  assert.equal(keys.validateShortcutKeys(['Mod', 'Shift', 'O']), null)
})

await check('a free shortcut is accepted and persisted', () => {
  assert.deepEqual(store().tryAssign('general.openBook', ['Mod', 'Shift', 'O']), { ok: true })
  assert.deepEqual(current()['general.openBook'], ['Mod', 'Shift', 'O'])
  assert.deepEqual(JSON.parse(storage.get(SHORTCUTS_STORAGE_KEY)), { 'general.openBook': ['Mod', 'Shift', 'O'] })
})

await check('same shortcut in the same context is a conflict', () => {
  // Open Book is active on every screen, Search Library on the Library screen: they can both fire.
  const result = store().tryAssign('general.openBook', ['Mod', 'F'])
  assert.deepEqual(result, { ok: false, reason: 'conflict', conflictWith: 'general.searchLibrary' })
  assert.equal(
    conflicts.findShortcutConflict('general.backToLibrary', ['Mod', 'F'], current()),
    'general.searchBook', // both active in the Reader
  )
})

await check('same shortcut in contexts that never coexist is not a conflict', () => {
  const d = effectiveShortcutKeys({})
  assert.deepEqual(d['general.searchLibrary'], d['general.searchBook']) // default Mod+F twice
  assert.equal(conflicts.contextsOverlap('general.searchLibrary', 'general.searchBook'), false)
  assert.equal(conflicts.findShortcutConflict('general.searchBook', ['Mod', 'F'], d), null)
  // Library-only action takes the key of a Reader/Settings-only action.
  assert.deepEqual(store().tryAssign('general.searchLibrary', ['Alt', 'ArrowLeft']), { ok: true })
})

await check('conflict detection ignores key case and modifier order', () => {
  store().tryAssign('general.openBook', ['Mod', 'Shift', 'O'])
  assert.equal(
    conflicts.findShortcutConflict('general.openSettings', ['Shift', 'Mod', 'o'], current()),
    'general.openBook',
  )
})

await check('a conflict changes nothing: no overwrite, no swap, nothing saved', () => {
  store().tryAssign('general.openSettings', ['Mod', 'Shift', 'P'])
  const before = { stored: storage.get(SHORTCUTS_STORAGE_KEY), keys: JSON.stringify(current()) }
  const result = store().tryAssign('general.openBook', ['Mod', 'Shift', 'P'])
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.equal(storage.get(SHORTCUTS_STORAGE_KEY), before.stored)
  assert.equal(JSON.stringify(current()), before.keys)
  assert.deepEqual(current()['general.openBook'], ['Mod', 'O'])
  assert.deepEqual(current()['general.openSettings'], ['Mod', 'Shift', 'P'])
})

await check('an invalid shortcut is refused with a message and not saved', () => {
  const result = store().tryAssign('general.openBook', ['Mod'])
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid')
  assert.ok(result.message)
  assert.equal(storage.has(SHORTCUTS_STORAGE_KEY), false)
})

await check('assigning the default keys back removes the override', () => {
  store().tryAssign('general.openBook', ['Mod', 'Shift', 'O'])
  store().tryAssign('general.openBook', ['Mod', 'O'])
  assert.deepEqual(store().overrides, {})
  assert.equal(storage.has(SHORTCUTS_STORAGE_KEY), false)
})

await check('reset one shortcut leaves the others changed', () => {
  store().tryAssign('general.openBook', ['Mod', 'Shift', 'O'])
  store().tryAssign('general.openSettings', ['Mod', 'Shift', 'P'])
  store().resetOne('general.openBook')
  assert.deepEqual(current()['general.openBook'], ['Mod', 'O'])
  assert.deepEqual(current()['general.openSettings'], ['Mod', 'Shift', 'P'])
})

await check('reset to defaults restores everything and clears the stored key', () => {
  store().tryAssign('general.openBook', ['Mod', 'Shift', 'O'])
  store().tryAssign('general.openSettings', ['Mod', 'Shift', 'P'])
  store().setRecording('general.openBook')
  assert.equal(store().reset(), true)
  assert.deepEqual(store().overrides, {})
  assert.equal(store().recordingId, null)
  assert.equal(storage.has(SHORTCUTS_STORAGE_KEY), false)
  for (const s of defs.SHORTCUTS) assert.deepEqual(current()[s.id], s.defaultKeys)
})

await check('Reset App Settings includes Keyboard Shortcuts', () => {
  const source = readFileSync(new URL('../../src/screens/Settings/logic/resetAppSettings.ts', import.meta.url), 'utf8')
  assert.match(source, /id: 'keyboard-shortcuts'[\s\S]*useShortcutsStore\.getState\(\)\.reset\(\)/)
})

await check('stored overrides that are invalid or conflicting are dropped on load', async () => {
  storage.set(
    SHORTCUTS_STORAGE_KEY,
    JSON.stringify({
      'general.openBook': ['Mod', 'Shift', 'O'], // fine
      'general.openSettings': ['Mod', 'C'], // reserved
      'general.backToLibrary': ['Shift', 'Mod', 'o'], // same combo as Open Book, overlapping (settings)
      'general.nope': ['Mod', 'K'], // unknown action
    }),
  )
  const fresh = await import('../../src/shortcuts/shortcutsStore.ts?fresh')
  assert.deepEqual(fresh.useShortcutsStore.getState().overrides, { 'general.openBook': ['Mod', 'Shift', 'O'] })
})

await check('conflict logic lives in one place', () => {
  const root = new URL('../../src/', import.meta.url)
  for (const file of ['screens/Settings/components/keyboard/KeyboardShortcutsSettings.tsx', 'shortcuts/ShortcutsBridge.tsx']) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.doesNotMatch(source, /findShortcutConflict|contextsOverlap/, file)
  }
})

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
