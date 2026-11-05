import { describe, expect, it } from 'vitest'
import {
  PROGRESS_SAVE_INTERVAL_MS,
  audioProgressPercent,
  clampPlaybackRate,
  clampSeekPosition,
  formatPlaybackTime,
  knownDuration,
  resolveRestorePosition,
  shouldPersistProgress,
} from '../../src/audio/audio-playback'

describe('knownDuration', () => {
  it('accepts only finite positive numbers (the element reports NaN / Infinity until it knows)', () => {
    expect(knownDuration(175.2)).toBe(175.2)
    for (const d of [NaN, Infinity, -Infinity, 0, -3, null, undefined, '12']) expect(knownDuration(d)).toBeNull()
  })
})

describe('clampSeekPosition', () => {
  it('clamps into [0, duration]', () => {
    expect(clampSeekPosition(50, 100)).toBe(50)
    expect(clampSeekPosition(-5, 100)).toBe(0)
    expect(clampSeekPosition(185, 100)).toBe(100)
    expect(clampSeekPosition(100, 100)).toBe(100)
  })
  it('unknown duration: only the lower bound applies', () => {
    expect(clampSeekPosition(500, NaN)).toBe(500)
    expect(clampSeekPosition(500, Infinity)).toBe(500)
    expect(clampSeekPosition(-1, NaN)).toBe(0)
  })
  it('garbage → 0', () => {
    expect(clampSeekPosition(NaN, 100)).toBe(0)
    expect(clampSeekPosition(undefined, 100)).toBe(0)
  })
})

describe('clampPlaybackRate', () => {
  it('keeps sane rates, clamps extremes, defaults garbage to 1', () => {
    expect(clampPlaybackRate(1.5)).toBe(1.5)
    expect(clampPlaybackRate(0)).toBe(0.25)
    expect(clampPlaybackRate(99)).toBe(4)
    expect(clampPlaybackRate(NaN)).toBe(1)
    expect(clampPlaybackRate('2')).toBe(1)
  })
})

describe('formatPlaybackTime', () => {
  it('m:ss and h:mm:ss', () => {
    expect(formatPlaybackTime(0)).toBe('0:00')
    expect(formatPlaybackTime(59.9)).toBe('0:59')
    expect(formatPlaybackTime(61)).toBe('1:01')
    expect(formatPlaybackTime(3599)).toBe('59:59')
    expect(formatPlaybackTime(3600)).toBe('1:00:00')
    expect(formatPlaybackTime(25510.27)).toBe('7:05:10')
  })
  it('non-finite or negative → placeholder', () => {
    for (const v of [NaN, Infinity, -1, undefined, null]) expect(formatPlaybackTime(v)).toBe('--:--')
  })
})

describe('audioProgressPercent', () => {
  it('rounds and clamps; unknown duration → undefined', () => {
    expect(audioProgressPercent(50, 200)).toBe(25)
    expect(audioProgressPercent(250, 200)).toBe(100)
    expect(audioProgressPercent(-1, 200)).toBe(0)
    expect(audioProgressPercent(10, NaN)).toBeUndefined()
    expect(audioProgressPercent(10, undefined)).toBeUndefined()
  })
})

describe('resolveRestorePosition', () => {
  it('resumes the saved position', () => {
    expect(resolveRestorePosition(87.5, 175)).toBe(87.5)
  })
  it('nothing saved / garbage → start', () => {
    for (const s of [undefined, null, NaN, -4, 0]) expect(resolveRestorePosition(s, 175)).toBe(0)
  })
  it('a finished book starts over', () => {
    expect(resolveRestorePosition(174, 175)).toBe(0)
    expect(resolveRestorePosition(175, 175)).toBe(0)
    expect(resolveRestorePosition(900, 175)).toBe(0)
    expect(resolveRestorePosition(172.9, 175)).toBe(172.9)
  })
  it('duration still unknown: trust the saved value', () => {
    expect(resolveRestorePosition(30, NaN)).toBe(30)
  })
})

describe('shouldPersistProgress', () => {
  const base = { force: false, position: 100, lastSavedPosition: 90, nowMs: 100_000, lastSavedAtMs: 100_000 - PROGRESS_SAVE_INTERVAL_MS }
  it('throttles to the interval', () => {
    expect(shouldPersistProgress(base)).toBe(true)
    expect(shouldPersistProgress({ ...base, lastSavedAtMs: base.nowMs - PROGRESS_SAVE_INTERVAL_MS + 1 })).toBe(false)
  })
  it('skips a position that barely moved', () => {
    expect(shouldPersistProgress({ ...base, position: 90.4 })).toBe(false)
  })
  it('first write always goes through; force bypasses the throttle', () => {
    expect(shouldPersistProgress({ ...base, lastSavedPosition: null, lastSavedAtMs: null })).toBe(true)
    expect(shouldPersistProgress({ ...base, force: true, position: 90, lastSavedAtMs: base.nowMs })).toBe(true)
  })
  it('never persists a non-finite or negative position', () => {
    expect(shouldPersistProgress({ ...base, force: true, position: NaN })).toBe(false)
    expect(shouldPersistProgress({ ...base, force: true, position: -1 })).toBe(false)
  })
})
