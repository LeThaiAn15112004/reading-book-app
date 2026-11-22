/**
 * Developer-only step timing of import and open (spec 016 FR-001 / FR-002, research R1).
 *
 * A record holds only the flow, the step, the file's format and size, the duration and the host — the type has no field
 * that could carry a title, a file name or a path, and `formatTimingLine` writes only these keys. Off (the default for
 * readers) the timer is a no-op: nothing is allocated per step and nothing is written.
 *
 * Pure: the clock and the sink are injected (no Node / DOM global).
 */

export type TimingFlow = 'import' | 'open'

export const TIMING_STEPS = [
  'pick-to-start',
  'download',
  'copy',
  'copy-fallback',
  'fingerprint',
  'duplicate-check',
  'details',
  'signature',
  'save',
  'cover',
  'open-read',
  'open-first-page',
  // Spec 017 (FR-019, research R11): each opening step, and how an opening ended. `open-first-page` is "opened";
  // the outcome of the others is in the step name, so a line keeps exactly the StepTiming keys (no free text).
  'open-content',
  'open-prepare',
  'open-position',
  'open-left',
  'open-failed-missing_file',
  'open-failed-unreadable',
  'open-failed-damaged',
  'open-failed-protected',
  'open-failed-too_large',
  'open-failed-took_too_long',
  'open-failed-not_available_offline',
  'open-failed-file_changed',
] as const

export type TimingStep = (typeof TIMING_STEPS)[number]

export type TimingHost = 'desktop' | 'phone'

/** A book format value (`DocumentFormat`), `zip` for an audiobook archive, or `unknown` before the format is known. */
export type TimingFormat = string

export type StepTiming = {
  flow: TimingFlow
  step: TimingStep
  format: TimingFormat
  sizeBytes: number
  ms: number
  host: TimingHost
  /** ISO-8601 time the step ended. */
  at: string
}

/** The only keys a timing line may have, in the order they are written. */
export const STEP_TIMING_KEYS = ['flow', 'step', 'format', 'sizeBytes', 'ms', 'host', 'at'] as const

export type TimingContext = { format: TimingFormat; sizeBytes: number }

export type StepMark = {
  /** Ends the step and records it; later calls do nothing. Returns the record (undefined when timing is off). */
  end: () => StepTiming | undefined
}

export type StepTimer = {
  readonly enabled: boolean
  start: (flow: TimingFlow, step: TimingStep, ctx: TimingContext) => StepMark
  /** Records a step measured elsewhere (e.g. the phone host returns its own durations). */
  record: (flow: TimingFlow, step: TimingStep, ctx: TimingContext, ms: number) => StepTiming | undefined
}

export type StepTimerOptions = {
  enabled: boolean
  host: TimingHost
  sink: (timing: StepTiming) => void
  /** Milliseconds clock (default `Date.now`). */
  now?: () => number
  /** ISO time of the end of a step (default `new Date().toISOString()`). */
  isoNow?: () => string
}

const NOOP_MARK: StepMark = { end: () => undefined }

const NOOP_TIMER: StepTimer = {
  enabled: false,
  start: () => NOOP_MARK,
  record: () => undefined,
}

const FLOWS: readonly string[] = ['import', 'open']
const HOSTS: readonly string[] = ['desktop', 'phone']
const STEPS: readonly string[] = TIMING_STEPS
/** Format values are short lowercase tokens; anything else (e.g. a name) is refused. */
const FORMAT_RE = /^[a-z0-9]{1,8}$/

export function createStepTimer(options: StepTimerOptions): StepTimer {
  if (!options.enabled) return NOOP_TIMER
  const now = options.now ?? (() => Date.now())
  const isoNow = options.isoNow ?? (() => new Date().toISOString())
  const emit = (t: StepTiming) => {
    try {
      options.sink(t)
    } catch {
      // A timing sink failing (disk full, closed IPC) must never break an import or an open.
    }
    return t
  }
  const record = (flow: TimingFlow, step: TimingStep, ctx: TimingContext, ms: number) =>
    emit({
      flow,
      step,
      format: ctx.format,
      sizeBytes: Math.max(0, Math.round(ctx.sizeBytes)),
      ms: Math.max(0, ms),
      host: options.host,
      at: isoNow(),
    })
  return {
    enabled: true,
    start: (flow, step, ctx) => {
      const startedAt = now()
      let done = false
      return {
        end: () => {
          if (done) return undefined
          done = true
          return record(flow, step, ctx, now() - startedAt)
        },
      }
    },
    record,
  }
}

/** One JSON line with exactly the `StepTiming` keys, whatever else the object carries. */
export function formatTimingLine(t: StepTiming): string {
  const out: Record<string, unknown> = {}
  for (const key of STEP_TIMING_KEYS) out[key] = t[key]
  return JSON.stringify(out)
}

/**
 * Parses a timing line (or an already parsed object) and returns it only if it has exactly the `StepTiming` keys with
 * valid values; otherwise `null`. Used by Main to re-validate renderer lines and by `spike:import:timing`.
 */
export function parseTimingLine(input: string | unknown): StepTiming | null {
  let value: unknown = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length !== STEP_TIMING_KEYS.length || !STEP_TIMING_KEYS.every((k) => keys.includes(k))) return null
  const { flow, step, format, sizeBytes, ms, host, at } = o
  if (typeof flow !== 'string' || !FLOWS.includes(flow)) return null
  if (typeof step !== 'string' || !STEPS.includes(step)) return null
  if (typeof host !== 'string' || !HOSTS.includes(host)) return null
  if (typeof format !== 'string' || !FORMAT_RE.test(format)) return null
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null
  return {
    flow: flow as TimingFlow,
    step: step as TimingStep,
    format,
    sizeBytes,
    ms,
    host: host as TimingHost,
    at,
  }
}
