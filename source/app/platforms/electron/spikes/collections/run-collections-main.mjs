/**
 * Collections, Main side (spec 015) — the REAL `SqliteLibraryStore` collection methods on the migrated schema
 * (every numbered migration), nothing outside memory. The database is node:sqlite (the shared stand-in for
 * better-sqlite3, as in `spike:audio:chapters`) with a BEGIN / COMMIT / ROLLBACK shim for `db.transaction`.
 *
 *   1. bulk add     appended in the order given after the existing books; collection touched once
 *   2. skipping     unknown, already present and repeated ids are skipped, never reported as added
 *   3. atomicity    a failing insert leaves NOTHING behind
 *   4. undo         remove returns the link's sort order; adding with it restores the exact order
 *   5. timing       50 new books in one transaction < 200 ms (plan Performance Goals)
 *
 * Run: npm run spike:collections:main
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Book, DocumentFormat } from '@core'
import { createMigratedDatabase } from '../pdf-annotations/db-stub.mjs'

const { SqliteLibraryStore } = await import('../../persistence/sqlite-library-store.ts')

function freshStore() {
  const db = createMigratedDatabase()
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN')
    try {
      const result = fn(...args)
      db.exec('COMMIT')
      return result
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return { db, store: new SqliteLibraryStore(db) }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

let seq = 0
const uuid = () => `${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`
const sha = (s) => createHash('sha256').update(s).digest('hex')
const NOW = '2026-01-01T00:00:00.000Z'

async function addBooks(store, n) {
  const ids = []
  for (let i = 0; i < n; i++) {
    const id = uuid()
    await store.save(new Book({ id, title: `Book ${id}`, filePath: `/books/${id}.epub`, format: DocumentFormat.Epub, sha256: sha(id), addedAt: NOW, updatedAt: NOW }))
    ids.push(id)
  }
  return ids
}
const order = (store, collectionId) => store.listCollections().find((c) => c.id === collectionId).bookIds
const updatedAt = (db, id) => db.prepare('SELECT updated_at FROM collections WHERE id = ?').get(id).updated_at

console.log('spike:collections:main')

await check('bulk add appends in the given order after existing books, touching the collection once', async () => {
  const { db, store } = freshStore()
  const ids = await addBooks(store, 4)
  const c = store.createCollection({ name: 'Shelf' })
  store.addBookToCollection(c.id, ids[3])
  db.prepare("UPDATE collections SET updated_at = '2000-01-01' WHERE id = ?").run(c.id)
  const result = store.addBooksToCollection(c.id, [ids[1], ids[0], ids[2]])
  assert.deepEqual(result, { added: [ids[1], ids[0], ids[2]], skipped: [] })
  assert.deepEqual(order(store, c.id), [ids[3], ids[1], ids[0], ids[2]])
  assert.notEqual(updatedAt(db, c.id), '2000-01-01')
  const orders = db.prepare('SELECT sort_order FROM collection_books WHERE collection_id = ? ORDER BY sort_order').all(c.id).map((r) => r.sort_order)
  assert.deepEqual(orders, [0, 1, 2, 3])
})

await check('unknown, present and repeated ids are skipped; nothing added → collection untouched', async () => {
  const { db, store } = freshStore()
  const ids = await addBooks(store, 2)
  const c = store.createCollection({ name: 'Shelf' })
  store.addBookToCollection(c.id, ids[0])
  const result = store.addBooksToCollection(c.id, [ids[0], 'nope', ids[1], ids[1]])
  assert.deepEqual(result, { added: [ids[1]], skipped: [ids[0], 'nope', ids[1]] })
  db.prepare("UPDATE collections SET updated_at = '2000-01-01' WHERE id = ?").run(c.id)
  assert.deepEqual(store.addBooksToCollection(c.id, [ids[0], 'nope']), { added: [], skipped: [ids[0], 'nope'] })
  assert.equal(updatedAt(db, c.id), '2000-01-01')
})

await check('a failing insert rolls the whole add back', async () => {
  const { db, store } = freshStore()
  const ids = await addBooks(store, 3)
  const c = store.createCollection({ name: 'Shelf' })
  db.exec(`CREATE TRIGGER fail_third BEFORE INSERT ON collection_books WHEN NEW.book_id = '${ids[2]}' BEGIN SELECT RAISE(ABORT, 'disk full'); END`)
  assert.throws(() => store.addBooksToCollection(c.id, ids), /disk full/)
  assert.deepEqual(order(store, c.id), [])
})

await check('remove returns the sort order; add with it restores the exact order', async () => {
  const { store } = freshStore()
  const ids = await addBooks(store, 4)
  const c = store.createCollection({ name: 'Shelf' })
  store.addBooksToCollection(c.id, ids)
  const removed = store.removeBookFromCollection(c.id, ids[1])
  assert.deepEqual(removed, { removed: true, sortOrder: 1 })
  assert.deepEqual(store.removeBookFromCollection(c.id, ids[1]), { removed: false })
  store.addBookToCollection(c.id, ids[1], removed.sortOrder)
  assert.deepEqual(order(store, c.id), ids)
})

await check('50 new books in one transaction < 200 ms', async () => {
  const { store } = freshStore()
  const ids = await addBooks(store, 50)
  const c = store.createCollection({ name: 'Big' })
  const start = performance.now()
  const result = store.addBooksToCollection(c.id, ids)
  const ms = performance.now() - start
  assert.equal(result.added.length, 50)
  console.log(`    bulk add of 50: ${ms.toFixed(1)} ms`)
  assert.ok(ms < 200, `${ms} ms`)
})

console.log(`\n${passed} checks passed`)
