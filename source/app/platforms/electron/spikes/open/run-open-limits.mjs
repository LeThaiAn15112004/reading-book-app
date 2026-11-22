/**
 * Spec 017 (US1, T011 / T025): the REAL renderer `readerOpeningStore` with an injected clock and foreground source —
 * automated, Node only, no DOM.
 *
 *   npm run spike:open:limits
 *
 * Checks (SC-002, FR-001 – FR-005, FR-008):
 *   1. a step that never answers fails "took too long" after 20 s of foreground time, with the right actions;
 *   2. time in the background does not count, nor does a burst of ticks after coming back;
 *   3. a saved position that hangs falls back after 3 s (chapter start + note), never an error;
 *   4. leaving mid-step aborts the opening's signal, releases the 016 gate at once and leaves no timer running;
 *   5. an answer with an older token is ignored (only the latest opening runs);
 *   6. a passing failure is retried once and the book then opens with no error;
 *   7. timing lines carry the step / outcome with format + size only.
 */
import assert from 'node:assert/strict'

const timing = []
let gateCalls = []
globalThis.window = {
  api: {
    setReaderOpening: async (bookId) => {
      gateCalls.push(bookId)
      return { ok: true }
    },
    getTimingEnabled: async () => true,
    recordTiming: async (line) => {
      timing.push(typeof line === 'string' ? JSON.parse(line) : line)
      return { ok: true }
    },
  },
}

const store = await import('../../../../hooks/reader/readerOpeningStore.ts')
const signal = await import('../../../../hooks/reader/firstPageSignal.ts')
const { primeStepTimer } = await import('../../../../hooks/app/stepTimer.ts')
const { bookOpening } = await import('../../../../../core/src/index.ts')

primeStepTimer()
await new Promise((r) => setTimeout(r, 20))

let now = 0
store.setClock(() => now)
let setActive = () => {}
store.setForegroundSource((onChange) => {
  setActive = onChange
  return () => {}
})

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const current = () => store.useReaderOpeningStore.getState().current
const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(['PASS', name])
  } catch (error) {
    results.push(['FAIL', name, error?.message ?? String(error)])
  }
}

await check('1. a hanging step fails "took too long" after 20 s with Try again / Open from the beginning / Back', async () => {
  const token = store.beginBookOpening({ bookId: 'b1', usesSavedPosition: true })
  now += 20_000
  await wait()
  assert.equal(current().outcome, 'pending', 'not before 20 000 ms')
  now += 2
  await wait()
  assert.equal(current().outcome, 'failed')
  assert.deepEqual(current().error, { cause: 'took_too_long', step: 'content' })
  assert.deepEqual(bookOpening.actionsFor(current().error, { host: 'desktop', usesSavedPosition: current().usesSavedPosition }), [
    'tryAgain',
    'fromBeginning',
    'back',
  ])
  assert.equal(store.isCurrentOpening(token), false)
})

await check('2. background time and a burst of ticks after it do not count', async () => {
  store.beginBookOpening({ bookId: 'b2' })
  const fgStart = store.foregroundNow()
  now += 5_000
  setActive(false)
  now += 60_000
  await wait()
  assert.equal(current().outcome, 'pending', 'still pending while in the background')
  setActive(true)
  await wait(400) // several ticks fire on return
  assert.equal(current().outcome, 'pending', 'still pending right after coming back')
  const fg = store.foregroundNow() - fgStart
  assert.ok(fg < 6_000, `foreground ${fg} ms counts only foreground time`)
  now += 15_001
  await wait()
  assert.equal(current().outcome, 'failed', 'fails once 20 s of FOREGROUND time passed')
})

await check('3. a hanging saved position falls back after 3 s, no error', async () => {
  const token = store.beginBookOpening({ bookId: 'b3', usesSavedPosition: true })
  store.reportContentReady(token, 'epub', 1234)
  store.reportPositionStarted()
  now += 3_001
  await wait()
  assert.equal(current().outcome, 'pending')
  assert.equal(current().step, 'firstPage')
  assert.equal(current().positionRestored, false)
  store.leaveBookOpening()
})

await check('4. leaving mid-step aborts the signal, releases the gate at once, no timer left', async () => {
  gateCalls = []
  store.beginBookOpening({ bookId: 'b4' })
  signal.beginOpening('b4')
  assert.equal(store.useReaderOpeningStore.getState().opening, 'b4', 'gate set')
  const s = store.openingSignal()
  store.leaveBookOpening()
  assert.equal(s.aborted, true, 'signal aborted')
  assert.equal(current().outcome, 'left')
  assert.equal(store.useReaderOpeningStore.getState().opening, null, 'gate released without waiting 10 s')
  assert.deepEqual(gateCalls.map((c) => (c && typeof c === 'object' ? c.bookId : c)), ['b4', null])
  now += 60_000
  await wait()
  assert.equal(current().outcome, 'left', 'nothing changes after leaving (ticker stopped)')
  store.leaveBookOpening()
  assert.equal(current().outcome, 'left', 'idempotent')
})

await check('5. an older token is ignored; the latest opening runs', async () => {
  const t1 = store.beginBookOpening({ bookId: 'b5' })
  const t2 = store.beginBookOpening({ bookId: 'b6' })
  assert.notEqual(t1, t2)
  assert.equal(store.isCurrentOpening(t1), false)
  store.reportContentReady(t1, 'pdf', 1)
  assert.equal(current().bookId, 'b6')
  assert.equal(current().step, 'content', 'the late answer of the first opening changed nothing')
  assert.equal(store.reportContentFailed(t1, 'read_failed', true), false)
  store.leaveBookOpening()
})

await check('6. a passing failure is retried once, then the book opens with no error', async () => {
  const token = store.beginBookOpening({ bookId: 'b7' })
  signal.beginOpening('b7')
  assert.equal(store.reportContentFailed(token, 'read_failed', true), true, 'retry asked')
  assert.equal(current().outcome, 'pending')
  store.reportContentReady(token, 'txt', 10)
  signal.markFirstPageDrawn()
  assert.equal(current().outcome, 'opened')
  assert.equal(current().error, null)
  const second = store.beginBookOpening({ bookId: 'b8' })
  assert.equal(store.reportContentFailed(second, 'missing_file', true), false, 'a missing file is never retried')
  assert.equal(current().error.cause, 'missing_file')
})

await check('7. timing lines: steps and outcomes, format + size only', async () => {
  await wait(50)
  const steps = new Set(timing.map((t) => t.step))
  for (const step of ['open-content', 'open-failed-took_too_long', 'open-left', 'open-position', 'open-failed-missing_file']) {
    assert.ok(steps.has(step), `has ${step}`)
  }
  for (const t of timing) {
    assert.deepEqual(Object.keys(t).sort(), ['at', 'flow', 'format', 'host', 'ms', 'sizeBytes', 'step'])
  }
})

store.leaveBookOpening()
for (const r of results) console.log(r.join(' — '))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(failed ? `spike:open:limits — ${failed} FAILED` : `spike:open:limits — all ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
