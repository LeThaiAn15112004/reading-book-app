import type {
  AbortSignalLike,
  TranslationEngineLoader,
  TranslationLoadProgressListener,
} from '../../ports/translation.js'
import type { Logger } from '../../ports/platform.js'

export const DEFAULT_TRANSLATION_MODEL_ID = 'Xenova/opus-mt-en-vi'

export type TranslationServiceStatus = 'idle' | 'loading' | 'ready' | 'error' | 'disposed'

export interface LocalTranslationServiceOptions {
  /** Creates the engine on first use. Never called before the first `translate`/`warmUp`. */
  loadEngine: TranslationEngineLoader
  /** Default: `Xenova/opus-mt-en-vi`. */
  modelId?: string
  /** Default source/target hints forwarded to multilingual models. */
  sourceLang?: string
  targetLang?: string
  /** Hard cap on one request's input length, after sanitizing. Default 20 000 characters. */
  maxInputChars?: number
  /**
   * Long input is split into segments of at most this many characters (on sentence, then word
   * boundaries). Marian/OPUS models degrade sharply past ~512 tokens. Default 400.
   */
  maxSegmentChars?: number
  /** Segments sent to the engine per inference call. Default 8. */
  batchSize?: number
  /** Extra attempts when the first model load fails with a network error. Default 2. */
  loadRetries?: number
  /** Delay before the first retry; doubles each attempt. Default 1000 ms. */
  retryDelayMs?: number
  /** Unload the model after this long without a request. Default: never (0). */
  idleUnloadMs?: number
  /** Required for `retryDelayMs` / `idleUnloadMs`; defaults to global `setTimeout`. */
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  logger?: Logger
}

export interface TranslationRequest {
  text: string
  /** Overrides the service default for this request. */
  sourceLang?: string
  targetLang?: string
  maxNewTokens?: number
  /** Cancels waiting / remaining batches. The segment currently inferring still finishes. */
  signal?: AbortSignalLike
  /** Progress of the model load, if this request is the one that triggers it. */
  onLoadProgress?: TranslationLoadProgressListener
}

export interface TranslationResponse {
  /** Translated text, with the input's paragraph breaks preserved. */
  text: string
  /** Sanitized input actually sent to the model. */
  sourceText: string
  modelId: string
  segmentCount: number
  durationMs: number
}

export interface WarmUpOptions {
  onProgress?: TranslationLoadProgressListener
  signal?: AbortSignalLike
}
