/**
 * Spec 016 (T046): the REAL renderer `importQueueStore` against a scriptable fake `window.api` — automated, Node only.
 *
 *   npm run spike:import:queue
 *
 * Checks: one job at a time in FIFO order; cancel a waiting job; cancel a running one (host asked to stop); "Saving"
 * cannot be cancelled; a second import waits; two jobs of the same file → the second is a duplicate; batch summary
 * counts; a ZIP job runs in the same queue; cancel-all (quit); the phone snapshot restores a running job as
 * "Interrupted" and lets the waiting ones run. The 20-file and hidden-window checks are manual (quickstart §3, 8–9).
 * Spec 017 (US4, T045): picks of waiting jobs that are cancelled / dismissed / cleared are released; Main's
 * `picked-files.ts` keeps a pick with no time limit and releases the oldest beyond 500.
 */
import assert from 'node:assert/strict'

// ---- a scriptable host ---------------------------------------------------------------------------------------
const calls = []
const progressHandlers = new Set()
const cancelAllHandlers = new Set()
const pending = new Map() // jobId → { resolve }
let snapshot = null
const savedSnapshots = []
const activity = []

function deferred() {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

const fakeApi = {
  import: {
    fromFile: async () => ({ ok: false, bookId: null }),
    fromUrl: async (url) => {
      calls.push(['fromUrl', url])
      const d = deferred()
      pending.set(`url:${url}`, d)
      return d.promise
    },
    cancel: async () => {
      calls.push(['cancelUrl'])
      return { ok: true }
    },
    onProgress: (h) => {
      progressHandlers.add(h)
      return () => progressHandlers.delete(h)
    },
    pickFiles: async () => ({ status: 'cancelled' }),
    runJob: async ({ jobId, pickId }) => {
      calls.push(['runJob', pickId])
      const d = deferred()
      pending.set(jobId, d)
      return d.promise
    },
    cancelJob: async ({ jobId }) => {
      calls.push(['cancelJob', jobId])
      pending.get(jobId)?.resolve({ ok: false, bookId: null, errorCode: 'cancelled' })
      return { ok: true }
    },
    releasePicks: async ({ pickIds }) => {
      calls.push(['releasePicks', [...pickIds]])
      return { ok: true, released: pickIds.length }
    },
    reportActivity: async (a) => {
      activity.push(a)
      return { ok: true }
    },
    onCancelAll: (h) => {
      cancelAllHandlers.add(h)
      return () => cancelAllHandlers.delete(h)
    },
  },
  library: { getBook: async (id) => ({ id, title: `Title ${id}`, author: '', format: 'pdf', fileName: 'x.pdf' }) },
}
globalThis.window = { api: fakeApi }

const { useImportQueueStore, startImportQueue, resetImportQueueForTests, registerZipJobRunner } = await import(
  '../../../../hooks/library/importQueueStore.ts'
)
const { summarizeBatch } = await import('../../../../../core/src/index.ts')

const tick = () => new Promise((r) => setTimeout(r, 0))
const state = () => useImportQueueStore.getState()
const jobs = () => state().queue.jobs
const byName = (name) => jobs().find((j) => j.name === name)
const running = () => jobs().filter((j) => j.state === 'running')
const emit = (p) => {
  for (const h of progressHandlers) h(p)
}
async function finishRunning(result) {
  const job = running()[0]
  assert.ok(job, 'a job is running')
  pending.get(job.source.kind === 'url' ? `url:${job.source.url}` : job.id).resolve(result)
  for (let i = 0; i < 10; i++) await tick()
}
const book = (pickId, name) => ({ pickId, name, sizeBytes: 100, kind: 'book' })

let passed = 0
async function check(name, fn) {
  resetImportQueueForTests()
  calls.length = 0
  pending.clear()
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

await startImportQueue()

await check('runs one job at a time, oldest first; a second import waits', async () => {
  state().addPicked([book('p1', 'a.pdf'), book('p2', 'b.pdf')], 0, 'unsupported')
  await tick()
  assert.equal(running().length, 1)
  assert.equal(running()[0].name, 'a.pdf')
  state().addUrl('https://example.org/c.epub', 'c.epub')
  assert.equal(byName('c.epub').state, 'waiting')
  await finishRunning({ ok: true, bookId: 'A' })
  assert.equal(byName('a.pdf').state, 'done')
  assert.equal(running()[0].name, 'b.pdf')
  await finishRunning({ ok: true, bookId: 'B' })
  assert.equal(running()[0].name, 'c.epub')
  await finishRunning({ ok: true, bookId: 'C' })
  assert.deepEqual(calls.filter((c) => c[0] !== 'cancelUrl').map((c) => c[1]), ['p1', 'p2', 'https://example.org/c.epub'])
  assert.deepEqual(activity.at(-1), { running: 0, waiting: 0 })
})

await check('progress events update the running job (step, bytes, elapsed clock restarts on a step change)', async () => {
  state().addPicked([book('p1', 'a.pdf')], 0, 'x')
  await tick()
  const id = running()[0].id
  emit({ stage: 'importing', jobId: id, step: 'checking', doneBytes: 50, totalBytes: 200 })
  assert.deepEqual(byName('a.pdf').progress, { done: 50, total: 200 })
  const before = byName('a.pdf').stepStartedAt
  await new Promise((r) => setTimeout(r, 5))
  emit({ stage: 'importing', jobId: id, step: 'reading', doneBytes: 0, totalBytes: null })
  assert.equal(byName('a.pdf').step, 'reading')
  assert.ok(byName('a.pdf').stepStartedAt > before)
  emit({ stage: 'importing', jobId: 'someone-else', step: 'saving', doneBytes: 0, totalBytes: null })
  assert.equal(byName('a.pdf').step, 'reading')
  await finishRunning({ ok: true, bookId: 'A' })
})

await check('cancel a waiting job at once; cancel the running one through the host', async () => {
  state().addPicked([book('p1', 'a.pdf'), book('p2', 'b.pdf')], 0, 'x')
  await tick()
  state().cancel(byName('b.pdf').id)
  assert.equal(byName('b.pdf').state, 'cancelled')
  state().cancel(byName('a.pdf').id)
  for (let i = 0; i < 10; i++) await tick()
  assert.ok(calls.some((c) => c[0] === 'cancelJob'))
  assert.equal(byName('a.pdf').state, 'cancelled')
})

await check('"Saving" cannot be cancelled ("Finishing…"), the import completes', async () => {
  state().addPicked([book('p1', 'a.pdf')], 0, 'x')
  await tick()
  emit({ stage: 'importing', jobId: running()[0].id, step: 'saving', doneBytes: 0, totalBytes: null })
  state().cancel(byName('a.pdf').id)
  assert.equal(calls.some((c) => c[0] === 'cancelJob'), false)
  await finishRunning({ ok: true, bookId: 'A' })
  assert.equal(byName('a.pdf').state, 'done')
})

await check('two jobs of the same file: the second is reported as a duplicate of the first', async () => {
  state().addPicked([book('p1', 'a.pdf')], 0, 'x')
  state().addPicked([book('p2', 'a.pdf')], 0, 'x')
  await tick()
  await finishRunning({ ok: true, bookId: 'A' })
  await finishRunning({ ok: false, bookId: 'A', errorCode: 'duplicate' })
  const [first, second] = jobs()
  assert.equal(first.state, 'done')
  assert.equal(second.state, 'duplicate')
  assert.equal(second.bookId, 'A')
})

await check('batch summary: five groups add up to the files queued; unsupported counted as failed', async () => {
  state().addPicked(
    [book('p1', 'a.pdf'), book('p2', 'b.pdf'), book('p3', 'c.pdf'), book('p4', 'd.pdf'), { pickId: '', name: 'e.docx', sizeBytes: 1, kind: 'unsupported' }],
    3,
    'Not a book format',
  )
  await tick()
  await finishRunning({ ok: true, bookId: 'A' })
  await finishRunning({ ok: false, bookId: 'X', errorCode: 'duplicate' })
  await finishRunning({ ok: false, bookId: null, errorCode: 'corrupted', errorMessage: 'Damaged' })
  state().cancel(running()[0].id)
  for (let i = 0; i < 10; i++) await tick()
  const batchId = jobs()[0].batchId
  const s = summarizeBatch(state().queue, batchId)
  assert.equal(s.finished, true)
  assert.equal(s.total, 5)
  assert.equal(s.notAdded, 3)
  assert.equal(s.added + s.alreadyInLibrary + s.failed.length + s.cancelled + s.interrupted.length, 5)
  assert.deepEqual([s.added, s.alreadyInLibrary, s.failed.length, s.cancelled], [1, 1, 2, 1])
  assert.equal(state().notice?.kind, 'batch')
})

await check('a ZIP job runs in the same queue, after the book before it', async () => {
  const zipCalls = []
  registerZipJobRunner(async (selection, onProgress) => {
    zipCalls.push(selection)
    onProgress({ step: 'copying', done: 1, total: 2 })
    return { kind: 'done', bookId: 'Z' }
  })
  state().addPicked([book('p1', 'a.pdf')], 0, 'x')
  state().addZip({ tracks: 2 }, 'book.zip', null)
  await tick()
  assert.equal(zipCalls.length, 0)
  await finishRunning({ ok: true, bookId: 'A' })
  for (let i = 0; i < 10; i++) await tick()
  assert.deepEqual(zipCalls, [{ tracks: 2 }])
  assert.equal(byName('book.zip').state, 'done')
})

await check('cancel-all before a confirmed quit cancels the waiting jobs and the running one', async () => {
  state().addPicked([book('p1', 'a.pdf'), book('p2', 'b.pdf'), book('p3', 'c.pdf')], 0, 'x')
  await tick()
  for (const h of cancelAllHandlers) h()
  for (let i = 0; i < 10; i++) await tick()
  assert.deepEqual(jobs().map((j) => j.state), ['cancelled', 'cancelled', 'cancelled'])
})

await check('phone relaunch: the running job comes back "Interrupted", waiting jobs run in order', async () => {
  snapshot = {
    version: 1,
    jobs: [
      { id: 'j1', batchId: null, source: { kind: 'pick', pickId: 'p1' }, name: 'a.pdf', sizeBytes: 1, state: 'running', queuedAt: 1 },
      { id: 'j2', batchId: null, source: { kind: 'pick', pickId: 'p2' }, name: 'b.pdf', sizeBytes: 1, state: 'waiting', queuedAt: 2 },
    ],
  }
  fakeApi.importQueue = {
    load: async () => snapshot,
    save: async (s) => {
      savedSnapshots.push(s)
      return { ok: true }
    },
  }
  await startImportQueue()
  for (let i = 0; i < 5; i++) await tick()
  assert.equal(byName('a.pdf').state, 'interrupted')
  assert.equal(running()[0].name, 'b.pdf')
  // The pick of a restored waiting job is no longer readable → "Interrupted" (Try again opens the picker).
  await finishRunning({ ok: false, bookId: null, errorCode: 'missing_file' })
  assert.equal(byName('b.pdf').state, 'interrupted')
  assert.ok(savedSnapshots.length > 0)
  assert.ok(savedSnapshots.at(-1).jobs.every((j) => !('progress' in j) && !('bookId' in j)))
  delete fakeApi.importQueue
})

await check('spec 017: cancel / dismiss / Clear finished of a waiting pick job releases its pick', async () => {
  state().addPicked([book('p1', 'a.pdf'), book('p2', 'b.pdf'), book('p3', 'c.pdf')], 0, 'x')
  await tick()
  state().cancel(byName('b.pdf').id)
  await tick()
  assert.deepEqual(calls.find((c) => c[0] === 'releasePicks'), ['releasePicks', ['p2']], 'cancel releases the waiting pick')
  calls.length = 0
  state().dismiss(byName('b.pdf').id)
  await tick()
  assert.deepEqual(calls.filter((c) => c[0] === 'releasePicks').map((c) => c[1]), [['p2']], 'dismiss releases (ignored when used)')
  state().cancel(byName('c.pdf').id)
  calls.length = 0
  state().clearFinished()
  await tick()
  const released = calls.filter((c) => c[0] === 'releasePicks').flatMap((c) => c[1])
  assert.ok(released.includes('p3'), 'clear finished releases the cleared jobs')
  await finishRunning({ ok: true, bookId: 'A' })
})

await check('spec 017: Main holds a pick with no time limit; beyond 500 the oldest is released', async () => {
  const picks = await import('../../ipc/picked-files.ts')
  const realNow = Date.now
  try {
    const first = picks.holdPickedFile('C:/books/first.pdf')
    Date.now = () => realNow() + 31 * 60 * 1000 // 31 minutes later
    assert.equal(picks.takePickedFile(first), 'C:/books/first.pdf', 'still taken after 30 min')
    const ids = []
    for (let i = 0; i < picks.MAX_HELD_PICKS + 1; i++) ids.push(picks.holdPickedFile(`C:/books/${i}.pdf`))
    assert.equal(picks.heldPickCount(), picks.MAX_HELD_PICKS)
    assert.equal(picks.takePickedFile(ids[0]), null, 'the oldest was released: its job fails as "pick the file again"')
    assert.equal(picks.releasePicks([ids[1], ids[2], 'unknown', 42]), 2)
    assert.equal(picks.takePickedFile(ids[1]), null)
    assert.equal(picks.takePickedFile(ids.at(-1)), `C:/books/${picks.MAX_HELD_PICKS}.pdf`)
    picks.releasePicks(ids)
  } finally {
    Date.now = realNow
  }
})

console.log(`spike:import:queue — ${passed} checks passed`)
