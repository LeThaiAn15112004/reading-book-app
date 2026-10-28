/**
 * The renderer's audiobook ZIP import store (the REAL zustand store behind the preview dialog, the "Audiobook ZIP" entry
 * and the job / result panel) against a scripted `window.api.zipImport`, so every Main-side outcome can be produced on demand.
 *
 *   1. background   "Import" closes the dialog at once and runs a background job (spinner label, progress, panel)
 *   2. finish       done → the audio files that were imported are listed; one-track fallback; dismiss
 *   3. stop         cancel while running; cancelled / duplicate resolve without a panel
 *   4. failure      error panel, "Review & retry" returns to the same selection, no retry for an expired session
 *   5. guards       one ZIP at a time; late progress after the end is ignored; the dialog's own paths still work
 *
 * Run: npm run spike:audio:zip-store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const tick = () => new Promise((r) => setTimeout(r, 0))

// ---- scripted window.api ----
const calls = { pick: 0, inspectPicked: 0, confirm: [], discard: [], cancelImport: 0, coverPreview: [], getTracks: [] }
let progressHandlers = new Set()
let inspectingHandlers = new Set()
let nextPick = null
let pendingConfirm = null // { resolve, reject }
let tracksFor = {}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
globalThis.window = {
  api: {
    zipImport: {
      pick: async () => {
        calls.pick += 1
        return nextPick
      },
      inspectPicked: async () => {
        calls.inspectPicked += 1
        return nextPick
      },
      coverPreview: async (input) => {
        calls.coverPreview.push(input)
        return { ok: true, dataUrl: null }
      },
      confirm: (input) => {
        calls.confirm.push(structuredClone(input))
        pendingConfirm = deferred()
        return pendingConfirm.promise
      },
      discard: async (id) => {
        calls.discard.push(id)
        return { ok: true }
      },
      cancelInspect: async () => ({ ok: true }),
      cancelImport: async () => {
        calls.cancelImport += 1
        return { ok: true }
      },
      onProgress: (handler) => {
        progressHandlers.add(handler)
        return () => progressHandlers.delete(handler)
      },
      onInspecting: (handler) => {
        inspectingHandlers.add(handler)
        return () => inspectingHandlers.delete(handler)
      },
    },
    audio: {
      getTracks: async (id) => {
        calls.getTracks.push(id)
        return tracksFor[id] ?? { ok: true, tracks: [] }
      },
    },
  },
}
const emitProgress = (p) => [...progressHandlers].forEach((h) => h(p))

const { useZipImportStore, zipJobShortLabel, zipJobDetail } = await import('../../src/hooks/library/zipImportStore.ts')
const { useLibraryImportStore } = await import('../../src/hooks/library/libraryImportStore.ts')
const Z = () => useZipImportStore.getState()

const entry = (id, name) => ({ id, path: name, name, kind: 'audio', size: 10, status: 'ok', eligible: true })
const preview = (sessionId = 's1', n = 3, extra = {}) => ({
  sessionId,
  archiveName: 'My Book.zip',
  entries: [...Array.from({ length: n }, (_, i) => entry(`e${i}`, `${String(i + 1).padStart(2, '0')} - Part ${i + 1}.mp3`)), { id: 'img', path: 'cover.jpg', name: 'cover.jpg', kind: 'image', size: 5, status: 'ignored', eligible: false }],
  trackOrder: Array.from({ length: n }, (_, i) => `e${i}`),
  coverCandidates: ['img'],
  defaultCoverId: 'img',
  warnings: [],
  ...extra,
})
async function openPreview(p = preview()) {
  nextPick = { ok: true, preview: p }
  await Z().start()
  assert.equal(Z().phase, 'preview')
}
function reset() {
  useZipImportStore.setState({ phase: 'closed', preview: null, job: null, panelOpen: false, error: null, importedNonce: 0 })
  useLibraryImportStore.setState({ toast: null, conflict: null })
  calls.confirm.length = 0
  calls.discard.length = 0
  calls.cancelImport = 0
  calls.getTracks.length = 0
  calls.coverPreview.length = 0
  calls.pick = 0
  progressHandlers = new Set()
  tracksFor = {}
  pendingConfirm = null
}

console.log('1. background import')
await check('"Import" closes the dialog AT ONCE and starts a background job; the app is not blocked while Main works', async () => {
  reset()
  await openPreview()
  const done = Z().confirm()
  // synchronous part: the dialog is gone before Main answers
  assert.deepEqual([Z().phase, Z().preview, Z().job?.status, Z().job?.total, Z().panelOpen], ['closed', null, 'running', 3, false])
  assert.equal(Z().job.archiveName, 'My Book.zip')
  assert.deepEqual(calls.confirm, [{ sessionId: 's1', selection: { trackIds: ['e0', 'e1', 'e2'], coverId: 'img' } }])
  let settled = false
  void done.then(() => (settled = true))
  await tick()
  assert.equal(settled, false, 'the import is still running (confirm has not resolved)')
  pendingConfirm.resolve({ ok: true, bookId: 'book-1' })
  await done
})

await check('progress reaches the entry label (12/68, Saving…) and the panel detail; a stop request shows Cancelling…', async () => {
  reset()
  await openPreview(preview('s2', 68))
  const done = Z().confirm()
  assert.equal(zipJobShortLabel(Z().job), '0/68')
  assert.equal(zipJobDetail(Z().job), 'Starting…')
  emitProgress({ stage: 'extracting', done: 12, total: 68, name: '13.mp3' })
  assert.equal(zipJobShortLabel(Z().job), '12/68')
  assert.equal(zipJobDetail(Z().job), 'Track 13 of 68 — 13.mp3')
  emitProgress({ stage: 'saving', done: 68, total: 68 })
  assert.equal(zipJobShortLabel(Z().job), 'Saving…')
  assert.equal(zipJobDetail(Z().job), 'Saving to your library…')
  await Z().cancelJob()
  assert.equal(zipJobShortLabel(Z().job), 'Cancelling…')
  pendingConfirm.resolve({ ok: false, errorCode: 'cancelled', errorMessage: 'x' })
  await done
})

console.log('2. finishing')
await check('done: the job lists the audio files that were imported (titles + durations, in order), opens the panel, reloads the library', async () => {
  reset()
  await openPreview()
  tracksFor['book-9'] = { ok: true, tracks: [{ id: 'a', title: 'Intro', durationSeconds: 61 }, { id: 'b', title: 'Part two', durationSeconds: null }, { id: 'c', title: 'End', durationSeconds: 3700 }] }
  const done = Z().confirm()
  pendingConfirm.resolve({ ok: true, bookId: 'book-9' })
  await done
  const job = Z().job
  assert.deepEqual([job.status, job.bookId, Z().panelOpen, Z().importedNonce], ['done', 'book-9', true, 1])
  assert.deepEqual(job.tracks, [{ title: 'Intro', durationSeconds: 61 }, { title: 'Part two', durationSeconds: null }, { title: 'End', durationSeconds: 3700 }])
  assert.deepEqual(calls.getTracks, ['book-9'])
  Z().dismissJob()
  assert.deepEqual([Z().job, Z().panelOpen], [null, false])
})

await check('a one-track import (an ordinary book, no track list) falls back to the selected file name', async () => {
  reset()
  await openPreview(preview('s3', 1))
  const done = Z().confirm()
  pendingConfirm.resolve({ ok: true, bookId: 'solo' })
  await done
  assert.deepEqual(Z().job.tracks, [{ title: '01 - Part 1', durationSeconds: null }])
  assert.equal(Z().job.status, 'done')
  Z().dismissJob()
})

console.log('3. stopping')
await check('cancelJob asks Main once; the cancelled answer leaves no panel and no book, drops the session and says so', async () => {
  reset()
  await openPreview()
  const done = Z().confirm()
  await Z().cancelJob()
  await Z().cancelJob()
  assert.equal(calls.cancelImport, 1)
  assert.equal(Z().job.cancelling, true)
  pendingConfirm.resolve({ ok: false, errorCode: 'cancelled', errorMessage: 'Import cancelled.' })
  await done
  assert.deepEqual([Z().job, Z().panelOpen, Z().importedNonce], [null, false, 0])
  assert.deepEqual(calls.discard, ['s1'])
  assert.match(useLibraryImportStore.getState().toast.message, /cancelled/i)
})

await check('duplicate: the Library\'s "already in your library — open it?" dialog is used; no job panel', async () => {
  reset()
  await openPreview()
  const done = Z().confirm()
  pendingConfirm.resolve({ ok: false, errorCode: 'duplicate', errorMessage: 'This audiobook is already in your local library.', bookId: 'old-book' })
  await done
  assert.deepEqual([Z().job, Z().panelOpen], [null, false])
  assert.equal(useLibraryImportStore.getState().conflict.bookId, 'old-book')
  assert.deepEqual(calls.discard, ['s1'])
})

console.log('4. failure')
await check('a failure opens an error panel with the reason; "Review & retry" returns to the SAME selection; nothing was added', async () => {
  reset()
  await openPreview()
  Z().toggleTrack('e1') // the user unticked one
  const selected = [...Z().selection.trackIds]
  const done = Z().confirm()
  pendingConfirm.resolve({ ok: false, errorCode: 'insufficient_space', errorMessage: 'There is not enough free disk space to import this audiobook.' })
  await done
  const job = Z().job
  assert.deepEqual([job.status, job.error.code, Z().panelOpen, Z().importedNonce], ['failed', 'insufficient_space', true, 0])
  assert.ok(job.retry)
  const coverRequests = calls.coverPreview.length
  Z().reviewAndRetry()
  assert.deepEqual([Z().phase, Z().job, Z().panelOpen, Z().preview.sessionId], ['preview', null, false, 's1'])
  assert.deepEqual(Z().selection.trackIds, selected)
  assert.deepEqual(calls.coverPreview.slice(coverRequests), [{ sessionId: 's1', entryId: 'img' }], 'the default cover preview is loaded again')
  await Z().cancel()
})

await check('an expired or changed ZIP cannot be retried; an exception while importing can; dismissing a failure drops the kept session', async () => {
  reset()
  await openPreview()
  let done = Z().confirm()
  pendingConfirm.resolve({ ok: false, errorCode: 'archive_changed', errorMessage: 'The ZIP file changed after it was opened. Choose it again.' })
  await done
  assert.equal(Z().job.status, 'failed')
  assert.equal(Z().job.retry, undefined)
  Z().dismissJob()
  assert.equal(Z().job, null)

  reset()
  await openPreview()
  done = Z().confirm()
  pendingConfirm.reject(new Error('IPC went away'))
  await done
  assert.deepEqual([Z().job.status, Z().job.error.code, Boolean(Z().job.retry)], ['failed', 'import_failed', true])
  Z().dismissJob()
  assert.deepEqual(calls.discard, ['s1'], 'the preview session kept for a retry is dropped on dismiss')
})

console.log('5. guards')
await check('one ZIP at a time: starting another while one imports does not open a picker; it says so and shows the running import', async () => {
  reset()
  await openPreview()
  const done = Z().confirm()
  const picks = calls.pick
  await Z().start()
  await Z().startFromPicked()
  assert.equal(calls.pick, picks)
  assert.equal(calls.inspectPicked, 0)
  assert.match(useLibraryImportStore.getState().toast.message, /already running/i)
  assert.equal(Z().panelOpen, true)
  // confirming again is ignored too
  Z().setPanelOpen(false)
  await Z().confirm()
  assert.equal(calls.confirm.length, 1)
  pendingConfirm.resolve({ ok: true, bookId: 'b' })
  await done
})

await check('late progress after the job ended changes nothing', async () => {
  reset()
  await openPreview()
  const done = Z().confirm()
  pendingConfirm.resolve({ ok: true, bookId: 'b-late' })
  await done
  emitProgress({ stage: 'extracting', done: 1, total: 3 })
  assert.equal(Z().job.progress, null)
  assert.equal(Z().job.status, 'done')
})

await check('the dialog itself is unchanged: a dismissed picker stays silent, an unreadable ZIP shows the error view, Cancel drops the session', async () => {
  reset()
  nextPick = { ok: false, errorCode: 'cancelled', errorMessage: 'Cancelled.' }
  await Z().start()
  assert.deepEqual([Z().phase, Z().job], ['closed', null])
  nextPick = { ok: false, errorCode: 'invalid_zip', errorMessage: 'This file is not a valid ZIP archive, or it is damaged.' }
  await Z().start()
  assert.deepEqual([Z().phase, Z().error.code], ['error', 'invalid_zip'])
  await Z().cancel()
  await openPreview()
  await Z().cancel()
  assert.deepEqual([Z().phase, Z().preview], ['closed', null])
  assert.deepEqual(calls.discard, ['s1'])
})

console.log(`\n${passed} checks passed`)
process.exit(0)
