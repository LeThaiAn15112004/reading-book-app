import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LISTENING_PREFS,
  SKIP_LENGTHS,
  applyResumeRewind,
  normalizeListeningPrefs,
  resumeRewindSeconds,
} from '../../src/audio/listening-prefs'

describe('resumeRewindSeconds (spec 018 FR-029)', () => {
  it.each([
    [0, 0],
    [59_999, 0],
    [60_000, 3],
    [599_999, 3],
    [600_000, 5],
    [3_599_999, 5],
    [3_600_000, 10],
    [24 * 3_600_000, 10],
  ])('a pause of %i ms rewinds %i s', (ms, seconds) => {
    expect(resumeRewindSeconds(ms)).toBe(seconds)
  })

  it('treats a non-finite or negative pause as no pause', () => {
    expect(resumeRewindSeconds(Number.NaN)).toBe(0)
    expect(resumeRewindSeconds(-5_000)).toBe(0)
  })
})

describe('applyResumeRewind', () => {
  it('goes back by the rewind', () => {
    expect(applyResumeRewind(100, 20 * 60_000, 0)).toBe(95)
  })

  it('never goes before the start of the chapter / track', () => {
    expect(applyResumeRewind(62, 2 * 3_600_000, 60)).toBe(60)
    expect(applyResumeRewind(2, 2 * 3_600_000, 0)).toBe(0)
  })

  it('keeps the position for a short pause', () => {
    expect(applyResumeRewind(100, 30_000, 0)).toBe(100)
  })

  it('never moves forward when the floor is after the position', () => {
    expect(applyResumeRewind(10, 20 * 60_000, 50)).toBe(10)
  })
})

describe('normalizeListeningPrefs', () => {
  it('fills the defaults', () => {
    expect(normalizeListeningPrefs(undefined)).toEqual(DEFAULT_LISTENING_PREFS)
    expect(DEFAULT_LISTENING_PREFS).toMatchObject({ skipBackSeconds: 15, skipForwardSeconds: 30, autoRewind: true })
  })

  it('keeps every allowed skip length and rejects others', () => {
    for (const n of SKIP_LENGTHS) {
      expect(normalizeListeningPrefs({ skipBackSeconds: n, skipForwardSeconds: n })).toMatchObject({
        skipBackSeconds: n,
        skipForwardSeconds: n,
      })
    }
    expect(normalizeListeningPrefs({ skipBackSeconds: 20, skipForwardSeconds: '30' })).toMatchObject({
      skipBackSeconds: 15,
      skipForwardSeconds: 30,
    })
  })

  it('validates the flags and clamps the volume', () => {
    expect(normalizeListeningPrefs({ autoRewind: false, muted: true, volumeBeforeMute: 3 })).toMatchObject({
      autoRewind: false,
      muted: true,
      volumeBeforeMute: 1,
    })
    expect(normalizeListeningPrefs({ autoRewind: 'no', volumeBeforeMute: Number.NaN })).toMatchObject({
      autoRewind: true,
      volumeBeforeMute: 1,
    })
  })
})
