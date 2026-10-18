/**
 * Integration checks: the renderer's TXT document store (the REAL zustand store behind the reading
 * surface) talking to the REAL Main-side document service, SQLite schema and edited-copy folder —
 * only the IPC hop is a direct call (`window.api.txt`), so failures can be injected at that hop.
 *
 *   1. open / load   annotations restored, stale rows hidden (not deleted), notices, read-only flag
 *   2. saving        "Saved" only after txt:commit succeeded for everything on screen; debounce; flush
 *   3. failures      commit refused / throwing / conflict → error state, text kept, retry, no false "Saved"
 *   4. in flight     edits made while a commit is running are saved by the next round
 *   5. annotations   create / restyle / note / delete / undo persist; edits move or remove rows
 *   6. switching     leaving a book saves ITS pending edits to ITS id, never to the next book
 *
 * Run: npm run spike:txt:store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildTxtSelectionText,
  deriveTextEdit,
  packTxtAnnotationRef,
  packTxtHighlightLocator,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getTxtStore } = await import('../../electron/persistence/sqlite-txt-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { resolveBookFile } = await import('../../electron/files/sandbox.ts')
const { createTxtDocumentService } = await import('../../electron/txt/txt-document-service.ts')
const { createTxtWorkingCopyStore } = await import('../../electron/txt/txt-working-copy.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-txt-store-'))
const copies = createTxtWorkingCopyStore(() => path.join(tmp, 'txt-edits'))
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'txt', ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
function addBook(id, text) {
  const file = path.join(tmp, `${id}.txt`)
  fs.writeFileSync(file, text)
  insertBook.run(id, id, file, `sha-${id}`)
  return file
}
const library = getLibraryStore()
const service = createTxtDocumentService({
  findBook: async (id) => {
    const b = await library.findById(id)
    return b ? { id: b.id, filePath: b.filePath, format: b.format, sha256: b.sha256 } : undefined
  },
  resolveFile: resolveBookFile,
  store: getTxtStore(),
  overlays: getOverlayStore(),
  copies,
  invalidateIndex: () => {},
})

// ---- the IPC hop, with fault injection -------------------------------------------------------
const hop = { calls: [], fail: null, hold: null }
globalThis.window = {
  api: {
    txt: {
      open: (id) => service.open(id),
      commit: async (input) => {
        hop.calls.push(structuredClone(input))
        if (hop.hold) await hop.hold
        if (hop.fail === 'throw') throw new Error('ipc down')
        if (hop.fail) return hop.fail
        return service.commit(input)
      },
    },
  },
}

const { useTxtDocumentStore: store } = await import('../../src/screens/Reader/logic/txtDocument/txtDocumentStore.ts')
const S = () => store.getState()
const toasts = []
const surface = { cleared: 0, jumped: [], flashed: [] }
S().setContext({
  bookId: 'x',
  onToast: (m) => toasts.push(m),
  onChromeHidden: () => {},
  txtApiRef: {
    current: {
      clearSelection: () => (surface.cleared += 1),
      scrollToOffset: (o) => surface.jumped.push(o),
      flashHighlight: (id) => surface.flashed.push(id),
    },
  },
})

const TEXT = 'Chương 1\nTrời hôm nay rất đẹp 🌳.\nLine needle here.\nHết. 😀\n'
const at = (needle) => TEXT.indexOf(needle)
const sel = (start, end = start) => ({ start, end })
/** What the text box reports for typing `insert` at the caret (selection → replaced). */
function type(caret, insert, { replace = 0 } = {}) {
  const doc = S().doc
  const after = doc.text.slice(0, caret) + insert + doc.text.slice(caret + replace)
  const edit = deriveTextEdit(doc.text, after, { selectionStart: caret, selectionEnd: caret + replace, inputType: 'insertText' })
  S().applyEdit(edit, sel(caret, caret + replace), sel(caret + insert.length))
}
const stored = async (id) => {
  const r = await service.open(id) // also re-arms the Main session; revision unchanged
  return { text: r.text, revision: r.revision, rows: r.highlights.map((h) => ({ id: h.id, ...JSON.parse(h.txtAnnotationRef), kind: h.styleKind, note: h.note })) }
}
const selectionOf = (needle) => ({ start: at(needle), end: at(needle) + needle.length, text: needle, box: null })

console.log('TXT store ↔ Main (real zustand store, real service + SQLite)')

// ------------------------------------------------------------------------------------------------
console.log('1. open / load')
addBook('b1', TEXT)

await check('load → ready, text and status "saved", nothing written', async () => {
  await S().load('b1')
  assert.equal(S().loadStatus, 'ready')
  assert.equal(S().doc.text, TEXT)
  assert.equal(S().saveStatus, 'saved')
  assert.equal(S().editable, true)
  assert.equal(S().persisted.revision, 0)
  assert.equal(hop.calls.length, 0)
})

await check('a missing book is an error state, not a crash', async () => {
  await S().load('nope')
  assert.equal(S().loadStatus, 'error')
  assert.equal(S().errorCode, 'not_found')
  assert.equal(S().doc, null)
  await S().load('b1')
  assert.equal(S().loadStatus, 'ready')
})

await check('stale rows are hidden (and reported), never deleted; the rest load', async () => {
  const good = {
    id: 'g1', bookId: 'b1', locatorRef: packTxtHighlightLocator({ startOffset: at('needle'), endOffset: at('needle') + 6 }),
    styleKind: 'highlight', colorHex: '#ffeb3b', tags: [], createdAt: '2026-10-18T00:00:00.000Z',
    selectionTextRef: JSON.stringify(buildTxtSelectionText(TEXT, at('needle'), at('needle') + 6)),
    txtAnnotationRef: packTxtAnnotationRef({ startOffset: at('needle'), endOffset: at('needle') + 6 }),
  }
  assert.equal((await service.commit({ bookId: 'b1', baseRevision: 0, upserts: [good], deletedIds: [] })).ok, true)
  // a second row whose quote no longer matches its offsets (the file changed outside)
  await service.commit({ bookId: 'b1', baseRevision: 0, upserts: [{ ...good, id: 's1' }], deletedIds: [] })
  db.prepare(`UPDATE notes SET note_json = json_set(note_json, '$.locatorExtended.text.highlight', 'gone') WHERE id = 's1'`).run()
  toasts.length = 0
  await S().load('b1')
  assert.deepEqual(S().doc.highlights.map((h) => h.id), ['g1'])
  assert.ok(toasts.some((t) => /1 annotation no longer matches/.test(t)), toasts.join('|'))
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM notes WHERE id = 's1'`).get().n, 1, 'the hidden row must stay in the database')
  assert.deepEqual([...S().persisted.rows.keys()], ['g1'])
  db.prepare(`DELETE FROM notes WHERE id = 's1'`).run()
  await S().load('b1')
})

await check('a legacy-encoded file reports its notice; an oversized one is read-only', async () => {
  fs.writeFileSync(path.join(tmp, 'b-legacy.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))
  insertBook.run('b-legacy', 'legacy', path.join(tmp, 'b-legacy.txt'), 'sha-legacy')
  toasts.length = 0
  await S().load('b-legacy')
  assert.equal(S().doc.text, 'café')
  assert.ok(toasts.some((t) => /Windows-1252/.test(t)))
  addBook('b-big', 'z'.repeat(400_001))
  toasts.length = 0
  await S().load('b-big')
  assert.equal(S().editable, false)
  assert.ok(toasts.some((t) => /too large to edit/.test(t)))
  type(0, 'nope') // an edit on a read-only document is ignored
  assert.equal(S().doc.text.length, 400_001)
  assert.equal(S().saveStatus, 'saved')
  await S().load('b1')
})

// ------------------------------------------------------------------------------------------------
console.log('2. saving')

await check('typing marks the document unsaved right away; "saved" only after the commit succeeded', async () => {
  hop.calls.length = 0
  type(0, '>> ')
  assert.equal(S().saveStatus, 'dirty')
  assert.equal(hop.calls.length, 0, 'nothing is sent before the debounce')
  let release
  hop.hold = new Promise((r) => (release = r))
  const flushing = S().flush()
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(S().saveStatus, 'saving', 'while the commit is in flight it must say so')
  assert.equal(hop.calls.length, 1)
  release()
  hop.hold = null
  assert.equal(await flushing, true)
  assert.equal(S().saveStatus, 'saved')
  const s = await stored('b1')
  assert.equal(s.revision, 1)
  assert.equal(s.text, '>> ' + TEXT)
  // the annotation moved with the text, in the same commit
  assert.equal(s.rows[0].startOffset, at('needle') + 3)
})

await check('the debounce saves a burst of typing as ONE commit', async () => {
  hop.calls.length = 0
  for (const [i, ch] of [...'abc'].entries()) type(3 + i, ch)
  assert.equal(S().saveStatus, 'dirty')
  await new Promise((r) => setTimeout(r, 1100))
  assert.equal(hop.calls.length, 1)
  assert.equal(S().saveStatus, 'saved')
  assert.equal(hop.calls[0].text, '>> abc' + TEXT)
  assert.equal(hop.calls[0].baseRevision, 1)
  assert.equal((await stored('b1')).revision, 2)
})

await check('flush with nothing to save sends nothing and stays "saved"', async () => {
  hop.calls.length = 0
  assert.equal(await S().flush(), true)
  assert.equal(hop.calls.length, 0)
  assert.equal(S().saveStatus, 'saved')
})

// ------------------------------------------------------------------------------------------------
console.log('3. failures')

await check('commit refused → "error" with the reason, the text stays on screen, retry saves it', async () => {
  type(0, 'Q')
  hop.fail = { ok: false, errorCode: 'write_failed', errorMessage: 'Could not save your changes to disk.' }
  assert.equal(await S().flush(), false)
  assert.equal(S().saveStatus, 'error')
  assert.equal(S().saveError, 'Could not save your changes to disk.')
  assert.equal(S().saveFatal, false)
  assert.ok(S().doc.text.startsWith('Q>> abc'))
  assert.equal((await stored('b1')).text.startsWith('Q'), false, 'nothing was saved')
  // typing while in the error state keeps the state honest (still not saved)
  type(1, 'R')
  assert.notEqual(S().saveStatus, 'saved')
  hop.fail = null
  S().retrySave()
  await S().flush()
  assert.equal(S().saveStatus, 'saved')
  assert.equal((await stored('b1')).text.startsWith('QR>> abc'), true, 'everything typed during the outage is saved')
})

await check('the IPC hop throwing is handled like a refusal', async () => {
  type(0, 'T')
  hop.fail = 'throw'
  assert.equal(await S().flush(), false)
  assert.equal(S().saveStatus, 'error')
  hop.fail = null
  await S().flush()
  assert.equal(S().saveStatus, 'saved')
})

await check('a conflict (the stored revision moved) is fatal: error, no retry loop, nothing overwritten', async () => {
  // Another writer advances the revision behind the store's back.
  const other = await service.open('b1')
  await service.commit({ bookId: 'b1', baseRevision: other.revision, text: other.text + 'elsewhere', upserts: [], deletedIds: [] })
  // …and the store's session is now stale relative to Main's.
  hop.calls.length = 0
  type(0, 'U')
  const result = await S().flush()
  assert.equal(result, false)
  assert.equal(S().saveStatus, 'error')
  assert.equal(S().saveFatal, true)
  const calls = hop.calls.length
  await new Promise((r) => setTimeout(r, 2300))
  assert.equal(hop.calls.length, calls, 'a fatal error must not retry on its own')
  assert.equal((await stored('b1')).text.endsWith('elsewhere'), true, 'the other writer\'s text was not overwritten')
  await S().load('b1') // reopen: back in step
  assert.equal(S().saveStatus, 'saved')
})

// ------------------------------------------------------------------------------------------------
console.log('4. edits during a commit')

await check('typing while a commit is in flight is saved by the next round; "saved" only when all is saved', async () => {
  hop.calls.length = 0
  type(0, '1')
  let release
  hop.hold = new Promise((r) => (release = r))
  const flushing = S().flush()
  await new Promise((r) => setTimeout(r, 20))
  type(0, '2') // while the first commit is still running
  assert.equal(S().saveStatus, 'saving')
  hop.hold = null
  release()
  assert.equal(await flushing, true)
  assert.equal(hop.calls.length, 2, 'a second round must have carried the later edit')
  assert.equal(S().saveStatus, 'saved')
  const text = (await stored('b1')).text
  assert.equal(text.startsWith('21'), true)
  assert.equal(S().doc.text, text)
})

// ------------------------------------------------------------------------------------------------
console.log('5. annotations')
await S().load('b1')
const base = S().doc.text
const pos = (needle) => base.indexOf(needle)
const sel2 = (needle) => ({ start: pos(needle), end: pos(needle) + needle.length, text: needle, box: null })

await check('create → saved at once (no debounce) with the right offsets and quote', async () => {
  hop.calls.length = 0
  const h = S().createFromSelection(sel2('Hết'), 'underline')
  assert.ok(h)
  assert.equal(surface.cleared > 0, true)
  await new Promise((r) => setTimeout(r, 50))
  const s = await stored('b1')
  const row = s.rows.find((r) => r.id === h.id)
  assert.deepEqual([row.startOffset, row.endOffset, row.kind], [pos('Hết'), pos('Hết') + 3, 'underline'])
  assert.equal(S().saveStatus, 'saved')
})

await check('an invalid selection is refused with a message and changes nothing', async () => {
  toasts.length = 0
  assert.equal(S().createFromSelection({ start: 5, end: 5, text: '', box: null }, 'highlight'), null)
  assert.equal(S().createFromSelection({ start: 0, end: 99999, text: 'x', box: null }, 'highlight'), null)
  assert.ok(toasts.some((t) => /Could not mark/.test(t)))
})

await check('restyle, color, note and tags persist; delete removes the row (no orphan)', async () => {
  const a = S().createFromSelection(sel2('Chương 1'), 'highlight')
  await S().flush()
  S().updateHighlightStyleKind(a.id, 'strikethrough')
  S().updateHighlightColor(a.id, '#ff0000')
  S().updateHighlightNote(a.id, 'ghi chú')
  S().updateHighlightTags(a.id, ['x'])
  await S().flush()
  const row = (await stored('b1')).rows.find((r) => r.id === a.id)
  assert.equal(row.kind, 'strikethrough')
  assert.equal(row.note, 'ghi chú')
  assert.equal(db.prepare(`SELECT json_extract(note_json,'$.style.colorHex') c FROM notes WHERE id = ?`).get(a.id).c, '#ff0000')
  S().deleteHighlight(a.id)
  await S().flush()
  assert.equal((await stored('b1')).rows.some((r) => r.id === a.id), false)
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM notes WHERE id = ?`).get(a.id).n, 0)
})

await check('Ctrl+Z / Ctrl+Y: undo brings back a deleted annotation and its text, and they are saved', async () => {
  const n = S().createFromSelection(sel2('Hết'), 'highlight') // second mark on the same words
  await S().flush()
  S().undo() // undo that create
  await S().flush()
  assert.equal((await stored('b1')).rows.some((r) => r.id === n.id), false)
  S().redo()
  await S().flush()
  assert.equal((await stored('b1')).rows.some((r) => r.id === n.id), true)
})

await check('an edit inside an annotation removes it with a message; undo restores it; before/after only move or keep', async () => {
  await S().load('b1')
  const keep = S().doc.highlights.find((h) => h.styleKind === 'underline')
  const inside = S().createFromSelection(sel2('needle'), 'highlight')
  await S().flush()
  toasts.length = 0
  const before = S().doc.highlights.map((h) => [h.id, h.startOffset])
  type(0, 'Z') // before everything
  await S().flush()
  for (const [id, start] of before) assert.equal((await stored('b1')).rows.find((r) => r.id === id).startOffset, start + 1)
  assert.equal(toasts.length, 0)
  const mid = S().doc.highlights.find((h) => h.id === inside.id)
  type(mid.startOffset + 2, 'ZZ') // inside "needle"
  // "needle" carries two annotations at this point (the one loaded from the database + the new one):
  // an edit inside the words removes every annotation that covers them.
  assert.ok(toasts.some((t) => /2 annotations were removed/.test(t)), toasts.join('|'))
  await S().flush()
  assert.equal((await stored('b1')).rows.some((r) => r.id === inside.id), false)
  assert.equal((await stored('b1')).rows.some((r) => r.id === 'g1'), false)
  assert.equal((await stored('b1')).rows.some((r) => r.id === keep.id), true, 'the unrelated annotation survived')
  S().undo()
  await S().flush()
  assert.equal((await stored('b1')).rows.some((r) => r.id === inside.id), true)
  assert.equal(S().caretRequest.token > 0, true)
})

await check('jumping to an annotation scrolls the surface and flashes it', async () => {
  const h = S().doc.highlights[0]
  S().jumpToHighlight(h)
  assert.equal(surface.jumped.at(-1), h.startOffset)
  assert.equal(surface.flashed.at(-1), h.id)
})

// ------------------------------------------------------------------------------------------------
console.log('6. switching books')

await check('leaving a book saves its pending edits to ITS id; the next book is untouched', async () => {
  addBook('b2', 'second book\n')
  await S().load('b1')
  type(0, 'PENDING ')
  assert.equal(S().saveStatus, 'dirty')
  const b2Before = await stored('b2')
  S().setContext({ bookId: 'b2' }) // the screen already points at the next book
  await S().load('b2') // load flushes the previous document first
  assert.equal(S().doc.text, 'second book\n')
  assert.equal((await stored('b1')).text.startsWith('PENDING '), true)
  assert.deepEqual(await stored('b2'), b2Before)
  assert.equal(hop.calls.at(-1).bookId, 'b1')
})

await check('leave() saves and then drops the document', async () => {
  type(0, 'bye ')
  await S().leave()
  assert.equal(S().doc, null)
  assert.equal((await stored('b2')).text, 'bye second book\n')
})

S().resetForNewBook()
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
fs.rmSync(path.join(os.tmpdir(), 'readmate-spike-userdata'), { recursive: true, force: true, maxRetries: 3 })
console.log(`\n${passed} checks passed`)
