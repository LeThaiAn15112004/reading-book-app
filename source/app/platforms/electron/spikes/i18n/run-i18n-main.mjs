/**
 * Checks for the Main-process interface language (spec 012; `electron` is a stub, core i18n is real).
 *
 *   1. mirror file   -> missing / corrupt / invalid → `system`; a written preference is read back
 *   2. system rule   -> device locale list, fallback to app.getLocale(), explicit choice wins
 *   3. handler       -> app:setUiLanguage validation, nothing changes on bad input, WRITE_FAILED still applies
 *   4. listeners     -> fire once per EFFECTIVE change (not per call), a throwing listener does not break others
 *   5. tMain         -> follows the language without a restart
 *   6. Main shell    -> tray menu, reminder notification and every Main-owned dialog in vi and en, no restart
 *
 * Run: npm run spike:i18n:main
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stub } from './electron-stub.mjs'

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-i18n-'))
stub.userData = userData
const MIRROR = path.join(userData, 'ui-language.json')

const i18n = await import('../../i18n/main-i18n.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Main interface language (spec 012)')

// 1. Mirror file --------------------------------------------------------------

await check('missing mirror → system (English device → en)', () => {
  stub.preferredLanguages = ['en-US']
  assert.equal(i18n.loadMainUiLanguage(), 'en')
  assert.equal(i18n.getMainUiLanguagePreference(), 'system')
})

await check('corrupt / invalid mirror → system', () => {
  for (const content of ['{not json', '[]', 'null', '{"version":1,"preference":"fr"}', '{"preference":42}']) {
    fs.writeFileSync(MIRROR, content)
    i18n.loadMainUiLanguage()
    assert.equal(i18n.getMainUiLanguagePreference(), 'system', content)
  }
  assert.equal(i18n.parseUiLanguageMirror(undefined), 'system')
})

await check('a saved preference is written atomically and read back at the next start', () => {
  fs.rmSync(MIRROR, { force: true })
  assert.deepEqual(i18n.handleSetUiLanguage('vi'), { ok: true, effective: 'vi' })
  assert.deepEqual(JSON.parse(fs.readFileSync(MIRROR, 'utf8')), { version: 1, preference: 'vi' })
  assert.equal(fs.existsSync(`${MIRROR}.tmp`), false)
  i18n.handleSetUiLanguage('en') // in memory away from vi…
  fs.writeFileSync(MIRROR, JSON.stringify({ version: 1, preference: 'vi' }))
  assert.equal(i18n.loadMainUiLanguage(), 'vi') // …the file wins at start
})

// 2. System rule --------------------------------------------------------------

await check('system follows the first device locale; fallback to app.getLocale()', () => {
  stub.preferredLanguages = ['vi-VN', 'en-US']
  assert.equal(i18n.handleSetUiLanguage('system').effective, 'vi')
  stub.preferredLanguages = ['fr-FR', 'vi-VN']
  assert.equal(i18n.handleSetUiLanguage('system').effective, 'en')
  stub.preferredLanguages = null // getPreferredSystemLanguages throws
  stub.locale = 'vi'
  assert.equal(i18n.handleSetUiLanguage('system').effective, 'vi')
  stub.preferredLanguages = []
  stub.locale = 'de'
  assert.equal(i18n.handleSetUiLanguage('system').effective, 'en')
})

await check('neither locale API answers → system resolves to English', () => {
  stub.preferredLanguages = null
  stub.locale = ''
  assert.equal(i18n.handleSetUiLanguage('system').effective, 'en')
  stub.locale = 'en-US'
})

await check('an explicit choice wins over the device', () => {
  stub.preferredLanguages = ['vi-VN']
  assert.equal(i18n.handleSetUiLanguage('en').effective, 'en')
  stub.preferredLanguages = ['en-US']
  assert.equal(i18n.handleSetUiLanguage('vi').effective, 'vi')
})

// 3. Handler ------------------------------------------------------------------

await check('invalid input → INVALID_ARGUMENT, nothing changed (memory or file)', () => {
  i18n.handleSetUiLanguage('vi')
  const before = fs.readFileSync(MIRROR, 'utf8')
  for (const bad of [undefined, null, 'fr', 'VI', 1, {}, ['vi']]) {
    assert.deepEqual(i18n.handleSetUiLanguage(bad), { ok: false, code: 'INVALID_ARGUMENT' })
  }
  assert.equal(i18n.getMainUiLanguagePreference(), 'vi')
  assert.equal(fs.readFileSync(MIRROR, 'utf8'), before)
})

await check('unwritable mirror → WRITE_FAILED, but the language still applies in memory', () => {
  stub.userData = path.join(userData, 'missing-folder')
  stub.preferredLanguages = ['en-US']
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    assert.deepEqual(i18n.handleSetUiLanguage('en'), { ok: false, code: 'WRITE_FAILED' })
  } finally {
    console.warn = warn
  }
  assert.equal(i18n.getMainUiLanguage(), 'en')
  assert.equal(warnings.length, 1) // logged once, not thrown
  stub.userData = userData
})

// 4. Listeners ----------------------------------------------------------------

await check('listeners fire once per effective change; a throwing listener does not stop the others', () => {
  i18n.handleSetUiLanguage('en')
  const seen = []
  const offBad = i18n.onMainUiLanguageChange(() => {
    throw new Error('boom')
  })
  const off = i18n.onMainUiLanguageChange((lang) => seen.push(lang))
  const warn = console.warn
  console.warn = () => {}
  try {
    i18n.handleSetUiLanguage('vi')
    i18n.handleSetUiLanguage('vi') // same → no event
    stub.preferredLanguages = ['vi-VN']
    i18n.handleSetUiLanguage('system') // preference changes, effective stays vi → no event
    i18n.handleSetUiLanguage('en')
  } finally {
    console.warn = warn
  }
  assert.deepEqual(seen, ['vi', 'en'])
  off()
  offBad()
  i18n.handleSetUiLanguage('vi')
  assert.deepEqual(seen, ['vi', 'en'])
})

// 5. tMain --------------------------------------------------------------------

await check('tMain follows the language without a restart', () => {
  i18n.handleSetUiLanguage('en')
  assert.equal(i18n.tMain('common.actions.delete'), 'Delete')
  i18n.handleSetUiLanguage('vi')
  assert.equal(i18n.tMain('common.actions.delete'), 'Xóa')
  assert.equal(i18n.tMain('common.duration.minutes', { count: 2 }), '2 phút')
})

// 6. Main shell texts (spec 012 US3) -----------------------------------------

const background = await import('../../background/background-mode.ts')
const reminders = await import('../../reminders/reminder-schedule.ts')

await check('tray menu labels: vi, then en after a change, no restart', () => {
  i18n.handleSetUiLanguage('vi')
  const vi = background.trayMenuTemplate().filter((item) => item.label).map((item) => item.label)
  assert.equal(vi.length, 2)
  assert.deepEqual(vi, [i18n.tMain('main.shell.tray.open', { app: 'Readmate' }), i18n.tMain('main.shell.tray.quit', { app: 'Readmate' })])
  i18n.handleSetUiLanguage('en')
  const en = background.trayMenuTemplate().filter((item) => item.label).map((item) => item.label)
  assert.deepEqual(en, ['Open Readmate', 'Quit Readmate'])
  assert.notDeepEqual(vi, en)
})

await check('reminder notification text in both languages', () => {
  i18n.handleSetUiLanguage('en')
  const en = reminders.reminderMessage('Nhà Giả Kim')
  const enPick = reminders.reminderMessage(null)
  i18n.handleSetUiLanguage('vi')
  const vi = reminders.reminderMessage('Nhà Giả Kim')
  const viPick = reminders.reminderMessage(null)
  for (const m of [en, vi]) assert.ok(m.body.includes('Nhà Giả Kim'))
  assert.notEqual(en.title, vi.title)
  assert.notEqual(en.body, vi.body)
  assert.notEqual(enPick.body, viPick.body)
})

await check('every Main-owned dialog title / filter name comes from the catalogue, in both languages', () => {
  const files = ['annotation-transfer', 'attachments', 'import', 'library', 'overlay', 'transcription', 'zip-import']
  for (const name of files) {
    const source = fs.readFileSync(new URL(`../../ipc/${name}.ipc.ts`, import.meta.url), 'utf8')
    const keys = [...source.matchAll(/tMain\('(main\.shell\.dialogs\.[A-Za-z]+)'/g)].map((m) => m[1])
    assert.ok(keys.length > 0, `${name}.ipc.ts has no catalogue dialog text`)
    assert.doesNotMatch(source, /(title|name|buttonLabel): '[A-Z][a-z]/, `${name}.ipc.ts still has an English dialog literal`)
    let translated = 0 // format names ("Markdown (*.md)") may read the same; titles may not
    for (const key of keys) {
      i18n.handleSetUiLanguage('en')
      const en = i18n.tMain(key, { title: 'X' })
      i18n.handleSetUiLanguage('vi')
      const vi = i18n.tMain(key, { title: 'X' })
      assert.ok(en && en !== key && vi && vi !== key, key)
      if (en !== vi) translated += 1
    }
    assert.ok(translated > 0, `${name}.ipc.ts: no dialog text differs between en and vi`)
  }
})

fs.rmSync(userData, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)
