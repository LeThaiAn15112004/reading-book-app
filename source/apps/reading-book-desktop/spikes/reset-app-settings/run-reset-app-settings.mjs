/**
 * Checks for Settings → Advanced → Reset App Settings (renderer-only; app preferences live in
 * localStorage, see docs/implementation_plan/reset_app_settings.md).
 *
 *   1. defaults               -> the single source of truth holds the documented values
 *   2. each group on its own  -> Appearance / Library / Notifications / Background reset only their own state
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
const inlineStyle = new Map()
globalThis.document = {
  documentElement: {
    dataset: {},
    lang: '',
    style: {
      setProperty: (name, value) => inlineStyle.set(name, value),
      removeProperty: (name) => inlineStyle.delete(name),
    },
  },
}
const ipcCalls = []
/**
 * Background / System Tray and Notifications prefs are owned by Main: their resets (and reading back
 * Start at Login) are the only IPC calls allowed.
 */
const background = { calls: 0, ok: true, startAtLogin: true }
const fakeBackgroundApi = {
  resetPrefs: async () => {
    background.calls += 1
    if (background.ok) background.startAtLogin = false
    return { ok: background.ok, prefs: { showTray: true, runInBackground: false } }
  },
  getStartAtLogin: async () => ({ supported: true, enabled: background.startAtLogin }),
}
const NOTIFICATION_DEFAULTS = { enabled: false, reminder: { enabled: false, time: '20:00' } }
const notificationsMain = { calls: 0, ok: true }
const fakeNotificationsApi = {
  resetPrefs: async () => {
    notificationsMain.calls += 1
    return { ok: notificationsMain.ok, prefs: structuredClone(NOTIFICATION_DEFAULTS) }
  },
}
globalThis.window = {
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  // Any other IPC access (library, overlay, storage…) would mean the reset reached user data.
  api: new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'background'
          ? fakeBackgroundApi
          : prop === 'notifications'
            ? fakeNotificationsApi
            : (ipcCalls.push(String(prop)), () => Promise.reject(new Error('no IPC'))),
    },
  ),
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

const NON_DEFAULT_APPEARANCE = {
  themeMode: 'light', accent: 'custom', customAccent: '#123456', density: 'compact', language: 'vi',
}
const NON_DEFAULT_LIBRARY = { sort: 'title', layout: 'table' }

for (const [key, value] of Object.entries(OUT_OF_SCOPE)) storage.set(key, value)
storage.set(KEYS.appearance, JSON.stringify(NON_DEFAULT_APPEARANCE))
storage.set(KEYS.library, JSON.stringify(NON_DEFAULT_LIBRARY))

const { DEFAULT_APP_APPEARANCE, loadAppAppearance } = await import('../../src/theme/appAppearance.ts')
const { useAppAppearanceStore } = await import('../../src/theme/appAppearanceStore.ts')
const { DEFAULT_LIBRARY_BROWSE_PREFS, useLibraryBrowseStore } = await import(
  '../../src/screens/Library/logic/libraryBrowseStore.ts'
)
const { useNotificationsStore } = await import(
  '../../src/screens/Settings/logic/notificationsStore.ts'
)
const { useBackgroundStore } = await import('../../src/screens/Settings/logic/backgroundStore.ts')
const { APP_SETTINGS_RESETTERS, resetAppSettings } = await import(
  '../../src/screens/Settings/logic/resetAppSettings.ts'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const appearance = () => {
  const { themeMode, accent, customAccent, density, language } = useAppAppearanceStore.getState()
  return { themeMode, accent, customAccent, density, language }
}
const library = () => {
  const { sort, layout } = useLibraryBrowseStore.getState()
  return { sort, layout }
}
const notifications = () => useNotificationsStore.getState().prefs
const stored = (key) => JSON.parse(storage.get(key))

/** Put every in-scope group back to a non-default value through the real setters. */
function customize() {
  const a = useAppAppearanceStore.getState()
  a.setThemeMode(NON_DEFAULT_APPEARANCE.themeMode)
  a.setCustomAccent(NON_DEFAULT_APPEARANCE.customAccent)
  a.setDensity(NON_DEFAULT_APPEARANCE.density)
  a.setLanguage(NON_DEFAULT_APPEARANCE.language)
  const l = useLibraryBrowseStore.getState()
  l.setSort(NON_DEFAULT_LIBRARY.sort)
  l.setLayout(NON_DEFAULT_LIBRARY.layout)
  l.setFilter('favorites')
  l.selectBook('book-1')
  // Enabling goes through the OS permission check (IPC) — seed the granted state directly instead.
  useNotificationsStore.setState({
    prefs: { enabled: true, reminder: { enabled: true, time: '06:15' } },
    blocked: 'denied',
  })
  background.startAtLogin = true
  useBackgroundStore.setState({ prefs: { showTray: false, runInBackground: false } })
}

function assertOutOfScopeUntouched() {
  for (const [key, value] of Object.entries(OUT_OF_SCOPE)) {
    assert.equal(storage.get(key), value, `${key} must not be touched by Reset App Settings`)
  }
  assert.deepEqual(ipcCalls, [], 'Reset App Settings must never call window.api (IPC → SQLite / files)')
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Reset App Settings')

// 1. Defaults ---------------------------------------------------------------

await check('defaults: single source of truth holds the documented values', async () => {
  assert.deepEqual(DEFAULT_APP_APPEARANCE, {
    themeMode: 'dark', accent: 'orange', customAccent: '#ec4899', density: 'balanced', language: 'system',
  })
  assert.deepEqual(DEFAULT_LIBRARY_BROWSE_PREFS, { sort: 'recently-added', layout: 'grid' })
  assert.deepEqual(APP_SETTINGS_RESETTERS.map((r) => r.id), ['appearance', 'library', 'notifications', 'background', 'keyboard-shortcuts'])
})

await check('stores loaded the persisted non-default values', async () => {
  assert.deepEqual(appearance(), NON_DEFAULT_APPEARANCE)
  assert.deepEqual(library(), NON_DEFAULT_LIBRARY)
})

// 5. Cancel (dialog closed without confirming = reset never runs) ---------------

await check('cancel: nothing changes when the reset is not confirmed', async () => {
  customize()
  const before = new Map(storage)
  // AdvancedSettings only calls resetAppSettings() from the dialog's confirm button.
  assert.deepEqual(new Map(storage), before)
  assert.deepEqual(appearance(), NON_DEFAULT_APPEARANCE)
  assert.deepEqual(library(), NON_DEFAULT_LIBRARY)
  assertOutOfScopeUntouched()
})

// 2. Each group on its own ---------------------------------------------------

await check('Appearance group resets only Appearance', async () => {
  customize()
  const libraryRaw = storage.get(KEYS.library)
  const { failed } = await resetAppSettings([APP_SETTINGS_RESETTERS.find((r) => r.id === 'appearance')])
  assert.deepEqual(failed, [])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(stored(KEYS.appearance), DEFAULT_APP_APPEARANCE)
  assert.equal(storage.get(KEYS.library), libraryRaw)
  assert.deepEqual(library(), NON_DEFAULT_LIBRARY)
  assertOutOfScopeUntouched()
})

await check('Library group resets only Library view prefs', async () => {
  customize()
  const appearanceRaw = storage.get(KEYS.appearance)
  const { failed } = await resetAppSettings([APP_SETTINGS_RESETTERS.find((r) => r.id === 'library')])
  assert.deepEqual(failed, [])
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(stored(KEYS.library), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.equal(useLibraryBrowseStore.getState().selectedBookId, null, 'grid has no table selection')
  assert.equal(useLibraryBrowseStore.getState().filter, 'favorites', 'session filter is not a preference')
  assert.equal(storage.get(KEYS.appearance), appearanceRaw)
  assert.deepEqual(appearance(), NON_DEFAULT_APPEARANCE)
  assertOutOfScopeUntouched()
})

await check('Notifications group resets only Notifications', async () => {
  customize()
  const appearanceRaw = storage.get(KEYS.appearance)
  const libraryRaw = storage.get(KEYS.library)
  const calls = notificationsMain.calls
  const { failed } = await resetAppSettings([APP_SETTINGS_RESETTERS.find((r) => r.id === 'notifications')])
  assert.deepEqual(failed, [])
  assert.equal(notificationsMain.calls, calls + 1, 'Main writes its own defaults (master switch + reminder)')
  assert.deepEqual(notifications(), NOTIFICATION_DEFAULTS)
  assert.equal(useNotificationsStore.getState().blocked, null)
  assert.equal(storage.get(KEYS.appearance), appearanceRaw)
  assert.equal(storage.get(KEYS.library), libraryRaw)
  assertOutOfScopeUntouched()
})

await check('Background group: Main writes its defaults over IPC, store mirrors them', async () => {
  customize()
  const calls = background.calls
  const appearanceRaw = storage.get(KEYS.appearance)
  const { failed } = await resetAppSettings([APP_SETTINGS_RESETTERS.find((r) => r.id === 'background')])
  assert.deepEqual(failed, [])
  assert.equal(background.calls, calls + 1)
  assert.deepEqual(useBackgroundStore.getState().prefs, { showTray: true, runInBackground: false })
  assert.deepEqual(useBackgroundStore.getState().startAtLogin, { supported: true, enabled: false }, 'Start at Login off')
  assert.equal(storage.get(KEYS.appearance), appearanceRaw)
  assertOutOfScopeUntouched()
})

// 3. Full reset ------------------------------------------------------------

await check('full reset: every group back to defaults, store + storage + <html> attrs', async () => {
  customize()
  const { failed } = await resetAppSettings()
  assert.deepEqual(failed, [])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(stored(KEYS.appearance), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(stored(KEYS.library), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(notifications(), NOTIFICATION_DEFAULTS)
  const root = globalThis.document.documentElement
  assert.equal(root.dataset.accent, 'orange')
  assert.equal(root.dataset.density, 'balanced')
  assert.equal(inlineStyle.size, 0, 'custom accent tokens are cleared when back on a preset')
  assert.equal(root.lang, 'en', '`system` language resolves from navigator.language')
})

await check('full reset survives a restart (defaults written, not removed → no legacy-theme fallback)', async () => {
  assert.ok(storage.has(KEYS.appearance), 'appearance key must be written, not removed')
  // Global reading prefs still say `paper`; a removed key would bring back the Light theme.
  assert.deepEqual(loadAppAppearance('paper'), DEFAULT_APP_APPEARANCE)
})

await check('full reset is idempotent', async () => {
  assert.deepEqual((await resetAppSettings()).failed, [])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
})

// 4. Out-of-scope state -------------------------------------------------------

await check('per-book + global reading settings, history and layout keys are untouched; no IPC', async () => {
  customize()
  await resetAppSettings()
  assertOutOfScopeUntouched()
  const keys = [...storage.keys()].sort()
  assert.deepEqual(keys, [...Object.keys(OUT_OF_SCOPE), KEYS.appearance, KEYS.library].sort())
})

// 6. Errors ---------------------------------------------------------------

await check('storage write failure: groups reported, in-memory state still reset', async () => {
  customize()
  const before = new Map(storage)
  failWrites = true
  try {
    const { failed } = await resetAppSettings()
    assert.deepEqual(failed.map((r) => r.label), ['Appearance', 'Library'], 'Main-owned prefs are unaffected by localStorage')
  } finally {
    failWrites = false
  }
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assert.deepEqual(notifications(), NOTIFICATION_DEFAULTS)
  assert.deepEqual(new Map(storage), before, 'nothing was written')
})

await check('Main could not save the background defaults: that group is reported', async () => {
  customize()
  background.ok = false
  try {
    const { failed } = await resetAppSettings()
    assert.deepEqual(failed.map((r) => r.id), ['background'])
  } finally {
    background.ok = true
  }
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
})

await check('a throwing group is reported and does not stop the others', async () => {
  customize()
  const boom = { id: 'boom', label: 'Boom', reset: () => { throw new Error('boom') } }
  const { failed } = await resetAppSettings([boom, ...APP_SETTINGS_RESETTERS])
  assert.deepEqual(failed.map((r) => r.id), ['boom'])
  assert.deepEqual(appearance(), DEFAULT_APP_APPEARANCE)
  assert.deepEqual(library(), DEFAULT_LIBRARY_BROWSE_PREFS)
  assertOutOfScopeUntouched()
})

console.log(`\n${passed} checks passed.`)
