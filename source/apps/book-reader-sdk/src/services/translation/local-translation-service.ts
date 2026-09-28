import { SdkError, isSdkError } from '../../core/errors.js'
import { platformGlobals } from '../../core/platform-globals.js'
import type { Logger } from '../../ports/platform.js'
import type {
  AbortSignalLike,
  TranslationEngine,
  TranslationLoadProgress,
  TranslationLoadProgressListener,
} from '../../ports/translation.js'
import { assembleTranslation, planTranslation, sanitizeTranslationInput } from './translation-text.js'
import {
  DEFAULT_TRANSLATION_MODEL_ID,
  type LocalTranslationServiceOptions,
  type TranslationRequest,
  type TranslationResponse,
  type TranslationServiceStatus,
  type WarmUpOptions,
} from './translation-types.js'

type StatusListener = (status: TranslationServiceStatus, error: SdkError | null) => void

const NETWORK_ERROR =
  /fetch|network|offline|socket|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|status(?: code)?:? ?(?:5\d\d|429)/i

/**
 * Offline machine translation on top of an injected `TranslationEngine`.
 *
 * - Lazy: nothing is downloaded or loaded until the first `translate()` / `warmUp()`.
 * - One model per instance: concurrent first calls share a single load, and inference runs
 *   through a serial queue (ONNX/WASM sessions are not re-entrant, and parallel runs would
 *   multiply peak memory).
 * - `LocalTranslationService.shared()` keeps one instance per model id app-wide, so two screens
 *   asking for the same model never load the weights twice.
 * - `unload()` frees the weights but keeps the service usable; `dispose()` is terminal.
 */
export class LocalTranslationService {
  private static readonly sharedInstances = new Map<string, LocalTranslationService>()

  /** Returns the app-wide instance for `options.modelId`, creating it on first call. */
  static shared(options: LocalTranslationServiceOptions): LocalTranslationService {
    const modelId = options.modelId ?? DEFAULT_TRANSLATION_MODEL_ID
    const existing = LocalTranslationService.sharedInstances.get(modelId)
    if (existing && existing.status !== 'disposed') return existing
    const created = new LocalTranslationService({ ...options, modelId })
    LocalTranslationService.sharedInstances.set(modelId, created)
    return created
  }

  /** Disposes every shared instance — call from the host's shutdown hook (e.g. `before-quit`). */
  static async disposeAllShared(): Promise<void> {
    const instances = [...LocalTranslationService.sharedInstances.values()]
    LocalTranslationService.sharedInstances.clear()
    await Promise.all(instances.map((instance) => instance.dispose()))
  }

  readonly modelId: string

  private readonly options: Required<
    Pick<
      LocalTranslationServiceOptions,
      'maxInputChars' | 'maxSegmentChars' | 'batchSize' | 'loadRetries' | 'retryDelayMs' | 'idleUnloadMs'
    >
  > &
    LocalTranslationServiceOptions
  private readonly logger: Logger | undefined
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  private currentStatus: TranslationServiceStatus = 'idle'
  private lastError: SdkError | null = null
  private enginePromise: Promise<TranslationEngine> | null = null
  /** Tail of the serial inference queue. Never rejects. */
  private queue: Promise<void> = Promise.resolve()
  private readonly loadListeners = new Set<TranslationLoadProgressListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private idleTimer: unknown = null
  private pending = 0

  constructor(options: LocalTranslationServiceOptions) {
    if (typeof options?.loadEngine !== 'function') {
      throw new SdkError('INVALID_CONFIG', 'LocalTranslationService: `loadEngine` is required')
    }
    this.modelId = options.modelId ?? DEFAULT_TRANSLATION_MODEL_ID
    this.options = {
      ...options,
      maxInputChars: positive(options.maxInputChars, 20_000),
      maxSegmentChars: positive(options.maxSegmentChars, 400),
      batchSize: positive(options.batchSize, 8),
      loadRetries: Math.max(0, options.loadRetries ?? 2),
      retryDelayMs: Math.max(0, options.retryDelayMs ?? 1_000),
      idleUnloadMs: Math.max(0, options.idleUnloadMs ?? 0),
    }
    this.logger = options.logger
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        if (!platformGlobals.setTimeout) throw new SdkError('ADAPTER_MISSING', 'No setTimeout available')
        return platformGlobals.setTimeout(callback, ms)
      })
    this.clearTimer = options.clearTimer ?? ((handle) => platformGlobals.clearTimeout?.(handle))
  }

  get status(): TranslationServiceStatus {
    return this.currentStatus
  }

  /** The error that put the service in `error` status, if any. Cleared on the next load attempt. */
  get error(): SdkError | null {
    return this.lastError
  }

  /** Fires on every status change; the listener is not called with the current status. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /**
   * Loads the model ahead of time (e.g. when the user opens translation settings) so the first
   * real request is instant. Optional — `translate` loads on demand anyway.
   */
  async warmUp(options: WarmUpOptions = {}): Promise<void> {
    this.assertNotDisposed()
    await this.acquireEngine(options.onProgress, options.signal)
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    this.assertNotDisposed()
    if (!request || typeof request.text !== 'string') {
      throw new SdkError('INVALID_ARGUMENT', 'translate: `text` must be a string')
    }
    throwIfAborted(request.signal)

    const startedAt = Date.now()
    const sourceText = sanitizeTranslationInput(request.text)
    if (sourceText.length > this.options.maxInputChars) {
      throw new SdkError(
        'INVALID_ARGUMENT',
        `translate: input is ${sourceText.length} characters, limit is ${this.options.maxInputChars}. ` +
          'Translate the selection in smaller parts.',
      )
    }

    const plan = planTranslation(sourceText, this.options.maxSegmentChars)
    const respond = (text: string): TranslationResponse => ({
      text,
      sourceText,
      modelId: this.modelId,
      segmentCount: plan.segments.length,
      durationMs: Date.now() - startedAt,
    })
    // Empty / punctuation-only / numeric input: answer without touching (or loading) the model.
    if (plan.segments.length === 0) return respond(assembleTranslation(plan, []))

    this.pending += 1
    this.cancelIdleUnload()
    try {
      // Load outside the queue so this caller gets progress events and can abort the wait...
      await this.acquireEngine(request.onLoadProgress, request.signal)
      const translated = await this.enqueue(async () => {
        // ...then re-read the engine inside it: an `unload()` queued in between may have freed
        // the one above, in which case this reloads from the local cache.
        const engine = await this.acquireEngine(undefined, undefined)
        return this.runBatches(engine, plan.segments, request)
      }, request.signal)
      return respond(assembleTranslation(plan, translated))
    } finally {
      this.pending -= 1
      this.scheduleIdleUnload()
    }
  }

  /**
   * Frees the model weights after in-flight inference finishes. The next `translate` reloads
   * (from the local cache, so no network). Use on memory pressure or when leaving the reader.
   */
  async unload(): Promise<void> {
    this.cancelIdleUnload()
    const enginePromise = this.enginePromise
    if (!enginePromise) return
    this.enginePromise = null
    // Disposal goes through the inference queue, so it can never free a model mid-inference.
    await this.serialize(() => disposeQuietly(enginePromise, this.logger))
    if (this.enginePromise === null && this.currentStatus !== 'disposed') this.setStatus('idle', null)
  }

  /** Terminal: rejects queued work, frees the model, detaches listeners. Idempotent. */
  async dispose(): Promise<void> {
    if (this.currentStatus === 'disposed') return
    this.setStatus('disposed', null)
    if (LocalTranslationService.sharedInstances.get(this.modelId) === this) {
      LocalTranslationService.sharedInstances.delete(this.modelId)
    }
    this.cancelIdleUnload()
    const enginePromise = this.enginePromise
    this.enginePromise = null
    this.loadListeners.clear()
    this.statusListeners.clear()
    // Lets the running task finish; tasks queued behind it reject with DISPOSED.
    await this.serialize(async () => {
      if (enginePromise) await disposeQuietly(enginePromise, this.logger)
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Model lifecycle

  private acquireEngine(
    onProgress: TranslationLoadProgressListener | undefined,
    signal: AbortSignalLike | undefined,
  ): Promise<TranslationEngine> {
    if (onProgress && this.currentStatus !== 'ready') {
      this.loadListeners.add(onProgress)
      // Listener removal is tied to the load, not to this caller: it is cleared in `startLoad`.
    }
    let load = this.enginePromise
    if (!load) {
      const started = this.startLoad()
      load = started
      this.enginePromise = started
      // Forget a failed load so the next request retries instead of replaying the failure. The
      // identity check keeps a stale load from clearing a newer one started after `unload()`.
      started.catch(() => {
        if (this.enginePromise === started) this.enginePromise = null
      })
    }
    // The load itself is shared, so one caller's abort only stops *its* wait, not the download.
    return raceAbort(load, signal)
  }

  private async startLoad(): Promise<TranslationEngine> {
    this.setStatus('loading', null)
    const forward = (event: TranslationLoadProgress) => {
      for (const listener of this.loadListeners) {
        try {
          listener(event)
        } catch (error) {
          this.logger?.warn('translation: load progress listener threw', { error: String(error) })
        }
      }
    }

    try {
      const engine = await this.loadWithRetry(forward)
      if (this.currentStatus === 'disposed') {
        await engine.dispose().catch(() => undefined)
        throw new SdkError('DISPOSED', 'LocalTranslationService was disposed while the model was loading')
      }
      forward({ status: 'ready' })
      this.setStatus('ready', null)
      return engine
    } catch (error) {
      const sdkError = classifyLoadError(error, this.modelId)
      if (this.currentStatus !== 'disposed') this.setStatus('error', sdkError)
      throw sdkError
    } finally {
      this.loadListeners.clear()
    }
  }

  private async loadWithRetry(onProgress: TranslationLoadProgressListener): Promise<TranslationEngine> {
    let attempt = 0
    for (;;) {
      try {
        return await this.options.loadEngine({ modelId: this.modelId, onProgress })
      } catch (error) {
        const retryable = isNetworkError(error) && attempt < this.options.loadRetries
        if (!retryable || this.currentStatus === 'disposed') throw error
        const delay = this.options.retryDelayMs * 2 ** attempt
        attempt += 1
        this.logger?.warn('translation: model load failed with a network error, retrying', {
          modelId: this.modelId,
          attempt,
          delayMs: delay,
          error: describe(error),
        })
        await new Promise<void>((resolve) => this.setTimer(resolve, delay))
      }
    }
  }

  private scheduleIdleUnload(): void {
    if (this.options.idleUnloadMs <= 0 || this.pending > 0 || !this.enginePromise) return
    this.cancelIdleUnload()
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null
      if (this.pending === 0) void this.unload()
    }, this.options.idleUnloadMs)
  }

  private cancelIdleUnload(): void {
    if (this.idleTimer === null) return
    this.clearTimer(this.idleTimer)
    this.idleTimer = null
  }

  // ---------------------------------------------------------------------------------------------
  // Inference

  /** Queues a caller's task: skipped if the service is disposed or the caller aborted meanwhile. */
  private enqueue<T>(task: () => Promise<T>, signal: AbortSignalLike | undefined): Promise<T> {
    const run = this.serialize(() => {
      this.assertNotDisposed()
      throwIfAborted(signal)
      return task()
    })
    // An abort while waiting rejects right away; the queued task then sees the abort and skips.
    return raceAbort(run, signal)
  }

  /** Runs `task` after everything queued before it; the queue survives a failed task. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async runBatches(
    engine: TranslationEngine,
    segments: readonly string[],
    request: TranslationRequest,
  ): Promise<string[]> {
    const out: string[] = []
    const engineOptions = {
      sourceLang: request.sourceLang ?? this.options.sourceLang,
      targetLang: request.targetLang ?? this.options.targetLang,
      maxNewTokens: request.maxNewTokens,
    }

    for (let i = 0; i < segments.length; i += this.options.batchSize) {
      throwIfAborted(request.signal)
      this.assertNotDisposed()
      const batch = segments.slice(i, i + this.options.batchSize)
      let result: string[]
      try {
        result = await engine.translate(batch, engineOptions)
      } catch (error) {
        throw new SdkError(
          'TRANSLATION_FAILED',
          `Translation with ${this.modelId} failed on segment ${i + 1}/${segments.length}: ${describe(error)}`,
          { cause: error },
        )
      }
      if (!Array.isArray(result) || result.length !== batch.length) {
        throw new SdkError(
          'TRANSLATION_FAILED',
          `Translation engine returned ${Array.isArray(result) ? result.length : 'no'} results for ${batch.length} segments`,
        )
      }
      out.push(...result.map((text) => (typeof text === 'string' ? text : '')))
    }
    return out
  }

  // ---------------------------------------------------------------------------------------------

  private assertNotDisposed(): void {
    if (this.currentStatus === 'disposed') {
      throw new SdkError('DISPOSED', 'LocalTranslationService has been disposed')
    }
  }

  private setStatus(status: TranslationServiceStatus, error: SdkError | null): void {
    this.lastError = error
    if (status === this.currentStatus) return
    this.currentStatus = status
    for (const listener of [...this.statusListeners]) {
      try {
        listener(status, error)
      } catch (listenerError) {
        this.logger?.warn('translation: status listener threw', { error: String(listenerError) })
      }
    }
  }
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'unknown error'
}

function isNetworkError(error: unknown): boolean {
  if (isSdkError(error)) return error.code === 'NETWORK_UNAVAILABLE'
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  const text = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)} ${
    cause instanceof Error ? cause.message : ''
  }`
  return NETWORK_ERROR.test(text)
}

function classifyLoadError(error: unknown, modelId: string): SdkError {
  if (isSdkError(error) && error.code !== 'NETWORK_UNAVAILABLE') return error
  if (isNetworkError(error)) {
    return new SdkError(
      'NETWORK_UNAVAILABLE',
      `Could not download translation model "${modelId}". Check the internet connection and try again — ` +
        'the model only needs to be downloaded once and works offline afterwards.',
      { cause: error },
    )
  }
  return new SdkError('MODEL_LOAD_FAILED', `Could not load translation model "${modelId}": ${describe(error)}`, {
    cause: error,
  })
}

async function disposeQuietly(enginePromise: Promise<TranslationEngine>, logger: Logger | undefined) {
  try {
    const engine = await enginePromise
    await engine.dispose()
  } catch (error) {
    // A load that failed has nothing to free; a dispose that failed can only be logged.
    if (!isSdkError(error)) logger?.warn('translation: engine dispose failed', { error: describe(error) })
  }
}

function abortError(signal: AbortSignalLike): SdkError {
  return new SdkError('ABORTED', 'Translation was cancelled', { cause: signal.reason })
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw abortError(signal)
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignalLike | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
