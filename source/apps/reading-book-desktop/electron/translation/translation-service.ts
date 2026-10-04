import { app, type WebContents } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { resolveTranslationRoute, sanitizeTranslationInput } from '@reading-book/book-reader-sdk'
import { TranslationChannels } from '../ipc/channels'
import type {
  TranslateRequestDto,
  TranslateResultDto,
  TranslationErrorCode,
  TranslationProgressDto,
} from '../ipc/api-types'
import type { TranslationWorkerData, TranslationWorkerMessage, TranslationWorkerRequest } from './translation-job'

/** Emitted next to main.js by the extra bundle entry in vite.config.ts. */
const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'translation.worker.js')

/** JS heap only — ONNX weights live in native memory outside this limit. */
const WORKER_HEAP_LIMIT_MB = 1024
/** Matches `LocalTranslationService`'s default input cap — reject before crossing threads. */
const MAX_INPUT_CHARS = 20_000

type Pending = {
  resolve: (result: TranslateResultDto) => void
  sender: WebContents
}

let worker: Worker | null = null
const pending = new Map<string, Pending>()

function fail(code: TranslationErrorCode, message: string): TranslateResultDto {
  return { state: 'error', code, message }
}

function failAllPending(message: string): void {
  for (const entry of pending.values()) entry.resolve(fail('WORKER_FAILED', message))
  pending.clear()
}

function handleWorkerMessage(message: TranslationWorkerMessage): void {
  const entry = pending.get(message.id)
  if (!entry) return
  if (message.type === 'progress') {
    if (entry.sender.isDestroyed()) return
    const progress: TranslationProgressDto = { requestId: message.id, modelId: message.modelId, ...message.event }
    entry.sender.send(TranslationChannels.progress, progress)
    return
  }
  pending.delete(message.id)
  entry.resolve(
    message.type === 'result'
      ? { state: 'ok', text: message.text, modelId: message.modelId, durationMs: message.durationMs }
      : fail(message.code, message.message),
  )
}

/** Directory where downloaded translation models persist (`<org>/<model>` sub-folders). */
export function getTranslationModelsDir(): string {
  return path.join(app.getPath('userData'), 'models')
}

/**
 * Stop the idle worker so no loaded model keeps its files in use (before removing a model). The
 * next translation respawns it. Returns false while a translation is pending.
 */
export function releaseTranslationWorker(): boolean {
  if (pending.size > 0) return false
  const current = worker
  worker = null
  if (current) void current.terminate()
  return true
}

/** Started on the first translation, never at app launch. */
function ensureWorker(): Worker {
  if (worker) return worker
  const data: TranslationWorkerData = { cacheDir: getTranslationModelsDir() }
  const created = new Worker(WORKER_PATH, {
    workerData: data,
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_LIMIT_MB },
  })
  created.on('message', handleWorkerMessage)
  created.on('error', (err) => {
    if (worker === created) worker = null
    failAllPending(`Translation worker crashed: ${err.message}`)
  })
  created.on('exit', (code) => {
    // A crash / OOM: the next request respawns a fresh worker.
    if (worker === created) worker = null
    failAllPending(`Translation worker exited with code ${code}`)
  })
  worker = created
  return created
}

function post(message: TranslationWorkerRequest): void {
  ensureWorker().postMessage(message)
}

export function translate(request: TranslateRequestDto, sender: WebContents): Promise<TranslateResultDto> {
  const { requestId, text, sourceLang, targetLang } = request
  if (sourceLang === targetLang) {
    return Promise.resolve(fail('SAME_LANGUAGE', 'Source and target language are the same.'))
  }
  const route = resolveTranslationRoute(sourceLang, targetLang)
  if (!route) {
    return Promise.resolve(fail('UNSUPPORTED_LANGUAGE', `No model for ${sourceLang} → ${targetLang}.`))
  }
  const clean = sanitizeTranslationInput(text)
  if (!clean) return Promise.resolve(fail('INVALID_ARGUMENT', 'Nothing to translate.'))
  if (clean.length > MAX_INPUT_CHARS) {
    return Promise.resolve(
      fail('INVALID_ARGUMENT', `Selection is too long (${clean.length} characters, limit ${MAX_INPUT_CHARS}).`),
    )
  }
  // A reused id would orphan the earlier promise — settle it first.
  pending.get(requestId)?.resolve(fail('ABORTED', 'Superseded by a newer request.'))

  return new Promise<TranslateResultDto>((resolve) => {
    pending.set(requestId, { resolve, sender })
    try {
      post({ type: 'translate', id: requestId, text: clean, route })
    } catch (err) {
      pending.delete(requestId)
      resolve(fail('WORKER_FAILED', err instanceof Error ? err.message : String(err)))
    }
  })
}

export function cancelTranslation(requestId: string): void {
  const entry = pending.get(requestId)
  if (!entry) return
  pending.delete(requestId)
  entry.resolve(fail('ABORTED', 'Translation was cancelled.'))
  worker?.postMessage({ type: 'cancel', id: requestId } satisfies TranslationWorkerRequest)
}

/** Drop requests from a window that is going away (its promises can't be delivered anyway). */
export function cancelTranslationsFor(sender: WebContents): void {
  for (const [id, entry] of pending) {
    if (entry.sender === sender) cancelTranslation(id)
  }
}

/** Stop the worker on app quit so ONNX threads can't outlive the process. */
export function disposeTranslationWorker(): void {
  const current = worker
  worker = null
  failAllPending('App is quitting.')
  void current?.terminate()
}
