import { describe, expect, it } from 'vitest'
import {
  TRACK_RESTART_THRESHOLD_SECONDS,
  nextTrackIndex,
  previousTrackAction,
  resolveInitialTrack,
  trackDurationLabel,
  trackEyebrow,
  trackNumberLabel,
  type AudioTrack,
} from '../../src/audio/audio-tracks'

const tracks: AudioTrack[] = [
  { id: 'a', title: 'One', durationSeconds: 60 },
  { id: 'b', title: 'Two', durationSeconds: null },
  { id: 'c', title: 'Three', durationSeconds: 90 },
]

describe('resolveInitialTrack', () => {
  it('a saved trackId that exists gives that track and the saved position', () => {
    expect(resolveInitialTrack(tracks, { trackId: 'c', positionSeconds: 42.5 })).toEqual({ index: 2, startSeconds: 42.5 })
    expect(resolveInitialTrack(tracks, { trackId: 'a', positionSeconds: 0 })).toEqual({ index: 0, startSeconds: 0 })
  })
  it('a missing, non-string, empty or unknown trackId gives track 0 at 0 and DISCARDS the saved position', () => {
    for (const trackId of [undefined, null, '', 5, {}, ['a'], 'zzz', 'A']) {
      expect(resolveInitialTrack(tracks, { trackId, positionSeconds: 500 }), String(trackId)).toEqual({ index: 0, startSeconds: 0 })
    }
    expect(resolveInitialTrack(tracks, { positionSeconds: 500 })).toEqual({ index: 0, startSeconds: 0 }) // legacy-shaped progress
    expect(resolveInitialTrack(tracks, null)).toEqual({ index: 0, startSeconds: 0 })
    expect(resolveInitialTrack(tracks, undefined)).toEqual({ index: 0, startSeconds: 0 })
  })
  it('a bad saved position with a valid trackId starts that track at 0', () => {
    for (const positionSeconds of [-5, Number.NaN, Number.POSITIVE_INFINITY, '12', null, undefined]) {
      expect(resolveInitialTrack(tracks, { trackId: 'b', positionSeconds }), String(positionSeconds)).toEqual({ index: 1, startSeconds: 0 })
    }
  })
  it('no tracks (a single-file book) is index -1', () => {
    expect(resolveInitialTrack([], { trackId: 'a', positionSeconds: 5 })).toEqual({ index: -1, startSeconds: 0 })
  })
})

describe('previousTrackAction', () => {
  it('restarts the track when more than 3 s in, goes back otherwise', () => {
    expect(TRACK_RESTART_THRESHOLD_SECONDS).toBe(3)
    expect(previousTrackAction(2, 3.01)).toBe('restart')
    expect(previousTrackAction(2, 120)).toBe('restart')
    expect(previousTrackAction(2, 3)).toBe('previous')
    expect(previousTrackAction(2, 0)).toBe('previous')
  })
  it('on the first track it always restarts', () => {
    expect(previousTrackAction(0, 0)).toBe('restart')
    expect(previousTrackAction(0, 99)).toBe('restart')
    expect(previousTrackAction(-1, 0)).toBe('restart')
  })
  it('a non-finite position counts as "at the start"', () => {
    expect(previousTrackAction(1, Number.NaN)).toBe('previous')
  })
})

describe('nextTrackIndex', () => {
  it('is the following index, and null after the last or for bad input', () => {
    expect(nextTrackIndex(0, 3)).toBe(1)
    expect(nextTrackIndex(1, 3)).toBe(2)
    expect(nextTrackIndex(2, 3)).toBeNull()
    expect(nextTrackIndex(0, 1)).toBeNull()
    expect(nextTrackIndex(-1, 3)).toBeNull()
    expect(nextTrackIndex(3, 3)).toBeNull()
    expect(nextTrackIndex(1.5, 3)).toBeNull()
    expect(nextTrackIndex(0, 0)).toBeNull()
  })
})

describe('trackEyebrow / trackNumberLabel / trackDurationLabel', () => {
  it('"Track N of M", null when the index names no track', () => {
    expect(trackEyebrow(0, 68)).toBe('Track 1 of 68')
    expect(trackEyebrow(67, 68)).toBe('Track 68 of 68')
    expect(trackEyebrow(68, 68)).toBeNull()
    expect(trackEyebrow(-1, 68)).toBeNull()
    expect(trackEyebrow(0, 0)).toBeNull()
    expect(trackEyebrow(0.5, 3)).toBeNull()
  })
  it('zero-padded row numbers', () => {
    expect(trackNumberLabel(0)).toBe('01')
    expect(trackNumberLabel(8)).toBe('09')
    expect(trackNumberLabel(99)).toBe('100')
  })
  it('durations: m:ss / h:mm:ss, an em dash while unknown', () => {
    expect(trackDurationLabel(871)).toBe('14:31')
    expect(trackDurationLabel(3725)).toBe('1:02:05')
    for (const unknown of [null, undefined, 0, -1, Number.NaN, '12', Number.POSITIVE_INFINITY]) {
      expect(trackDurationLabel(unknown), String(unknown)).toBe('—')
    }
  })
})
