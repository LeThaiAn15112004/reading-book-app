import { describe, expect, it } from 'vitest'
import {
  STEP_TIMING_KEYS,
  createStepTimer,
  formatTimingLine,
  parseTimingLine,
  type StepTiming,
  type TimingStep,
} from '../../src/perf/step-timing'

function fakeClock(...times: number[]) {
  let i = 0
  return () => times[Math.min(i++, times.length - 1)]!
}

describe('createStepTimer', () => {
  it('is a no-op when off: nothing is recorded and end() returns nothing', () => {
    const seen: StepTiming[] = []
    const timer = createStepTimer({ enabled: false, host: 'desktop', sink: (t) => seen.push(t) })
    const mark = timer.start('import', 'fingerprint', { format: 'pdf', sizeBytes: 10 })
    expect(mark.end()).toBeUndefined()
    expect(timer.record('import', 'save', { format: 'pdf', sizeBytes: 10 }, 5)).toBeUndefined()
    expect(seen).toEqual([])
    expect(timer.enabled).toBe(false)
  })

  it('records one StepTiming per finished step when on', () => {
    const seen: StepTiming[] = []
    const timer = createStepTimer({
      enabled: true,
      host: 'phone',
      now: fakeClock(100, 350),
      isoNow: () => '2026-11-21T00:00:00.000Z',
      sink: (t) => seen.push(t),
    })
    const mark = timer.start('import', 'copy', { format: 'epub', sizeBytes: 2048 })
    const t = mark.end()
    expect(t).toEqual({
      flow: 'import',
      step: 'copy',
      format: 'epub',
      sizeBytes: 2048,
      ms: 250,
      host: 'phone',
      at: '2026-11-21T00:00:00.000Z',
    })
    expect(seen).toEqual([t])
  })

  it('records a step only once even if end() is called again', () => {
    const seen: StepTiming[] = []
    const timer = createStepTimer({ enabled: true, host: 'desktop', now: fakeClock(0, 5, 9), sink: (t) => seen.push(t) })
    const mark = timer.start('open', 'open-read', { format: 'pdf', sizeBytes: 1 })
    mark.end()
    expect(mark.end()).toBeUndefined()
    expect(seen).toHaveLength(1)
  })

  it('never reports a negative duration (clock going back)', () => {
    const timer = createStepTimer({ enabled: true, host: 'desktop', now: fakeClock(50, 10), sink: () => {} })
    expect(timer.start('open', 'open-first-page', { format: 'txt', sizeBytes: 0 }).end()?.ms).toBe(0)
  })

  it('a failing sink never breaks the caller', () => {
    const timer = createStepTimer({ enabled: true, host: 'desktop', sink: () => { throw new Error('disk full') } })
    expect(() => timer.record('import', 'save', { format: 'md', sizeBytes: 3 }, 1)).not.toThrow()
  })
})

describe('formatTimingLine / parseTimingLine', () => {
  const sample: StepTiming = {
    flow: 'import',
    step: 'details',
    format: 'pdf',
    sizeBytes: 123,
    ms: 4.5,
    host: 'desktop',
    at: '2026-11-21T00:00:00.000Z',
  }

  it('writes one JSON line whose keys are exactly the StepTiming fields (no title, file name or path — FR-001)', () => {
    const line = formatTimingLine(sample)
    expect(line.includes('\n')).toBe(false)
    expect(Object.keys(JSON.parse(line))).toEqual([...STEP_TIMING_KEYS])
  })

  it('drops any extra key a caller might pass', () => {
    const withExtra = { ...sample, title: 'Secret book', path: 'C:/Users/me/book.pdf' } as unknown as StepTiming
    const line = formatTimingLine(withExtra)
    expect(line).not.toContain('Secret')
    expect(line).not.toContain('C:/')
  })

  it('round-trips and refuses lines with other keys or bad values', () => {
    expect(parseTimingLine(formatTimingLine(sample))).toEqual(sample)
    expect(parseTimingLine(JSON.stringify({ ...sample, fileName: 'a.pdf' }))).toBeNull()
    expect(parseTimingLine(JSON.stringify({ ...sample, step: 'unknown-step' }))).toBeNull()
    expect(parseTimingLine(JSON.stringify({ ...sample, ms: -1 }))).toBeNull()
    expect(parseTimingLine(JSON.stringify({ ...sample, host: 'server' }))).toBeNull()
    expect(parseTimingLine('not json')).toBeNull()
  })

  it('accepts a parsed object as well as a string (Main re-validates renderer lines)', () => {
    expect(parseTimingLine({ ...sample })).toEqual(sample)
  })
})

// Type test: an unknown step name must not compile.
// @ts-expect-error — 'unpack' is not a TimingStep
const _bad: TimingStep = 'unpack'
void _bad
