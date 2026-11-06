import { fork, type ForkOptions } from 'node:child_process'
import type { TranscriptionErrorCode } from '@reading-book/book-reader-sdk'
import type { SpeechMessage, SpeechProcessData, SpeechRequest } from './transcription-job'
import type { WhisperLoadStage, WhisperSegment } from './whisper-engine'

/**
 * Main-side owner of the speech process (spec 004, research R11, option A).
 *
 * - One process at a time, started lazily and reused for every window of a job (model load costs seconds), killed
 *   after a quiet period, and killed at once when a cancel is not answered in time.
 * - `transcribe()` serves one request at a time (calls queue). Cancel = the signal fires → a graceful `cancel` message
 *   → if the process has not answered within `cancelGraceMs`, the process is KILLED and the promise rejects `ABORTED`
 *   right away (it does not wait for the OS to finish tearing the process down). So control always returns within
 *   `cancelGraceMs` of the cancel, however busy the machine is. The next request starts a fresh process.
 * - If the process dies while a request is in flight (a native crash in ONNX Runtime, an OOM kill…) only that request
 *   fails (`DECODE_FAILED`); the host itself and the app are unaffected, and the next request starts a fresh process.
 * - WATCHDOG (research R12): a request can never hang. Three independent ways out, all ending in `DECODE_FAILED` with a
 *   distinct `reason`, the process killed and every timer / listener of the request released:
 *     1. `timeout`      — no message from the process for `loadTimeoutMs` (until it says it is transcribing) or for
 *                         `windowTimeoutMs` (while transcribing one window); every message restarts the clock;
 *     2. `process-exit` — the exit event, or the periodic liveness probe (`isAlive`) when the exit event never comes;
 *     3. `ipc-lost`     — the channel to the process closed while the process may still be running.
 *   A user cancel always wins over the watchdog: it disarms it and the request ends `ABORTED` (reason `cancelled` /
 *   `cancel-unanswered`), never as a timeout.
 *
 * The launcher is injected: `launchForkedProcess` (below) runs the built `transcription.process.js` with
 * `child_process.fork`; tests use a fake. Must not import `electron`.
 */

/** Why a request failed, finer than the contract's `code`: lets the service and the logs tell a stall from a crash from a cancel. */
export type SpeechFailureReason =
  | 'timeout'
  | 'process-exit'
  | 'ipc-lost'
  | 'send-failed'
  | 'cancelled'
  | 'cancel-unanswered'
  | 'disposed'
  | 'engine'

export class SpeechProcessError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string,
    readonly reason: SpeechFailureReason = 'engine',
  ) {
    super(message)
    this.name = 'SpeechProcessError'
  }
}

/**
 * Watchdog limits. Basis (research R11/R12, `whisper-tiny`, 6.7 s clip): model load 1.3–3.6 s, one window 0.9–12 s (≈ 1.8× the
 * audio length at worst, under CPU saturation). A 30 s window of a model several times slower than tiny therefore stays well
 * below 180 s, and a load below 120 s; a process silent for longer than that is treated as hung. Both are options so the
 * service can raise them for a larger model.
 */
export const DEFAULT_LOAD_TIMEOUT_MS = 120_000
export const DEFAULT_WINDOW_TIMEOUT_MS = 180_000
export const DEFAULT_LIVENESS_INTERVAL_MS = 2_000

/** What the host needs from a running child, whatever started it. */
export interface ProcessHandle {
  readonly pid: number | undefined
  send(message: SpeechRequest): void
  onMessage(handler: (message: SpeechMessage) => void): void
  /** Fired once when the process is gone, for any reason (`code` null when killed by a signal); `ipc-lost` = the channel closed first. */
  onExit(handler: (code: number | null, cause?: 'exit' | 'ipc-lost') => void): void
  /** Cheap synchronous probe used by the watchdog when the exit event never comes. Absent = no probe. */
  isAlive?(): boolean
  /** Hard stop; must not throw. */
  kill(): void
}

export type ProcessLauncher = (data: SpeechProcessData) => ProcessHandle

export interface SpeechProcessHostOptions {
  launch: ProcessLauncher
  /** `{userData}/transcription-models`. */
  modelsDir: string
  blockNetwork?: boolean
  /** How long a graceful cancel may take before the process is killed. Default 2000 ms (SC-006 allows 5 s). */
  cancelGraceMs?: number
  /** Kill an idle process after this long. Default 5 minutes. */
  idleKillMs?: number
  /** Watchdog: longest silence while the process starts / loads the model. Default 120 s. */
  loadTimeoutMs?: number
  /** Watchdog: longest silence while the process transcribes one window. Default 180 s. */
  windowTimeoutMs?: number
  /** Watchdog: how often a pending request probes the process (`isAlive`). Default 2 s. */
  livenessIntervalMs?: number
}

export interface SpeechRequestOptions {
  signal?: AbortSignal
  onStage?: (stage: WhisperLoadStage | 'transcribing') => void
}

export interface SpeechResult {
  modelId: string
  segments: WhisperSegment[]
  loadMs: number
  transcribeMs: number
}

interface Pending {
  id: string
  resolve: (result: SpeechResult) => void
  reject: (error: SpeechProcessError) => void
  onStage?: (stage: WhisperLoadStage | 'transcribing') => void
}

export function createSpeechProcessHost(options: SpeechProcessHostOptions) {
  const cancelGraceMs = options.cancelGraceMs ?? 2000
  const idleKillMs = options.idleKillMs ?? 5 * 60_000
  const loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
  const windowTimeoutMs = options.windowTimeoutMs ?? DEFAULT_WINDOW_TIMEOUT_MS
  const livenessIntervalMs = options.livenessIntervalMs ?? DEFAULT_LIVENESS_INTERVAL_MS
  let handle: ProcessHandle | null = null
  let pending: Pending | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let counter = 0
  let queue: Promise<unknown> = Promise.resolve()
  let disposed = false

  function clearIdle(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }

  function kill(reason: string): void {
    void reason
    const current = handle
    handle = null // late messages / the exit event of this process are ignored from now on
    current?.kill()
  }

  function ensureProcess(): ProcessHandle {
    if (handle) return handle
    const started = options.launch({ modelsDir: options.modelsDir, blockNetwork: options.blockNetwork })
    handle = started
    started.onMessage((message) => {
      if (handle !== started || !pending || message.id !== pending.id) return
      const current = pending
      if (message.type === 'stage') {
        current.onStage?.(message.stage)
        return
      }
      pending = null
      if (message.type === 'result') {
        current.resolve({ modelId: message.modelId, segments: message.segments, loadMs: message.loadMs, transcribeMs: message.transcribeMs })
      } else {
        current.reject(new SpeechProcessError(message.code, message.message, message.code === 'ABORTED' ? 'cancelled' : 'engine'))
      }
    })
    started.onExit((code, cause) => {
      if (handle !== started) return // we killed it ourselves
      handle = null
      const current = pending
      pending = null
      if (cause === 'ipc-lost') {
        started.kill() // the channel is gone; nobody can talk to it any more, do not leave it running
        current?.reject(new SpeechProcessError('DECODE_FAILED', 'The connection to the speech process was lost', 'ipc-lost'))
        return
      }
      current?.reject(new SpeechProcessError('DECODE_FAILED', `The speech process stopped unexpectedly (exit code ${code ?? 'signal'})`, 'process-exit'))
    })
    return started
  }

  function run(request: { modelId: string; language: string; samples: Float32Array }, requestOptions: SpeechRequestOptions): Promise<SpeechResult> {
    const { signal } = requestOptions
    if (disposed) return Promise.reject(new SpeechProcessError('ABORTED', 'The speech host was disposed', 'disposed'))
    if (signal?.aborted) return Promise.reject(new SpeechProcessError('ABORTED', 'Transcription aborted', 'cancelled'))
    clearIdle()
    const id = `req-${(counter += 1)}`

    return new Promise<SpeechResult>((resolve, reject) => {
      let graceTimer: ReturnType<typeof setTimeout> | null = null
      let watchdogTimer: ReturnType<typeof setTimeout> | null = null
      let livenessTimer: ReturnType<typeof setInterval> | null = null
      /** Every way out of this request goes through here: all timers and the abort listener are released exactly once. */
      const finish = (action: () => void): void => {
        if (graceTimer) clearTimeout(graceTimer)
        if (watchdogTimer) clearTimeout(watchdogTimer)
        if (livenessTimer) clearInterval(livenessTimer)
        graceTimer = watchdogTimer = livenessTimer = null
        signal?.removeEventListener('abort', onAbort)
        action()
      }
      const entry: Pending = {
        id,
        onStage: (stage) => {
          // progress: restart the clock for the phase the process just entered (a cancelled request has its own timer)
          if (!signal?.aborted) armWatchdog(stage === 'transcribing' ? windowTimeoutMs : loadTimeoutMs)
          requestOptions.onStage?.(stage)
        },
        resolve: (result) => finish(() => resolve(result)),
        reject: (error) => finish(() => reject(error)),
      }
      /** The process failed us (hung, vanished): stop it and fail only this request. */
      const fail = (message: string, reason: SpeechFailureReason): void => {
        if (pending !== entry) return
        pending = null
        kill(reason)
        entry.reject(new SpeechProcessError('DECODE_FAILED', message, reason))
      }
      function armWatchdog(ms: number): void {
        if (watchdogTimer) clearTimeout(watchdogTimer)
        watchdogTimer = setTimeout(() => {
          watchdogTimer = null
          if (pending !== entry) return // already settled: a late timer must not touch a newer request
          if (signal?.aborted) return // the user cancelled: the cancel path (grace timer) decides, never a timeout
          fail(`The speech process did not respond for ${Math.round(ms / 1000)} s and was stopped`, 'timeout')
        }, ms)
      }
      function onAbort(): void {
        if (pending !== entry) return
        // a cancel replaces the watchdog: from here on only the grace timer can end this request
        if (watchdogTimer) clearTimeout(watchdogTimer)
        watchdogTimer = null
        try {
          handle?.send({ type: 'cancel', id })
        } catch {
          /* the process may already be gone; the exit handler settles it */
        }
        graceTimer = setTimeout(() => {
          if (pending !== entry) return
          pending = null
          kill('cancel not answered in time')
          entry.reject(new SpeechProcessError('ABORTED', 'Transcription aborted (the speech process did not answer in time and was stopped)', 'cancel-unanswered'))
        }, cancelGraceMs)
      }
      pending = entry
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const target = ensureProcess()
        // Timers first, then send: a reply delivered inside `send` (or any time later) goes through `finish`, which can only
        // release timers that already exist — arming after the send would leak them when the request is already settled.
        armWatchdog(loadTimeoutMs)
        // Exit events can be late or missing (observed once under full CPU load, research R12): also ask the OS.
        if (target.isAlive) {
          livenessTimer = setInterval(() => {
            if (pending !== entry || handle !== target || signal?.aborted) return
            let alive = true
            try {
              alive = target.isAlive?.() ?? true
            } catch {
              alive = false
            }
            if (!alive) fail('The speech process is no longer running', 'process-exit')
          }, livenessIntervalMs)
        }
        // structured clone copies the samples; the caller keeps its buffer
        target.send({ type: 'transcribe', id, modelId: request.modelId, language: request.language, samples: request.samples })
      } catch (error) {
        fail(`Could not reach the speech process: ${error instanceof Error ? error.message : String(error)}`, 'send-failed')
      }
    })
  }

  /** Transcribe one window (≤ 30 s of 16 kHz mono float32). Calls are served one after another. */
  function transcribe(
    request: { modelId: string; language: string; samples: Float32Array },
    requestOptions: SpeechRequestOptions = {},
  ): Promise<SpeechResult> {
    const result = queue.then(() => run(request, requestOptions))
    queue = result.then(
      () => scheduleIdleKill(),
      () => scheduleIdleKill(),
    )
    return result
  }

  function scheduleIdleKill(): void {
    clearIdle()
    if (!handle || pending) return
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (!pending) kill('idle')
    }, idleKillMs)
    idleTimer.unref?.()
  }

  /**
   * Stop the speech process now WITHOUT disposing the host: the resident model is released (its files can be deleted — a loaded
   * model file is locked on Windows) and the next request simply starts a fresh process. Refused (false) while a request is in flight.
   */
  function stop(): boolean {
    if (pending) return false
    clearIdle()
    kill('stop')
    return true
  }

  /** Stop the process now (app quit, job removed…). Later calls reject `ABORTED`. */
  function dispose(): void {
    disposed = true
    clearIdle()
    const current = pending
    pending = null
    kill('dispose')
    current?.reject(new SpeechProcessError('ABORTED', 'The speech host was disposed', 'disposed'))
  }

  return { transcribe, stop, dispose, isRunning: (): boolean => handle !== null, pid: (): number | undefined => handle?.pid }
}

export type SpeechProcessHost = ReturnType<typeof createSpeechProcessHost>

/**
 * Start `entryPath` (the built `transcription.process.js`) as a child process: `child_process.fork` of the current
 * executable with `ELECTRON_RUN_AS_NODE` (in Electron that is the app's own binary running as plain Node, no window),
 * structured-clone messages so Float32Arrays cross as typed arrays.
 */
export function launchForkedProcess(entryPath: string): ProcessLauncher {
  return (data) => {
    // `windowsHide` is passed through to spawn (no console window on Windows) but is missing from the `ForkOptions` typing.
    const options: ForkOptions & { windowsHide: boolean } = {
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    }
    const child = fork(entryPath, [JSON.stringify(data)], options)
    // 'error' (spawn failure) is followed by no 'exit'; make it one event for the host.
    let exited = false
    const exitHandlers: Array<(code: number | null, cause?: 'exit' | 'ipc-lost') => void> = []
    const emitExit = (code: number | null, cause: 'exit' | 'ipc-lost' = 'exit'): void => {
      if (exited) return
      exited = true
      for (const handler of exitHandlers) handler(code, cause)
    }
    child.on('exit', (code) => emitExit(code))
    child.on('error', () => emitExit(null))
    // The IPC channel closed while the process may still run: report it as a lost connection (the host kills the process).
    child.on('disconnect', () => emitExit(null, 'ipc-lost'))
    return {
      pid: child.pid,
      // Asks the OS directly (signal 0 sends nothing; libuv reports ESRCH once the process has ended), because the exit /
      // disconnect events depend on this thread's event loop and arrived late or never under full CPU load (research R12).
      isAlive: () => {
        if (exited || child.exitCode !== null || child.signalCode !== null || !child.connected || child.pid === undefined) return false
        try {
          process.kill(child.pid, 0)
          return true
        } catch {
          return false
        }
      },
      send: (message) => {
        child.send(message)
      },
      onMessage: (handler) => {
        child.on('message', (message) => handler(message as SpeechMessage))
      },
      onExit: (handler) => {
        exitHandlers.push(handler)
      },
      kill: () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      },
    }
  }
}
