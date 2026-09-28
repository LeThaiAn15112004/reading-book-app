/**
 * Worker-thread entry: hosts the translation model. Built as its own bundle entry (see
 * vite.config.ts) and started by translation-service.ts. Must not import `electron`.
 *
 * ONNX inference is seconds of solid CPU per paragraph — on the Main thread it would freeze every
 * window. Here it only blocks this thread, and the SDK's `LocalTranslationService` serializes
 * requests, so two quick selections never run two inferences side by side.
 */
import { parentPort, workerData } from 'node:worker_threads'
import {
  LocalTranslationService,
  createConsoleLogger,
  isSdkError,
  type TranslationLoadProgress,
} from '@reading-book/book-reader-sdk'
import { createTransformersTranslationEngineLoader } from '../../../book-reader-sdk/host-adapters/translation'
import type { TranslationErrorCode } from '../ipc/api-types'
import type {
  TranslationWorkerData,
  TranslationWorkerMessage,
  TranslationWorkerRequest,
} from './translation-job'

/** Free the model after this long without a request; the next one reloads it from disk cache. */
const IDLE_UNLOAD_MS = 5 * 60_000
/** Byte-progress events arrive per network chunk — forward at most this often per request. */
const PROGRESS_INTERVAL_MS = 120

const KNOWN_CODES = new Set<TranslationErrorCode>([
  'NETWORK_UNAVAILABLE',
  'MODEL_LOAD_FAILED',
  'TRANSLATION_FAILED',
  'INVALID_ARGUMENT',
  'ABORTED',
])

const { cacheDir } = workerData as TranslationWorkerData
const logger = createConsoleLogger('[translation-worker]')
const loadEngine = createTransformersTranslationEngineLoader({ cacheDir })
const inflight = new Map<string, AbortController>()

/**
 * One resident model at a time: an OPUS pair is a few hundred MB of RAM, NLLB over a GB. Switching
 * language pair disposes the previous model once its running inference drains (its queued
 * requests reject with DISPOSED — the renderer has already moved on from them).
 */
let resident: LocalTranslationService | null = null

function serviceFor(modelId: string): LocalTranslationService {
  if (resident && resident.modelId === modelId && resident.status !== 'disposed') return resident
  const previous = resident
  resident = new LocalTranslationService({ loadEngine, modelId, idleUnloadMs: IDLE_UNLOAD_MS, logger })
  if (previous) void previous.dispose()
  return resident
}

function post(message: TranslationWorkerMessage): void {
  parentPort?.postMessage(message)
}

function throttledProgress(id: string, modelId: string): (event: TranslationLoadProgress) => void {
  let lastSent = 0
  return (event) => {
    const isByteProgress = event.status === 'progress' || event.status === 'total'
    const now = Date.now()
    const finished = event.progress !== undefined && event.progress >= 100
    if (isByteProgress && !finished && now - lastSent < PROGRESS_INTERVAL_MS) return
    lastSent = now
    post({ type: 'progress', id, modelId, event })
  }
}

async function translate(request: Extract<TranslationWorkerRequest, { type: 'translate' }>): Promise<void> {
  const { id, text, route } = request
  const controller = new AbortController()
  inflight.set(id, controller)
  try {
    const result = await serviceFor(route.modelId).translate({
      text,
      sourceLang: route.sourceLang,
      targetLang: route.targetLang,
      signal: controller.signal,
      onLoadProgress: throttledProgress(id, route.modelId),
    })
    post({ type: 'result', id, text: result.text, modelId: result.modelId, durationMs: result.durationMs })
  } catch (error) {
    const code: TranslationErrorCode =
      isSdkError(error) && KNOWN_CODES.has(error.code as TranslationErrorCode)
        ? (error.code as TranslationErrorCode)
        : isSdkError(error) && error.code === 'DISPOSED'
          ? 'ABORTED'
          : 'TRANSLATION_FAILED'
    const message = error instanceof Error ? error.message : String(error)
    if (code !== 'ABORTED') logger.warn('translation failed', { code, message, modelId: route.modelId })
    post({ type: 'error', id, code, message })
  } finally {
    inflight.delete(id)
  }
}

parentPort?.on('message', (request: TranslationWorkerRequest) => {
  if (request.type === 'cancel') {
    inflight.get(request.id)?.abort()
    return
  }
  void translate(request)
})
