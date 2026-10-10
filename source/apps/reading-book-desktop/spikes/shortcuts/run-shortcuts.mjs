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
 *   7. reader keys      -> bare keys only for `allowBare` actions; locked actions are fixed; aliases
 *                          (Page Down / Page Up) match at runtime and take part in conflict detection
 *   8. wiring (static)  -> Enter submits instead of stepping, End uses goToEnd, Add Bookmark has one
 *                          registration that calls the existing toggle once, guards are in the bridge
 *   9. view keys        -> Zoom In/Out/Reset + Toggle Fullscreen: defaults, rebinding, conflicts (incl.
 *                          aliases), restart persistence, reset, one dispatcher per key (no legacy listener)
 *
 * Not covered here (needs the real renderer): Escape cancelling the recording chip, the hover /
 * conflict styling, and that the existing handlers still fire after customizing.
 *
 * Run: npm run spike:settings:shortcuts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

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

const read = (file) => readFileSync(new URL(file, new URL('../../src/', import.meta.url)), 'utf8')

await check('reader defaults are valid and do not collide with each other', () => {
  for (const s of defs.SHORTCUTS) {
    if (s.displayOnly || s.locked) continue
    assert.equal(keys.validateShortcutKeys(s.defaultKeys, false, { allowBare: s.allowBare }), null, s.id)
  }
  const d = effectiveShortcutKeys({})
  for (const a of defs.SHORTCUTS) {
    for (const b of defs.SHORTCUTS) {
      if (a.id >= b.id || !conflicts.contextsOverlap(a.id, b.id)) continue
      const overlap = conflicts
        .shortcutComboIds(a, d)
        .filter((combo) => conflicts.shortcutComboIds(b, d).includes(combo))
      assert.deepEqual(overlap, [], `${a.id} vs ${b.id}`)
    }
  }
})

await check('a plain key is accepted only for actions that opt in (allowBare)', () => {
  assert.ok(keys.validateShortcutKeys(['T'], false)) // General actions: still rejected
  assert.equal(keys.validateShortcutKeys(['T'], false, { allowBare: true }), null)
  assert.equal(keys.validateShortcutKeys(['End'], false, { allowBare: true }), null)
  for (const unsafe of [['Enter'], ['Space'], ['Backspace'], ['Delete'], ['Tab'], ['Shift', 'T'], [',']]) {
    assert.ok(keys.validateShortcutKeys(unsafe, false, { allowBare: true }), unsafe.join('+'))
  }
  assert.deepEqual(store().tryAssign('navigation.toggleToc', ['G']), { ok: true })
  assert.equal(store().tryAssign('general.openBook', ['G']).reason, 'invalid')
})

await check('locked actions cannot be changed or loaded from storage', async () => {
  const result = store().tryAssign('search.nextResult', ['Mod', 'K'])
  assert.deepEqual([result.ok, result.reason], [false, 'invalid'])
  storage.set(SHORTCUTS_STORAGE_KEY, JSON.stringify({ 'search.previousResult': ['Mod', 'K'] }))
  const fresh = await import('../../src/shortcuts/shortcutsStore.ts?locked')
  assert.deepEqual(fresh.useShortcutsStore.getState().overrides, {})
})

await check('aliases match at runtime in the reader only; Esc stays with the existing handlers', () => {
  const d = effectiveShortcutKeys({})
  const matching = (event, context) =>
    defs.SHORTCUTS.filter(
      (s) =>
        !s.displayOnly &&
        s.contexts.includes(context) &&
        conflicts.shortcutComboIds(s, d).includes(keys.shortcutKeysId(keys.shortcutKeysFromEvent(event, false) ?? [])),
    ).map((s) => s.id)
  assert.deepEqual(matching(press('PageDown'), 'reader'), ['navigation.nextPage'])
  assert.deepEqual(matching(press('ArrowRight'), 'reader'), ['navigation.nextPage'])
  assert.deepEqual(matching(press('PageUp'), 'reader'), ['navigation.previousPage'])
  assert.deepEqual(matching(press('PageDown'), 'library'), [])
  assert.deepEqual(matching(press('Enter'), 'reader'), ['search.nextResult'])
  assert.deepEqual(matching(press('Enter', { shiftKey: true }), 'reader'), ['search.previousResult'])
  assert.deepEqual(matching(press('Escape'), 'reader'), [])
})

await check('aliases take part in conflict detection (and own aliases are refused)', () => {
  assert.equal(conflicts.findShortcutConflict('navigation.firstPage', ['PageDown'], current()), 'navigation.nextPage')
  assert.deepEqual(store().tryAssign('navigation.lastPage', ['PageUp']), {
    ok: false,
    reason: 'conflict',
    conflictWith: 'navigation.previousPage',
  })
  assert.deepEqual(store().tryAssign('navigation.nextPage', ['PageDown']), {
    ok: false,
    reason: 'conflict',
    conflictWith: 'navigation.nextPage',
  })
  assert.deepEqual(store().overrides, {})
})

await check('stored overrides that collide with an alias are dropped on load', async () => {
  storage.set(
    SHORTCUTS_STORAGE_KEY,
    JSON.stringify({ 'navigation.firstPage': ['PageDown'], 'navigation.lastPage': ['G'] }),
  )
  const fresh = await import('../../src/shortcuts/shortcutsStore.ts?alias')
  assert.deepEqual(fresh.useShortcutsStore.getState().overrides, { 'navigation.lastPage': ['G'] })
})

await check('handlers can decline: a false result leaves the key press alone', () => {
  assert.match(read('shortcuts/shortcutActions.ts'), /return handler\(\) !== false/)
  assert.match(read('shortcuts/ShortcutsBridge.tsx'), /if \(!perform\(match\.id\)\) continue/)
})

await check('bridge guards: typing field, modal, IME, repeat, iframes, aliases', () => {
  const bridge = read('shortcuts/ShortcutsBridge.tsx')
  for (const needle of [
    'isTypingTarget',
    'hasOpenModal',
    'isComposing',
    'allowRepeat',
    'listenKeydownInIframes',
    'shortcutComboIds',
  ]) {
    assert.ok(bridge.includes(needle), needle)
  }
})

await check('Enter outside the search box submits instead of blindly stepping; Shift+Enter steps back', () => {
  const source = read('screens/Reader/logic/hooks/useReaderShortcuts.ts')
  const next = /'search\.nextResult',[\s\S]*?enabled && searchOpen/.exec(source)?.[0] ?? ''
  assert.match(next, /\.submit\(\)/)
  assert.doesNotMatch(next, /\.next\(\)/)
  assert.match(source, /'search\.previousResult'[\s\S]*?\.previous\(\)/)
  // Inside the input the key never reaches the registry: the bridge skips typing targets.
  assert.match(read('shortcuts/iframeKeydown.ts'), /tag === 'INPUT'/)
})

await check('End of Book uses goToEnd, never the start of the last section', () => {
  const shortcuts = read('screens/Reader/logic/hooks/useReaderShortcuts.ts')
  assert.match(shortcuts, /'navigation\.lastPage'[\s\S]*?goToEnd\(\)/)
  assert.doesNotMatch(shortcuts, /goToSpineIndex/)
  assert.match(read('screens/Reader/logic/hooks/useReaderNavigation.ts'), /api\.goToEnd\(\)/)
  const epub = read('reader/renderers/epub/openEpubjs.ts')
  const goToEnd = /const goToEnd = async[\s\S]*?\r?\n  }\r?\n/.exec(epub)?.[0] ?? ''
  assert.match(goToEnd, /displayed\.total - 1\) \* delta/)
  assert.match(goToEnd, /scrollTop = container\.scrollHeight/)
})

await check('Add Bookmark has one registration that calls the existing toggle once', () => {
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name)) {
        if (/useShortcutAction\(\s*'navigation\.addBookmark'/.test(readFileSync(path, 'utf8'))) hits.push(entry.name)
      }
    }
  }
  walk(new URL('../../src/', import.meta.url))
  assert.deepEqual(hits, ['useReaderShortcuts.ts'])
  const source = read('screens/Reader/logic/hooks/useReaderShortcuts.ts')
  assert.equal(source.match(/toggleBookmark\(\)/g)?.length, 1)
})

const VIEW = ['view.zoomIn', 'view.zoomOut', 'view.resetZoom', 'view.toggleFullscreen']
const matchingIds = (event, context, overrides = {}) => {
  const effective = effectiveShortcutKeys(overrides)
  const pressed = keys.shortcutKeysFromEvent(event, false) ?? []
  return defs.SHORTCUTS.filter(
    (s) =>
      !s.displayOnly &&
      s.contexts.includes(context) &&
      conflicts.shortcutComboIds(s, effective).includes(keys.shortcutKeysId(pressed)),
  ).map((s) => s.id)
}

await check('View group lists the four actions with their default shortcuts', () => {
  assert.ok(defs.SHORTCUT_GROUPS.some((g) => g.id === 'view' && g.label === 'View'))
  const view = defs.SHORTCUTS.filter((s) => s.group === 'view')
  assert.deepEqual(view.map((s) => s.id), VIEW)
  const d = effectiveShortcutKeys({})
  assert.deepEqual(d['view.zoomIn'], ['Mod', '='])
  assert.deepEqual(d['view.zoomOut'], ['Mod', '-'])
  assert.deepEqual(d['view.resetZoom'], ['Mod', '0'])
  assert.deepEqual(d['view.toggleFullscreen'], ['F11'])
  assert.deepEqual(defs.getShortcut('view.toggleFullscreen').contexts, ['library', 'reader', 'settings'])
  for (const id of ['view.zoomIn', 'view.zoomOut', 'view.resetZoom']) {
    assert.deepEqual(defs.getShortcut(id).contexts, ['reader'], id)
    assert.equal(defs.getShortcut(id).ignoreInTextFields, true, id)
  }
})

await check('default keys match the physical keys the old handlers accepted', () => {
  assert.deepEqual(matchingIds(press('Equal', { ctrlKey: true }), 'reader'), ['view.zoomIn'])
  assert.deepEqual(matchingIds(press('NumpadAdd', { ctrlKey: true }), 'reader'), ['view.zoomIn'])
  assert.deepEqual(matchingIds(press('Equal', { ctrlKey: true, shiftKey: true }), 'reader'), ['view.zoomIn']) // Ctrl + "+"
  assert.deepEqual(matchingIds(press('Minus', { ctrlKey: true }), 'reader'), ['view.zoomOut'])
  assert.deepEqual(matchingIds(press('NumpadSubtract', { ctrlKey: true }), 'reader'), ['view.zoomOut'])
  assert.deepEqual(matchingIds(press('Minus', { ctrlKey: true, shiftKey: true }), 'reader'), ['view.zoomOut']) // Ctrl + "_"
  assert.deepEqual(matchingIds(press('Digit0', { ctrlKey: true }), 'reader'), ['view.resetZoom'])
  assert.deepEqual(matchingIds(press('Numpad0', { ctrlKey: true }), 'reader'), ['view.resetZoom'])
  for (const context of ['library', 'reader', 'settings']) {
    assert.deepEqual(matchingIds(press('F11'), context), ['view.toggleFullscreen'], context)
  }
  // Zoom is a Reader action; Alt variants never zoomed.
  assert.deepEqual(matchingIds(press('Equal', { ctrlKey: true }), 'library'), [])
  assert.deepEqual(matchingIds(press('Equal', { ctrlKey: true, altKey: true }), 'reader'), [])
})

await check('function keys are not "plain": they pass the typing / modal guard', () => {
  assert.equal(keys.isPlainShortcut(['F11']), false)
  assert.equal(keys.isPlainShortcut(['T']), true)
  assert.equal(keys.isPlainShortcut(['Shift', 'Enter']), true)
  assert.equal(keys.isPlainShortcut(['Mod', '=']), false)
})

await check('changing a View hotkey changes what fires; the old key stops', () => {
  assert.deepEqual(store().tryAssign('view.toggleFullscreen', ['Mod', 'Shift', 'F']), { ok: true })
  assert.deepEqual(matchingIds(press('KeyF', { ctrlKey: true, shiftKey: true }), 'reader', store().overrides), ['view.toggleFullscreen'])
  assert.deepEqual(matchingIds(press('F11'), 'reader', store().overrides), [])
  assert.deepEqual(store().tryAssign('view.zoomIn', ['Mod', 'Shift', 'K']), { ok: true })
  assert.deepEqual(matchingIds(press('Equal', { ctrlKey: true }), 'reader', store().overrides), [])
})

await check('View conflicts are context-aware and alias-aware', () => {
  assert.equal(store().tryAssign('view.zoomIn', ['Mod', '0']).conflictWith, 'view.resetZoom')
  assert.equal(store().tryAssign('view.zoomIn', ['Mod', 'G']).conflictWith, 'navigation.goToPage')
  assert.equal(store().tryAssign('view.zoomOut', ['Mod', 'Shift', '=']).conflictWith, 'view.zoomIn') // zoom-in alias
  assert.equal(store().tryAssign('view.zoomIn', ['Mod', 'Shift', '=']).conflictWith, 'view.zoomIn') // own alias
  // Toggle Fullscreen is active everywhere, so Ctrl+F (Search Library / Search in Book) is taken.
  assert.ok(store().tryAssign('view.toggleFullscreen', ['Mod', 'F']).conflictWith)
  // Zoom is Reader-only: a Library-only action may reuse its key.
  assert.deepEqual(store().tryAssign('general.searchLibrary', ['Mod', '=']), { ok: true })
  assert.deepEqual(store().overrides, { 'general.searchLibrary': ['Mod', '='] })
  // F11 is claimed in every context, and it is not rebindable to a typing key.
  assert.ok(store().tryAssign('navigation.toggleToc', ['F11']).conflictWith === 'view.toggleFullscreen')
})

await check('View shortcuts persist across a restart; reset one / all restores the defaults', async () => {
  store().tryAssign('view.zoomIn', ['Mod', 'Shift', 'K'])
  store().tryAssign('view.toggleFullscreen', ['F10'])
  const saved = JSON.parse(storage.get(SHORTCUTS_STORAGE_KEY))
  assert.deepEqual(saved, { 'view.zoomIn': ['Mod', 'Shift', 'K'], 'view.toggleFullscreen': ['F10'] })
  const fresh = await import('../../src/shortcuts/shortcutsStore.ts?view-restart')
  assert.deepEqual(fresh.useShortcutsStore.getState().overrides, saved)

  store().resetOne('view.zoomIn')
  assert.deepEqual(current()['view.zoomIn'], ['Mod', '='])
  assert.deepEqual(current()['view.toggleFullscreen'], ['F10'])

  store().tryAssign('view.zoomOut', ['Mod', 'Shift', 'J'])
  store().tryAssign('view.resetZoom', ['Mod', 'Shift', 'H'])
  assert.equal(store().reset(), true)
  for (const id of VIEW) assert.deepEqual(current()[id], defs.getShortcut(id).defaultKeys, id)
  assert.equal(storage.has(SHORTCUTS_STORAGE_KEY), false)
})

await check('each View key has exactly one dispatcher: no legacy listener, one registration', () => {
  const zoom = read('screens/Reader/logic/hooks/useReaderZoomControls.ts')
  assert.doesNotMatch(zoom, /addEventListener\('keydown'/)
  assert.doesNotMatch(zoom, /e\.key ===/)
  assert.match(zoom, /useShortcutAction\('view\.zoomIn', \(\) => handleZoomStep\(1\)\)/)
  assert.match(zoom, /useShortcutAction\('view\.zoomOut', \(\) => handleZoomStep\(-1\)\)/)
  assert.match(zoom, /useShortcutAction\('view\.resetZoom', \(\) => setViewZoomCentered\(ZOOM_DEFAULT\)\)/)

  // Main no longer toggles on F11 (it would toggle a second time); it keeps Esc → leave fullscreen.
  const main = readFileSync(new URL('../../electron/ipc/app.ipc.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /input\.key === 'F11'/)
  assert.match(main, /input\.key === 'Escape'/)

  const registrations = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8')
        for (const m of source.matchAll(/useShortcutAction\(\s*'(view\.[A-Za-z]+)'/g)) {
          registrations[m[1]] = [...(registrations[m[1]] ?? []), entry.name]
        }
      }
    }
  }
  walk(new URL('../../src/', import.meta.url))
  assert.deepEqual(registrations, {
    'view.zoomIn': ['useReaderZoomControls.ts'],
    'view.zoomOut': ['useReaderZoomControls.ts'],
    'view.resetZoom': ['useReaderZoomControls.ts'],
    'view.toggleFullscreen': ['ImmersiveReadingContext.tsx'],
  })
  // The fullscreen registration reuses the existing context callback (same one the footer button calls).
  assert.match(read('chrome/ImmersiveReadingContext.tsx'), /useShortcutAction\('view\.toggleFullscreen', toggleFullscreen\)/)
  // The bridge keeps zoom keys out of text fields, as the legacy listener did.
  assert.match(read('shortcuts/ShortcutsBridge.tsx'), /s\.ignoreInTextFields && isTypingTarget/)
})

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
