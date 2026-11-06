import path from 'node:path'
import { normalisePassageText } from '@reading-book/book-reader-sdk'
import { ModelError, createModelManager, type ModelManager } from './model-manager'
import { findTranscriptionModel } from './transcription-models'

/**
 * Whisper speech recognition on top of `@huggingface/transformers` (spec 004, research R1, task T014).
 *
 * - Loads ONLY from the local, hash-verified model folder (`{modelsDir}/<id>/`, see model-manager.ts) with
 *   `local_files_only` and remote access disabled: nothing is ever fetched from the Hub here. (transformers.js
 *   `pipeline()` against the Hub would first read three files from `main`, see the manifest.)
 * - `dtype: 'q8'` — the `_quantized` ONNX files the manifest covers.
 * - One window (≤ 30 s of 16 kHz mono float32) per call, segment-level timestamps, times relative to the window.
 *
 * Not yet exercised against a real model: that is the smoke test T014a. Must not import `electron`; it runs in the
 * transcription worker thread.
 */

export interface WhisperSegment {
  /** Milliseconds from the start of the window that was transcribed. */
  startMs: number
  endMs: number
  text: string
}

export type WhisperLoadStage = 'verifying' | 'loading' | 'ready'

export interface WhisperEngineOptions {
  /** `{userData}/transcription-models`. */
  modelsDir: string
  /** Test seam; defaults to a manager over `modelsDir` and the verified catalog. */
  models?: ModelManager
  /**
   * Smoke-test switch (T014a): make any network call from this thread fail, so a successful run proves the model
   * was read from disk only. Never set in the app.
   */
  blockNetwork?: boolean
}

export interface TranscribeOptions {
  /** Whisper language name or code (`en`, `vi`, …) or `auto` / empty for detection. */
  language?: string
  signal?: AbortSignal
}

type Transformers = typeof import('@huggingface/transformers')
type AsrPipeline = Awaited<ReturnType<Transformers['pipeline']>>

let transformersPromise: Promise<Transformers> | null = null
function loadTransformers(): Promise<Transformers> {
  transformersPromise ??= import('@huggingface/transformers').catch((error: unknown) => {
    transformersPromise = null
    throw new Error(
      `@huggingface/transformers failed to load its ONNX runtime (${error instanceof Error ? error.message : String(error)})`,
    )
  })
  return transformersPromise
}

export function createWhisperEngine(options: WhisperEngineOptions) {
  const models = options.models ?? createModelManager({ modelsDir: options.modelsDir })
  let loadedId: string | null = null
  let asr: AsrPipeline | null = null
  let loading: Promise<void> | null = null

  function blockNetworkIfAsked(): void {
    if (!options.blockNetwork) return
    globalThis.fetch = () => Promise.reject(new Error('network blocked for this run'))
  }

  async function doLoad(modelId: string, onStage?: (stage: WhisperLoadStage) => void): Promise<void> {
    const spec = findTranscriptionModel(modelId)
    if (!spec) throw new ModelError('INVALID_ARGUMENT', `Unknown speech model "${modelId}"`)

    onStage?.('verifying')
    if (!(await models.isInstalled(modelId))) throw new ModelError('MODEL_MISSING', `Speech model ${modelId} is not installed`)
    const verdict = await models.verifyInstalled(modelId)
    if (!verdict.ok) {
      throw new ModelError('INTEGRITY_FAILED', `Speech model ${modelId} failed verification (${verdict.file}: ${verdict.reason})`)
    }

    onStage?.('loading')
    blockNetworkIfAsked()
    const { env, pipeline } = await loadTransformers()
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = path.resolve(options.modelsDir) + path.sep
    env.useFSCache = false

    asr = await pipeline('automatic-speech-recognition', modelId, {
      dtype: spec.dtype,
      device: 'cpu',
      local_files_only: true,
    })
    loadedId = modelId
    onStage?.('ready')
  }

  /** Verify and load a model (a different one replaces the resident one). Concurrent calls share the work. */
  async function load(modelId: string, onStage?: (stage: WhisperLoadStage) => void): Promise<void> {
    if (loadedId === modelId && asr) return
    if (loading) await loading.catch(() => undefined)
    if (loadedId === modelId && asr) return
    await dispose()
    loading = doLoad(modelId, onStage).finally(() => {
      loading = null
    })
    return loading
  }

  /** Transcribe one window. Throws `ModelError('ABORTED')` when the signal fired. */
  async function transcribe(samples: Float32Array, transcribeOptions: TranscribeOptions = {}): Promise<WhisperSegment[]> {
    if (!asr || !loadedId) throw new ModelError('MODEL_MISSING', 'No speech model is loaded')
    const { signal } = transcribeOptions
    if (signal?.aborted) throw new ModelError('ABORTED', 'Transcription aborted')
    if (samples.length === 0) return []

    const { InterruptableStoppingCriteria } = await loadTransformers()
    const stopper = new InterruptableStoppingCriteria()
    const onAbort = (): void => stopper.interrupt()
    signal?.addEventListener('abort', onAbort, { once: true })
    const language = transcribeOptions.language?.trim()
    try {
      const output = (await (asr as unknown as (audio: Float32Array, opts: Record<string, unknown>) => Promise<unknown>)(samples, {
        task: 'transcribe',
        ...(language && language !== 'auto' ? { language } : {}),
        return_timestamps: true,
        stopping_criteria: stopper,
      })) as { text?: string; chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> }
      if (signal?.aborted) throw new ModelError('ABORTED', 'Transcription aborted')
      return toSegments(output, samples.length / 16_000)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async function dispose(): Promise<void> {
    const current = asr
    asr = null
    loadedId = null
    // Releases the ONNX sessions (native memory the JS GC does not track).
    await (current as unknown as { dispose?: () => Promise<void> } | null)?.dispose?.()
  }

  return { load, transcribe, dispose, isLoaded: (modelId: string): boolean => loadedId === modelId && asr !== null }
}

export type WhisperEngine = ReturnType<typeof createWhisperEngine>

/**
 * transformers.js returns `{ text, chunks: [{ text, timestamp: [startSeconds, endSeconds | null] }] }` with
 * `return_timestamps: true`. Convert to clean millisecond segments inside the window: whitespace normalised,
 * empty text dropped, `end` of a last open chunk = window end, `start < end` guaranteed, clamped to the window.
 */
export function toSegments(
  output: { text?: string; chunks?: Array<{ text: string; timestamp: [number | null, number | null] }> },
  windowSeconds: number,
): WhisperSegment[] {
  const windowMs = Math.max(1, Math.round(windowSeconds * 1000))
  const segments: WhisperSegment[] = []
  const chunks = output.chunks ?? []
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!
    const text = normalisePassageText(chunk.text ?? '')
    if (!text) continue
    const [rawStart, rawEnd] = chunk.timestamp ?? [null, null]
    const startMs = Math.min(windowMs - 1, Math.max(0, Math.round((rawStart ?? 0) * 1000)))
    const endCandidate = rawEnd === null || rawEnd === undefined ? windowMs : Math.round(rawEnd * 1000)
    const endMs = Math.min(windowMs, Math.max(startMs + 1, endCandidate))
    segments.push({ startMs, endMs, text })
  }
  if (segments.length === 0 && chunks.length === 0) {
    const text = normalisePassageText(output.text ?? '')
    if (text) segments.push({ startMs: 0, endMs: windowMs, text })
  }
  return segments
}
