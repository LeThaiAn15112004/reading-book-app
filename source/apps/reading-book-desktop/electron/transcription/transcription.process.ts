/**
 * Entry of the speech PROCESS (spec 004, research R11, task T014 as amended by owner decision A). Built as its own
 * bundle entry (vite.config.ts) and started by `speech-process-host.ts` as a child process (`child_process.fork` of
 * Electron's own binary with `ELECTRON_RUN_AS_NODE`, or an Electron `utilityProcess` — it speaks to either).
 * Must not import `electron`.
 *
 * Why a process and not a worker thread: ONNX inference is seconds of solid CPU per 30 s window, and the one call
 * that is running cannot be interrupted. A thread that is terminated while ONNX Runtime executes takes the whole app
 * down with a native exception; a process can simply be killed. Requests are served one at a time, in order; the
 * resident model is freed after a quiet period (the host also kills an idle process).
 */
import { createConsoleLogger } from '@reading-book/book-reader-sdk'
import { ModelError } from './model-manager'
import type { SpeechMessage, SpeechProcessData, SpeechRequest } from './transcription-job'
import { createWhisperEngine } from './whisper-engine'

/** Free the model after this long without a request; the next one reloads it from disk (verified again). */
const IDLE_UNLOAD_MS = 5 * 60_000

const data = JSON.parse(process.argv[2] ?? '{}') as Partial<SpeechProcessData>
if (!data.modelsDir) {
  console.error('[transcription-process] missing modelsDir argument')
  process.exit(2)
}
const logger = createConsoleLogger('[transcription-process]')
const engine = createWhisperEngine({ modelsDir: data.modelsDir, blockNetwork: data.blockNetwork })
const inflight = new Map<string, AbortController>()

// Transport: an Electron utilityProcess has `process.parentPort`; a forked child has the IPC channel.
type ParentPort = { postMessage(message: unknown): void; on(event: 'message', handler: (event: { data: unknown }) => void): void }
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

function post(message: SpeechMessage): void {
  if (parentPort) parentPort.postMessage(message)
  else process.send?.(message)
}

let queue: Promise<void> = Promise.resolve()
let idleTimer: ReturnType<typeof setTimeout> | null = null

function scheduleUnload(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    void engine.dispose()
  }, IDLE_UNLOAD_MS)
  idleTimer.unref?.()
}

async function transcribe(request: Extract<SpeechRequest, { type: 'transcribe' }>, controller: AbortController): Promise<void> {
  const { id, modelId, language, samples } = request
  try {
    if (controller.signal.aborted) throw new ModelError('ABORTED', 'Transcription aborted')
    if (idleTimer) clearTimeout(idleTimer)

    const loadStarted = Date.now()
    await engine.load(modelId, (stage) => post({ type: 'stage', id, stage }))
    const loadMs = Date.now() - loadStarted

    post({ type: 'stage', id, stage: 'transcribing' })
    const started = Date.now()
    const segments = await engine.transcribe(samples, { language, signal: controller.signal })
    post({ type: 'result', id, modelId, segments, loadMs, transcribeMs: Date.now() - started })
  } catch (error) {
    if (error instanceof ModelError) {
      if (error.code !== 'ABORTED') logger.warn('transcription failed', { code: error.code, message: error.message, modelId })
      post({ type: 'error', id, code: error.code, message: error.message })
    } else {
      const message = error instanceof Error ? error.message : String(error)
      // An abort that surfaced as a generic error still counts as an abort.
      const code = controller.signal.aborted ? 'ABORTED' : 'DECODE_FAILED'
      if (code !== 'ABORTED') logger.warn('transcription failed', { code, message, modelId })
      post({ type: 'error', id, code, message })
    }
  } finally {
    inflight.delete(id)
    scheduleUnload()
  }
}

function handle(request: SpeechRequest): void {
  if (request.type === 'cancel') {
    inflight.get(request.id)?.abort()
    return
  }
  if (request.type === 'dispose') {
    queue = queue.then(() => engine.dispose())
    return
  }
  const controller = new AbortController()
  inflight.set(request.id, controller)
  queue = queue.then(() => transcribe(request, controller))
}

if (parentPort) {
  parentPort.on('message', (event) => handle(event.data as SpeechRequest))
} else {
  process.on('message', (message) => handle(message as SpeechRequest))
  // The parent went away: nobody is waiting for us any more.
  process.on('disconnect', () => process.exit(0))
}
