/**
 * Machine-translation port. `LocalTranslationService` only talks to this interface, so the host
 * picks the engine (Transformers.js/ONNX on desktop, a native module on mobile, a remote API)
 * without the SDK core importing any ML runtime — which would break the self-contained build.
 *
 * Reference implementation: `host-adapters/translation/transformers-translation-engine.ts`.
 */

/** One progress event while model files are fetched / read from cache / compiled. */
export type TranslationLoadProgress = {
  /**
   * `progress` is per file; `total` aggregates every file of the model — prefer it for a single
   * progress bar. `ready` fires once, when the first translation can run.
   */
  status: 'initiate' | 'download' | 'progress' | 'total' | 'done' | 'ready'
  /** Model file being processed (e.g. `onnx/decoder_model_merged.onnx`), when known. */
  file?: string
  /** 0–100 for `file` (or for the whole model when `status` is `total`), when known. */
  progress?: number
  loadedBytes?: number
  totalBytes?: number
}

export type TranslationLoadProgressListener = (event: TranslationLoadProgress) => void

export type TranslationEngineLoadOptions = {
  /** Model id understood by the engine, e.g. `Xenova/opus-mt-en-vi`. */
  modelId: string
  onProgress?: TranslationLoadProgressListener
  signal?: AbortSignalLike
}

export type TranslationEngineTranslateOptions = {
  /** Source / target language hints for multilingual models (ignored by fixed-pair models). */
  sourceLang?: string
  targetLang?: string
  /** Upper bound on generated tokens per segment. */
  maxNewTokens?: number
}

/** A loaded model. Holds native/WASM memory until `dispose()` is called. */
export interface TranslationEngine {
  /** Translates each segment independently; the result has the same length and order. */
  translate(segments: readonly string[], options: TranslationEngineTranslateOptions): Promise<string[]>
  /** Releases model weights / inference sessions. Must be safe to call more than once. */
  dispose(): Promise<void>
}

/** Loads (downloads on first use, then from cache) a model and returns a ready engine. */
export type TranslationEngineLoader = (options: TranslationEngineLoadOptions) => Promise<TranslationEngine>

/** Minimal `AbortSignal` shape — the SDK core compiles without DOM typings. */
export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}
