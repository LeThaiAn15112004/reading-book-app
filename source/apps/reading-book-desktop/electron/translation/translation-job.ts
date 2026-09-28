import type { TranslationLoadProgress, TranslationRoute } from '@reading-book/book-reader-sdk'
import type { TranslationErrorCode } from '../ipc/api-types'

/** `workerData` for translation.worker.ts. */
export type TranslationWorkerData = {
  /** Model cache — under userData, because the default (inside node_modules) is read-only once packaged. */
  cacheDir: string
}

export type TranslationWorkerRequest =
  | { type: 'translate'; id: string; text: string; route: TranslationRoute }
  | { type: 'cancel'; id: string }

export type TranslationWorkerMessage =
  | { type: 'progress'; id: string; modelId: string; event: TranslationLoadProgress }
  | { type: 'result'; id: string; text: string; modelId: string; durationMs: number }
  | { type: 'error'; id: string; code: TranslationErrorCode; message: string }
