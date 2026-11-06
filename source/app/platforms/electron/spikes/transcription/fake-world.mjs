import assert from 'node:assert/strict'

/**
 * Fakes shared by the transcription spikes (spec 004): a library with single-file and multi-track audiobooks, a decoder that
 * returns silence of the right length, a speech process whose behaviour a test scripts (gate / failure / plan), a model
 * manager, and the event sinks of the service. Nothing here is the system under test.
 */
const SAMPLES_PER_MS = 16   // 16 kHz mono
export function makeFakeWorld(spec) {
  // spec: { books: { [bookId]: { format, durationMs, tracks?: [{ id, title, durationMs }] } }, speechPlan?: (call) => ..., hangAt?: n }
  const world = {
    decodeCalls: [], speechCalls: [], concurrent: 0, maxConcurrent: 0, disposed: 0, stops: 0, removed: [], downloads: [],
    installed: new Set(['whisper-tiny']), decoderAvailable: { available: true, executablePath: '/ffmpeg' },
    events: { progress: [], passagesAdded: [], modelProgress: [] }, clock: 0, speechGate: null, onSpeech: null,
  }
  const durationOfPath = (p) => {
    const [, , bookId, which] = p.split('/')
    const book = spec.books[bookId]
    if (!book) return 0
    if (which === 'main') return book.durationMs
    return book.tracks.find((t) => t.id === which).durationMs
  }
  world.source = {
    findBook: async (id) => (spec.books[id] ? { id, format: spec.books[id].format } : undefined),
    listTracks: (id) => (spec.books[id]?.tracks ?? []).map((t) => ({ id: t.id, title: t.title, durationMs: t.known === false ? null : t.durationMs })),
    resolveFile: async (id, trackId) => (spec.books[id] && !spec.books[id].missingFile ? { ok: true, path: `/fake/${id}/${trackId ?? 'main'}` } : { ok: false }),
    probeDurationMs: async (p) => durationOfPath(p) || null,
    languageTag: (id) => spec.books[id]?.languageTag,
  }
  world.decoder = {
    availability: async () => world.decoderAvailable,
    decodeWindow: async ({ filePath, startMs, lengthMs, signal }) => {
      world.decodeCalls.push({ filePath, startMs, lengthMs })
      world.concurrent += 1; world.maxConcurrent = Math.max(world.maxConcurrent, world.concurrent)
      try {
        await new Promise((r) => setImmediate(r))
        if (signal?.aborted) { const e = new Error('aborted'); e.code = 'ABORTED'; throw e }
        const total = durationOfPath(filePath)
        const len = Math.max(0, Math.min(lengthMs, total - startMs))
        return new Float32Array(len * SAMPLES_PER_MS)
      } finally { world.concurrent -= 1 }
    },
  }
  world.speech = {
    transcribe: async (request, { signal } = {}) => {
      const call = world.speechCalls.length + 1
      const windowMs = Math.round(request.samples.length / SAMPLES_PER_MS)
      world.speechCalls.push({ call, modelId: request.modelId, language: request.language, windowMs })
      world.concurrent += 1; world.maxConcurrent = Math.max(world.maxConcurrent, world.concurrent)
      try {
        await world.onSpeech?.(call, windowMs, signal)
        if (world.speechGate) await Promise.race([world.speechGate.promise, new Promise((_, rej) => signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.code = 'ABORTED'; rej(e) }, { once: true }))])
        if (signal?.aborted) { const e = new Error('aborted'); e.code = 'ABORTED'; throw e }
        const plan = spec.speechPlan?.(call, windowMs)
        if (plan === 'none') return { modelId: request.modelId, segments: [], loadMs: 1, transcribeMs: 1 }
        const segments = plan ?? [{ startMs: 0, endMs: Math.min(5000, windowMs), text: `seg${call}` }]
        return { modelId: request.modelId, segments, loadMs: 1, transcribeMs: 1 }
      } finally { world.concurrent -= 1 }
    },
    dispose: () => { world.disposed += 1 },
    stop: () => { world.stops += 1; return world.stopRefused !== true },
  }
  world.models = {
    catalog: [{ id: 'whisper-tiny' }, { id: 'whisper-base' }],
    list: async () => world.models.catalog.map((m) => ({ id: m.id, label: m.id, sizeBytes: 1, installed: world.installed.has(m.id) })),
    isInstalled: async (id) => world.installed.has(id),
    remove: async (id) => { world.removed.push(id); if (world.removeError) throw world.removeError; world.installed.delete(id) },
    download: async (id, { onProgress } = {}) => { world.downloads.push(id); onProgress?.({ modelId: id, loadedBytes: 1, totalBytes: 2 }); if (world.downloadError) throw world.downloadError; world.installed.add(id) },
  }
  world.emitters = {
    progress: (j) => world.events.progress.push({ ...j, at: world.clock }),
    passagesAdded: (a) => world.events.passagesAdded.push(a),
    modelProgress: (p) => world.events.modelProgress.push(p),
  }
  return world
}
export function makeService(createTranscriptionService, world, store, extra = {}) {
  return createTranscriptionService({
    store, speech: world.speech, decoder: world.decoder, models: world.models, source: world.source, events: world.emitters,
    now: () => (world.clock += 100), ...extra,
  })
}
export const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
export async function until(predicate, label, timeoutMs = 4000) {
  const t0 = Date.now()
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) assert.fail(`timed out waiting for: ${label}`)
    await sleepMs(5)
  }
}
export const lastJobState = (world, bookId) => [...world.events.progress].reverse().find((j) => j.bookId === bookId)

