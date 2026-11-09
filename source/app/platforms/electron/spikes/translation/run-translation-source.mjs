/**
 * Remembered translation source language per book (spec 011 FR-007a), Main side: the real
 * `translation:getSourceLanguage` / `translation:setSourceLanguage` handlers and `SqliteOverlayStore` on the real
 * migrated schema (node:sqlite, `db-stub.mjs`), plus the real `overlay:saveSessionState` autosave path.
 * No Electron window, no user data, no model download.
 *
 *   1. get / set / forget, other reading-state keys and `books.updated_at` untouched
 *   2. both reading-state saves keep the value: the renderer autosave (merge) and the full overwrite (core services)
 *   3. refusals: malformed input, a code outside the catalog, an unknown book, an audiobook
 *   4. removing the book removes the value
 *
 * Run: npm run spike:translation:source
 */
import assert from 'node:assert/strict'
import { Location, ReadingSessionState } from '@core'
import { invoke } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { OverlayChannels, TranslationChannels } = await import('../../ipc/channels.ts')
const { registerTranslationIpc } = await import('../../ipc/translation.ipc.ts')
const { registerOverlayIpc } = await import('../../ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../persistence/sqlite-overlay-store.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const stateOf = (id) => JSON.parse(db.prepare('SELECT reading_state_json AS j FROM books WHERE id = ?').get(id).j)
const updatedAtOf = (id) => db.prepare('SELECT updated_at AS u FROM books WHERE id = ?').get(id).u

insertBook.run('txt-1', 'A text', 'C:/books/a.txt', 'txt', 'a'.repeat(64), JSON.stringify({ percent: 12, fontSize: 18, updatedAt: '2026-01-01T00:00:00.000Z' }))
insertBook.run('pdf-1', 'A PDF', 'C:/books/b.pdf', 'pdf', 'b'.repeat(64), '{}')
insertBook.run('mp3-1', 'An audiobook', 'C:/books/c.mp3', 'mp3', 'c'.repeat(64), '{}')

registerTranslationIpc()
registerOverlayIpc()

const get = (bookId) => invoke(TranslationChannels.getSourceLanguage, bookId)
const set = (bookId, lang) => invoke(TranslationChannels.setSourceLanguage, { bookId, lang })

console.log('1. get / set / forget')
await check('nothing remembered on a fresh book', async () => {
  assert.deepEqual(await get('txt-1'), { ok: true, lang: null })
})
await check('set vi → get vi; other keys and books.updated_at unchanged', async () => {
  assert.deepEqual(await set('txt-1', 'vi'), { ok: true })
  assert.deepEqual(await get('txt-1'), { ok: true, lang: 'vi' })
  assert.deepEqual(stateOf('txt-1'), { percent: 12, fontSize: 18, updatedAt: '2026-01-01T00:00:00.000Z', translationSourceLang: 'vi' })
  assert.equal(updatedAtOf('txt-1'), '2026-01-01T00:00:00Z')
})
await check('a regional catalog code is kept as is', async () => {
  assert.deepEqual(await set('pdf-1', 'zh-TW'), { ok: true })
  assert.deepEqual(await get('pdf-1'), { ok: true, lang: 'zh-TW' })
})
await check('books are independent', async () => {
  assert.deepEqual(await get('txt-1'), { ok: true, lang: 'vi' })
})

console.log('2. reading-position saves')
await check('overlay:saveSessionState (the renderer autosave, a merge) keeps the remembered source', async () => {
  const location = JSON.stringify({ kind: 'text-offset', offset: 40 })
  const result = await invoke(OverlayChannels.saveSessionState, { bookId: 'txt-1', lastReadLocation: location, percent: 30 })
  assert.equal(result.ok, true)
  const state = stateOf('txt-1')
  assert.equal(state.percent, 30)
  assert.equal(state.translationSourceLang, 'vi')
})
await check('SqliteOverlayStore.saveSessionState (the full overwrite used by core services) keeps it too', async () => {
  await getOverlayStore().saveSessionState(
    new ReadingSessionState({ bookId: 'txt-1', lastReadLocation: Location.parse(JSON.stringify({ kind: 'text-offset', offset: 80 })), percent: 55, updatedAt: '2030-01-01T00:00:00.000Z' }),
  )
  const state = stateOf('txt-1')
  assert.equal(state.percent, 55)
  assert.equal(state.fontSize, undefined, 'the overwrite replaced the state')
  assert.equal(state.translationSourceLang, 'vi')
  assert.deepEqual(await get('txt-1'), { ok: true, lang: 'vi' })
})

console.log('3. refusals')
await check('a code outside the catalog is refused and nothing is written', async () => {
  assert.deepEqual(await set('txt-1', 'xx-invalid'), { ok: false, code: 'invalid_request' })
  assert.deepEqual(await get('txt-1'), { ok: true, lang: 'vi' })
})
await check('malformed input is refused', async () => {
  assert.deepEqual(await invoke(TranslationChannels.setSourceLanguage, null), { ok: false, code: 'invalid_request' })
  assert.deepEqual(await invoke(TranslationChannels.setSourceLanguage, { bookId: 'txt-1', lang: 42 }), { ok: false, code: 'invalid_request' })
  assert.deepEqual(await invoke(TranslationChannels.setSourceLanguage, { bookId: '', lang: 'vi' }), { ok: false, code: 'invalid_request' })
  assert.deepEqual(await get(''), { ok: false, code: 'invalid_request' })
  assert.deepEqual(await get(7), { ok: false, code: 'invalid_request' })
})
await check('an unknown book is not_found', async () => {
  assert.deepEqual(await get('nope'), { ok: false, code: 'not_found' })
  assert.deepEqual(await set('nope', 'vi'), { ok: false, code: 'not_found' })
})
await check('an audiobook is refused (no text to translate)', async () => {
  assert.deepEqual(await set('mp3-1', 'vi'), { ok: false, code: 'invalid_request' })
  assert.deepEqual(await get('mp3-1'), { ok: false, code: 'invalid_request' })
  assert.deepEqual(stateOf('mp3-1'), {})
})
await check('a stored value that is no longer a catalog code reads as null', async () => {
  db.prepare(`UPDATE books SET reading_state_json = json_set(reading_state_json, '$.translationSourceLang', 'klingon') WHERE id = 'pdf-1'`).run()
  assert.deepEqual(await get('pdf-1'), { ok: true, lang: null })
})

console.log('4. forget / remove')
await check('set null forgets the value (key removed)', async () => {
  assert.deepEqual(await set('txt-1', null), { ok: true })
  assert.deepEqual(await get('txt-1'), { ok: true, lang: null })
  assert.ok(!('translationSourceLang' in stateOf('txt-1')))
})
await check('removing the book removes the value', async () => {
  await set('txt-1', 'fr')
  db.prepare('DELETE FROM books WHERE id = ?').run('txt-1')
  assert.deepEqual(await get('txt-1'), { ok: false, code: 'not_found' })
})

console.log(`\n${passed} checks passed.`)
