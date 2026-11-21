/**
 * Spec 016 (research R1): the renderer's developer step timer, shared by both hosts.
 *
 * Asks the host once whether timing is on (Desktop `READMATE_TIMING=1`, phone dev build + `readmate.devTiming`); until
 * the answer arrives, and whenever it is "off", every call is a no-op. Finished steps go to `appApi.recordTiming`.
 */
import { createStepTimer, type StepMark, type StepTimer, type TimingContext, type TimingFlow, type TimingStep } from '@core'
import { appApi } from '../../bridge/app'
import { isMobileHost } from '../../platforms/host'

let timer: StepTimer | null = null
let asked = false

function currentTimer(): StepTimer | null {
  if (!asked) {
    asked = true
    void appApi.getTimingEnabled().then((enabled) => {
      timer = createStepTimer({
        enabled,
        host: isMobileHost() ? 'phone' : 'desktop',
        sink: (t) => void appApi.recordTiming(t),
      })
    })
  }
  return timer
}

const NOOP_MARK: StepMark = { end: () => undefined }

/** Starts a step; `end()` records it (no-op while timing is off or not known yet). */
export function startStep(flow: TimingFlow, step: TimingStep, ctx: TimingContext): StepMark {
  const t = currentTimer()
  return t?.enabled ? t.start(flow, step, ctx) : NOOP_MARK
}

/** Records a step measured elsewhere (e.g. durations returned by the phone host). */
export function recordStep(flow: TimingFlow, step: TimingStep, ctx: TimingContext, ms: number): void {
  const t = currentTimer()
  if (t?.enabled) t.record(flow, step, ctx, ms)
}

/** Asks the host now, so the answer is known before the first import / open. */
export function primeStepTimer(): void {
  currentTimer()
}
