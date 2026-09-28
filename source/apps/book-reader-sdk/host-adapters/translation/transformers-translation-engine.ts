/**
 * `TranslationEngine` backed by Transformers.js (`@huggingface/transformers`, ONNX Runtime).
 *
 * Lives in `host-adapters/` rather than `src/` because the SDK core bundle must stay free of
 * third-party runtime imports (see `scripts/build.mjs`). The host installs the package:
 *
 *   npm i @huggingface/transformers -w reading-book-desktop
 *
 * Run it where heavy CPU work cannot freeze the UI: in Electron that is a `utilityProcess` or a
 * `worker_threads` worker, not the main process and not the renderer's main thread.
 */
import type { DataType, DeviceType, ProgressInfo, TranslationPipeline } from '@huggingface/transformers'
import type {
  TranslationEngine,
  TranslationEngineLoader,
  TranslationEngineTranslateOptions,
  TranslationLoadProgress,
} from '../../src/ports/translation.js'

export interface TransformersTranslationEngineOptions {
  /**
   * Where downloaded model files are cached. In Electron pass
   * `path.join(app.getPath('userData'), 'models')` — the default (inside `node_modules`) is
   * read-only in a packaged app.
   */
  cacheDir?: string
  /** Load only from `cacheDir` / `localModelPath`; never touch the network. Default false. */
  offlineOnly?: boolean
  /** Directory of pre-bundled models (e.g. shipped in `resources/`), checked before the Hub. */
  localModelPath?: string
  /** Weight precision. `q8` is ~4× smaller than `fp32` with little quality loss. Default `q8`. */
  dtype?: DataType
  /** Default: Transformers.js picks (`cpu` in Node, `wasm` in browsers). */
  device?: DeviceType
}

type TransformersModule = typeof import('@huggingface/transformers')

/** One import per process: the module is large and loads ONNX Runtime native bindings. */
let modulePromise: Promise<TransformersModule> | null = null

function loadTransformers(): Promise<TransformersModule> {
  modulePromise ??= import('@huggingface/transformers').catch((error: unknown) => {
    modulePromise = null
    const wrapped = new Error(
      '@huggingface/transformers is not installed or failed to load its ONNX runtime ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    )
    ;(wrapped as { cause?: unknown }).cause = error
    throw wrapped
  })
  return modulePromise
}

export function createTransformersTranslationEngineLoader(
  options: TransformersTranslationEngineOptions = {},
): TranslationEngineLoader {
  return async ({ modelId, onProgress, signal }) => {
    const { env, pipeline } = await loadTransformers()

    // `env` is process-global; every loader in the process should be created with the same paths.
    if (options.cacheDir) env.cacheDir = options.cacheDir
    if (options.localModelPath) env.localModelPath = options.localModelPath
    env.allowLocalModels = options.localModelPath !== undefined || env.allowLocalModels
    env.allowRemoteModels = !options.offlineOnly

    if (signal?.aborted) throw new Error('Model load aborted')

    const translator = (await pipeline('translation', modelId, {
      dtype: options.dtype ?? 'q8',
      device: options.device,
      local_files_only: options.offlineOnly ?? false,
      // `ready` is skipped: LocalTranslationService emits its own once the engine is usable.
      progress_callback: onProgress
        ? (info: ProgressInfo) => {
            if (info.status !== 'ready') onProgress(toLoadProgress(info))
          }
        : undefined,
    })) as TranslationPipeline

    return new TransformersTranslationEngine(translator)
  }
}

class TransformersTranslationEngine implements TranslationEngine {
  private translator: TranslationPipeline | null

  constructor(translator: TranslationPipeline) {
    this.translator = translator
  }

  async translate(segments: readonly string[], options: TranslationEngineTranslateOptions): Promise<string[]> {
    if (!this.translator) throw new Error('Translation engine has been disposed')
    if (segments.length === 0) return []

    const output = await this.translator([...segments], {
      // Only multilingual models (NLLB, M2M100, mBART) read these; OPUS-MT pairs ignore them.
      ...(options.sourceLang ? { src_lang: options.sourceLang } : {}),
      ...(options.targetLang ? { tgt_lang: options.targetLang } : {}),
      max_new_tokens: options.maxNewTokens ?? 512,
    })
    return output.map((item) => item.translation_text)
  }

  async dispose(): Promise<void> {
    const translator = this.translator
    this.translator = null
    // Releases the ONNX InferenceSessions (native memory not tracked by the JS GC).
    await translator?.dispose()
  }
}

function toLoadProgress(info: ProgressInfo): TranslationLoadProgress {
  switch (info.status) {
    case 'progress':
      return { status: 'progress', file: info.file, progress: info.progress, loadedBytes: info.loaded, totalBytes: info.total }
    case 'progress_total':
      return { status: 'total', progress: info.progress, loadedBytes: info.loaded, totalBytes: info.total }
    case 'ready':
      return { status: 'ready' }
    default:
      return { status: info.status, file: info.file }
  }
}
