import { describe, expect, it } from 'vitest'
import {
  MAIN_TRACK_KEY,
  isTranscriptStatus,
  isTranscriptionErrorCode,
  isValidPassage,
  normalisePassageText,
  parseCoveredRanges,
  trackKey,
} from '../../src/transcription/transcript-model'

describe('transcript model', () => {
  it('trackKey maps a missing track to the single-file key', () => {
    expect(trackKey(undefined)).toBe(MAIN_TRACK_KEY)
    expect(trackKey(null)).toBe(MAIN_TRACK_KEY)
    expect(trackKey('')).toBe(MAIN_TRACK_KEY)
    expect(trackKey('ch-1')).toBe('ch-1')
  })

  it('status and error code guards', () => {
    expect(isTranscriptStatus('partial')).toBe(true)
    expect(isTranscriptStatus('none')).toBe(false)
    expect(isTranscriptionErrorCode('INTERRUPTED')).toBe(true)
    expect(isTranscriptionErrorCode('INTEGRITY_FAILED')).toBe(true)
    expect(isTranscriptionErrorCode('FEATURE_DISABLED')).toBe(true)
    expect(isTranscriptionErrorCode('nope')).toBe(false)
  })

  it('normalises passage text', () => {
    expect(normalisePassageText('  hello \n  world\t ')).toBe('hello world')
    expect(normalisePassageText('   ')).toBe('')
  })

  it('isValidPassage enforces 0 <= start < end and trimmed non-empty text', () => {
    expect(isValidPassage({ startMs: 0, endMs: 1, text: 'a' })).toBe(true)
    expect(isValidPassage({ startMs: 5, endMs: 5, text: 'a' })).toBe(false)
    expect(isValidPassage({ startMs: -1, endMs: 5, text: 'a' })).toBe(false)
    expect(isValidPassage({ startMs: 0, endMs: 5, text: '' })).toBe(false)
    expect(isValidPassage({ startMs: 0, endMs: 5, text: ' a' })).toBe(false)
  })

  it('parseCoveredRanges keeps good intervals sorted and drops anything malformed', () => {
    expect(
      parseCoveredRanges({ main: [[30, 40], [0, 10], 'x', [5], [9, 3], [1, 'a']], t1: [], t2: 'no' }),
    ).toEqual({ main: [[0, 10], [30, 40]] })
    expect(parseCoveredRanges(null)).toEqual({})
    expect(parseCoveredRanges([])).toEqual({})
    expect(parseCoveredRanges('{}')).toEqual({})
  })
})
