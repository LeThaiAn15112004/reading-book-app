/**
 * Spec 016 (FR-001 / FR-002, research R1): developer-only timing of import and open steps.
 *
 * On only when Main starts with `READMATE_TIMING=1`; then each finished step is appended as one JSON line to
 * `{userData}/logs/timing.jsonl` (format, size, duration — never a title, file name or path: see core `step-timing`).
 * Off, nothing is created or written. `spike:import:timing` reads the file.
 */
import { appendFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  createStepTimer,
  formatTimingLine,
  parseTimingLine,
  type StepTiming,
  type StepTimer,
  type TimingContext,
  type TimingFlow,
  type TimingStep,
} from '@core'

export function isTimingEnabled(): boolean {
  return process.env.READMATE_TIMING === '1'
}

export function timingLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'timing.jsonl')
}

/** Lines are appended in order, one write at a time; a failed write is dropped (timing never breaks the app). */
let writeChain: Promise<void> = Promise.resolve()
let logDirReady = false

export function appendTimingLine(timing: StepTiming): void {
  if (!isTimingEnabled()) return
  const line = formatTimingLine(timing) + '\n'
  writeChain = writeChain
    .then(async () => {
      const file = timingLogPath()
      if (!logDirReady) {
        await mkdir(path.dirname(file), { recursive: true })
        logDirReady = true
      }
      await appendFile(file, line, 'utf8')
    })
    .catch(() => {})
}

/** A line sent by the renderer (`app:recordTiming`): accepted only with exactly the StepTiming keys and values. */
export function recordRendererTiming(input: unknown): boolean {
  if (!isTimingEnabled()) return false
  const timing = parseTimingLine(input)
  if (!timing) return false
  appendTimingLine(timing)
  return true
}

/** Format token of a file for a timing line: its extension (`pdf`, `epub`…), never its name. */
export function timingFormatOf(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'unknown'
}

/** Format + size of a file, or `null` when timing is off (no extra `stat` for readers). */
export async function fileTimingContext(filePath: string): Promise<TimingContext | null> {
  if (!isTimingEnabled()) return null
  try {
    const info = await stat(filePath)
    return { format: timingFormatOf(filePath), sizeBytes: info.size }
  } catch {
    return null
  }
}

/** Runs `fn` and records it as `step` when a context is given (timing on); the result / error passes through. */
export async function timeStep<T>(
  flow: TimingFlow,
  step: TimingStep,
  ctx: TimingContext | null,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (!ctx) return fn()
  const mark = mainTimer().start(flow, step, ctx)
  try {
    return await fn()
  } finally {
    mark.end()
  }
}

let timer: StepTimer | null = null

/** The Main process timer (`host: 'desktop'`); a no-op unless `READMATE_TIMING=1`. */
export function mainTimer(): StepTimer {
  timer ??= createStepTimer({ enabled: isTimingEnabled(), host: 'desktop', sink: appendTimingLine })
  return timer
}
