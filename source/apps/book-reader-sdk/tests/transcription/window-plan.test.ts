import { describe, expect, it } from 'vitest'
import { planWindows } from '../../src/transcription/window-plan'

describe('planWindows', () => {
  it('uses 30 s windows with 2 s overlap by default', () => {
    expect(planWindows([0, 60_000])).toEqual([
      { startMs: 0, lengthMs: 30_000 },
      { startMs: 28_000, lengthMs: 30_000 },
      { startMs: 56_000, lengthMs: 4_000 },
    ])
  })

  it('a range shorter than a window is one window of its own length', () => {
    expect(planWindows([5_000, 12_000])).toEqual([{ startMs: 5_000, lengthMs: 7_000 }])
  })

  it('a range of exactly one window is one window', () => {
    expect(planWindows([0, 30_000])).toEqual([{ startMs: 0, lengthMs: 30_000 }])
  })

  it('starts at the range start and the last window ends exactly at the range end', () => {
    for (const [start, end] of [[0, 91_234], [12_345, 200_000], [1, 30_001]] as const) {
      const windows = planWindows([start, end])
      expect(windows[0]?.startMs).toBe(start)
      const last = windows[windows.length - 1]!
      expect(last.startMs + last.lengthMs).toBe(end)
    }
  })

  it('never makes a window longer than the limit or empty, and consecutive windows overlap by the set amount', () => {
    const windows = planWindows([0, 150_000])
    for (const w of windows) {
      expect(w.lengthMs).toBeGreaterThan(0)
      expect(w.lengthMs).toBeLessThanOrEqual(30_000)
    }
    for (let i = 1; i < windows.length; i += 1) {
      const prev = windows[i - 1]!
      expect(prev.startMs + prev.lengthMs - windows[i]!.startMs).toBe(2_000)
    }
  })

  it('covers every millisecond of the range', () => {
    const windows = planWindows([0, 100_000])
    for (let t = 0; t < 100_000; t += 997) {
      expect(windows.some((w) => t >= w.startMs && t < w.startMs + w.lengthMs)).toBe(true)
    }
  })

  it('an unusable range gives no windows', () => {
    expect(planWindows([10, 10])).toEqual([])
    expect(planWindows([20, 10])).toEqual([])
    expect(planWindows([-5, 10])).toEqual([])
    expect(planWindows([0, Infinity])).toEqual([])
  })

  it('honours custom sizes and rejects impossible ones', () => {
    expect(planWindows([0, 25], { windowMs: 10, overlapMs: 0 })).toEqual([
      { startMs: 0, lengthMs: 10 },
      { startMs: 10, lengthMs: 10 },
      { startMs: 20, lengthMs: 5 },
    ])
    expect(() => planWindows([0, 100], { windowMs: 10, overlapMs: 10 })).toThrow(RangeError)
    expect(() => planWindows([0, 100], { windowMs: 0 })).toThrow(RangeError)
    expect(() => planWindows([0, 100], { overlapMs: -1 })).toThrow(RangeError)
  })
})
