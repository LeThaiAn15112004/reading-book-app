import type { TranscriptionErrorCode } from '@reading-book/book-reader-sdk'
import type { WhisperLoadStage, WhisperSegment } from './whisper-engine'

/**
 * Messages between Main and the speech process (spec 004, research R11, option A). The Whisper engine runs in a
 * SEPARATE OS PROCESS, never in a worker thread: terminating a thread while ONNX Runtime executes crashes the whole
 * app, whereas a process can be killed at any moment and only the job in flight fails.
 */

/** Passed to the speech process as its first command-line argument (JSON). */
export type SpeechProcessData = {
  /** `{userData}/transcription-models` — verified model folders live here (see model-manager.ts). */
  modelsDir: string
  /** Smoke-test only (T014a): make every network call fail inside the process. Never set in the app. */
  blockNetwork?: boolean
}

export type SpeechRequest =
  | {
      type: 'transcribe'
      id: string
      modelId: string
      /** Whisper language name or code, or `auto`. */
      language: string
      /** 16 kHz mono float32, at most 30 s (structured-clone serialization). */
      samples: Float32Array
    }
  /** Ask a queued or running request to stop (graceful; the host kills the process if it is not answered in time). */
  | { type: 'cancel'; id: string }
  /** Free the resident model (the process keeps running). */
  | { type: 'dispose' }

export type SpeechMessage =
  | { type: 'stage'; id: string; stage: WhisperLoadStage | 'transcribing' }
  | { type: 'result'; id: string; modelId: string; segments: WhisperSegment[]; loadMs: number; transcribeMs: number }
  /**
   * `DECODE_FAILED` is also used for an unexpected failure inside the speech engine (the contract has no separate
   * code); the message carries the real reason.
   */
  | { type: 'error'; id: string; code: TranscriptionErrorCode; message: string }
