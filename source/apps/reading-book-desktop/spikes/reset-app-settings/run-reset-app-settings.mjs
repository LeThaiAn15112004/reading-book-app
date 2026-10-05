/**
 * Checks for Settings → Advanced → Reset App Settings (renderer-only; app preferences live in
 * localStorage, see docs/implementation_plan/reset_app_settings.md).
 *
 *   1. defaults               -> the single source of truth holds the documented values
 *   2. each group on its own  -> Appearance / Library reset only their own key + store state
 *   3. full reset             -> every group back to defaults, written (not removed), UI attrs applied
 *   4. out-of-scope state     -> per-book / global reading defaults / history / layout keys untouched,
 *                                and the reset never reaches `window.api` (IPC → SQLite / files)
 *   5. cancel                 -> nothing changes unless the reset actually runs
 *   6. errors                 -> failed writes and throwing groups are reported, others still reset
 *
 * Run: npm run spike:settings:reset
 */
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// Browser globals the stores touch at import time
// ---------------------------------------------------------------------------

const storage = new Map()
let failWrites = false
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => {
    if (failWrites) throw new Error('QuotaExceededError')
    storage.set(key, String(value))
  },
  removeItem: (key) => storage.delete(key),
  clear: () => {
    throw new Error('localStorage.clear() must never be used by Reset App Settings')
  },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
globalThis.document = { documentElement: { dataset: {}, lang: '' } }
const ipcCalls = []
globalThis.window = {
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  // Any IPC access (library, overlay, storage…) would mean the reset reached user data.
  api: new Proxy({}, { get: (_t, prop) => (ipcCalls.push(String(prop)), () => Promise.reject(new Error('no IPC'))) }),
}

const KEYS = {
  appearance: 'reading-book.app-appearance.v1',
  library: 'reading-book.library.browse-prefs.v1',
  globalReadingPrefs: 'readmate.globalReadingPrefs.v1',
}

/** App state that must survive a reset byte-for-byte. */
const OUT_OF_SCOPE = {
  // Global reading defaults (resolve every book without overrides) — only `theme` follows Appearance,
  // and that is patched by AppAppearanceBridge in React, never by the reset itself.
  [KEYS.globalReadingPrefs]: JSON.stringify({
    theme: 'paper', fontFamily: 'sans', fontSize: 24, fontWeight: 600, lineHeight: 2,
    textAlign: 'left', layout: 'dual', viewMode: 'scroll', marginEnabled: false, margin: 'wide',
  }),
  'reading-book.library.search-history.v1': JSON.stringify({ enabled: true, entries: ['dune', 'tolkien'] }),
  'reading-book.readAloud.prefs': JSON.stringify({ rate: 1.5, volume: 0.4 }),
  'reading-book.translation.prefs': JSON.stringify({ targetLang: 'ja', recentTargets: ['ja', 'fr'] }),
  'reading-book.sidebarPanelWidth': '360',
  'reading-book.rightSidebarPanelWidth': '300',
  'reading-book.searchPanelPosition': JSON.stringify({ x: 10, y: 20 }),
  'reading-book.searchPanelSize': JSON.stringify({ width: 400, height: 500 }),
  'reading-book.translationPanelPosition': JSON.stringify({ x: 1, y: 2 }),
  'reading-book.wordCountPanelSize': JSON.stringify({ width: 300, height: 200 }),
  'reading-book.settings.sidebar-collapsed': '1',
}

const NON_DEFAULT_APPEARANCE = { themeMode: 'light', accent: 'red', density: 'compact', language: 'vi' }
const NON_DEFAULT_LIBRARY = { sort: 'title', layout: 'table' }

for (const [key, value] of Object.entries(OUT_OF_SCOPE)) storage.set(key, value)
storage.set(KEYS.appearance, JSON.stringify(NON_DEFAULT_APPEARANCE))
storage.set(KEYS.library, JSON.stringify(NON_DEFAULT_LIBRARY))

const { DEFAULT_APP_APPEARANCE, loadAppAppearance } = await import('../../src/theme/appAppearance.ts')
const { useAppAppearanceStore } = await import('../../src/theme/appAppearanceStore.ts')
const { DEFAULT_LIBRARY_BROWSE_PREFS, useLibraryBrowseStore } = await import(
  '../../src/screens/Library/logic/libraryBrowseStore.ts'
)
const { APP_SETTINGS_RESETTERS, resetAppSettings } = await import(
  '../../src/screens/Settings/logic/resetAppSettings.ts'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const appearance = () => {
  const { themeMode, accent, density, language } = useAppAppearanceStore.getState()
  return { themeMode, accent, density, language }
}
const library = () => {
  const { sort, layout } = useLibraryBrowseStore.getState()
  return { sort, layout }
}
const stored = (key) => JSON.parse(storage.get(key))

/** Put every in-scope group back to a non-default value through the real setters. */
function customize() {
  const a = useAppAppearanceStore.getState()
  a.setThemeMode(NON_DEFAULT_APPEARANCE.themeMode)
  a.setAccent(NON_DEFAULT_APPEARANCE.accent)
  a.setDensity(NON_DEFAULT_APPEARANCE.density)
  a.setLanguage(NON_DEFAULT_APPEARANCE.language)
  const l = useLibraryBrowseStore.getState()
  l.setSort(NON_DEFAULT_LIBRARY.sort)
  l.setLayout(NON_DEFAULT_LIBRARY.layout)
  l.setFilter('favorites')
  l.selectBook('book-1')
}

function assertOutOfScopeUntouched() {
  for (const [key, value] of Object.entries(OUT_OF_SCOPE)) {
    assert.equal(storage.get(key), value, `${key} must not be touched by Reset App Settings`)
  }
  assert.deepEqual(ipcCalls, [], 'Reset App Settings must never call window.api (IPC → SQLite / files)')
}

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Reset App Settings')

// 1. Defaults ---------------------------------------------------------------

check('defaults: single source of truth holds the documented values', () => {
  assert.deepEqual(DEFAULT_APP_APPEARANCE, {
    themeMode: 'dark', accent: 'orange', density: 'balanced', language: 'system',
  })
  assert.deepEqual(DEFAULT_LIBRARY_BROWSE_PREFS, { sort: 'recently-added', layout: 'grid' })
  assert.deepEqual(APP_SETTINGS_RESETTERS.map((r) => r.id), ['appearance', 'library'])
})

check('stores loaded the persisted non-default values', () => {
  assert.deepEqual(appearance(), NON_DEFAULT_APPEARANCE)
  assert.deepEqual(library(), NON_DEFAULT_LIBRARY)
})

// 5. Cancel (dialog closed without confirming = reset never runs) ---------------

check('cancel: nothing changes when the reset is not confirmed', () => {
  customize()
  const before = new Map(storage)
  // AdvancedSettings only calls resetAppSettings() from the dialog's confirm button.
  assert.deepEqual(new Map(storage), before)
  assert.deepEqual(appearance(), NON_DEFAULT_APPEARANCE)
  assert.deepEqual(library(), NON_DEFAULT_LIBRARY)
  assertOutOfScopeUntouched()
})

// 2. Each group on its own ---------------------------------------------------

check('Appearance group resets only Appearance', () => {
  customize()
  const libraryRaw = storage.get(KEYS.library)
  const { failed } = resetAppSettings([APP_SETTINGS_RESETTERS.find((r) => r.id === 'appearance')])
  assert.deepEqual(failed, [])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(stored(KEYS.appearance), DEFAULT_APP_APPEARANCE)
  assert.equal(storage.get(KEYS.library), libraryRaw)
  assert.deepEqual(library(), NON_DEFAULT_LIBRARY)
  assertOutOfScopeUntouched()
})

check('Library group resets only Library view prefs', () => {
  customize()
  const appearanceRaw = storage.get(KEYS.appearance)
  const { failed } = resetAppSettings([APP_SETTINGS_RESETTERS.find((r) => r.id === 'library')])
  assert.deepEqual(failed, [])
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(stored(KEYS.library), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.equal(useLibraryBrowseStore.getState().selectedBookId, null, 'grid has no table selection')
  assert.equal(useLibraryBrowseStore.getState().filter, 'favorites', 'session filter is not a preference')
  assert.equal(storage.get(KEYS.appearance), appearanceRaw)
  assert.deepEqual(appearance(), NON_DEFAULT_APPEARANCE)
  assertOutOfScopeUntouched()
})

// 3. Full reset ------------------------------------------------------------

check('full reset: every group back to defaults, store + storage + <html> attrs', () => {
  customize()
  const { failed } = resetAppSettings()
  assert.deepEqual(failed, [])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(stored(KEYS.appearance), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(stored(KEYS.library), DEFAULT_LIBRARY_BROWSE_PREFS)
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.accent, 'orange')
  assert.equal(root.dataset.density, 'balanced')
  assert.equal(root.lang, 'en', '`system` language resolves from navigator.language')
})

check('full reset survives a restart (defaults written, not removed → no legacy-theme fallback)', () => {
  assert.ok(storage.has(KEYS.appearance), 'appearance key must be written, not removed')
  // Global reading prefs still say `paper`; a removed key would bring back the Light theme.
  assert.deepEqual(loadAppAppearance('paper'), DEFAULT_APP_APPEARANCE)
})

check('full reset is idempotent', () => {
  assert.deepEqual(resetAppSettings().failed, [])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
})

// 4. Out-of-scope state -------------------------------------------------------

check('per-book + global reading settings, history and layout keys are untouched; no IPC', () => {
  customize()
  resetAppSettings()
  assertOutOfScopeUntouched()
  const keys = [...storage.keys()].sort()
  assert.deepEqual(keys, [...Object.keys(OUT_OF_SCOPE), KEYS.appearance, KEYS.library].sort())
})

// 6. Errors ---------------------------------------------------------------

check('storage write failure: groups reported, in-memory state still reset', () => {
  customize()
  const before = new Map(storage)
  failWrites = true
  try {
    const { failed } = resetAppSettings()
    assert.deepEqual(failed.map((r) => r.label), ['Appearance', 'Library'])
  } finally {
    failWrites = false
  }
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(new Map(storage), before, 'nothing was written')
})

check('a throwing group is reported and does not stop the others', () => {
  customize()
  const boom = { id: 'boom', label: 'Boom', reset: () => { throw new Error('boom') } }
  const { failed } = resetAppSettings([boom, ...APP_SETTINGS_RESETTERS])
  assert.deepEqual(failed.map((r) => r.id), ['boom'])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assertOutOfScopeUntouched()
})

console.log(`\n${passed} checks passed.`)
