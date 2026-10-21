import { describe, expect, it } from 'vitest'
import { audioMimeForFormat, isAudioFormat } from '../../src/audio/audio-formats'
import { audioProgressPatch, parseAudioProgress, sanitizeAudioProgressInput } from '../../src/audio/audio-progress'
import { DocumentFormat, isDocumentFormat, parseDocumentFormat } from '../../src/domain/book/document-format'
import { parseReadingState } from '../../src/persistence/books-json'

describe('audio formats', () => {
  it('mp3 is a document format and an audio format with a fixed MIME', () => {
    expect(DocumentFormat.Mp3).toBe('mp3')
    expect(isDocumentFormat('mp3')).toBe(true)
    expect(parseDocumentFormat('mp3')).toBe(DocumentFormat.Mp3)
    expect(isAudioFormat('mp3')).toBe(true)
    expect(audioMimeForFormat('mp3')).toBe('audio/mpeg')
  })

  it('formats that are not verified stay out', () => {
    for (const f of ['m4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'aif', 'zip']) {
      expect(isDocumentFormat(f)).toBe(false)
      expect(isAudioFormat(f)).toBe(false)
      expect(audioMimeForFormat(f)).toBeUndefined()
    }
    expect(() => parseDocumentFormat('m4b')).toThrow()
  })

  it('text formats are not audio (and "toString"-style keys do not leak through the lookup)', () => {
    for (const f of ['epub', 'pdf', 'txt', 'md', 'toString', '__proto__', 'constructor', '', null, undefined])
      expect(isAudioFormat(f)).toBe(false)
  })
})

describe('sanitizeAudioProgressInput', () => {
  it('accepts a good payload and normalises the rate', () => {
    expect(sanitizeAudioProgressInput({ positionSeconds: 12.5, durationSeconds: 175, playbackRate: 1.25 })).toEqual({
      positionSeconds: 12.5,
      durationSeconds: 175,
      playbackRate: 1.25,
    })
    expect(sanitizeAudioProgressInput({ positionSeconds: 0, playbackRate: 99 })).toEqual({ positionSeconds: 0, playbackRate: 4 })
  })
  it('drops an unknown duration instead of storing NaN / Infinity', () => {
    expect(sanitizeAudioProgressInput({ positionSeconds: 3, durationSeconds: Infinity, playbackRate: 1 })).toEqual({
      positionSeconds: 3,
      playbackRate: 1,
    })
  })
  it('rejects garbage', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { positionSeconds: -1, playbackRate: 1 }, { positionSeconds: NaN, playbackRate: 1 }, { positionSeconds: 1e12, playbackRate: 1 }, { positionSeconds: 1, playbackRate: 'fast' }])
      expect(sanitizeAudioProgressInput(bad)).toBeUndefined()
  })
})

describe('audioProgressPatch / parseAudioProgress', () => {
  it('patch carries audioProgress + percent only — never location, typography or the top-level updatedAt', () => {
    const patch = audioProgressPatch({ positionSeconds: 50, durationSeconds: 200, playbackRate: 1 }, '2026-10-21T10:00:00.000Z')
    expect(patch).toEqual({
      audioProgress: { positionSeconds: 50, durationSeconds: 200, playbackRate: 1, updatedAt: '2026-10-21T10:00:00.000Z' },
      percent: 25,
    })
    expect(Object.keys(patch).sort()).toEqual(['audioProgress', 'percent'])
  })
  it('no percent while the duration is unknown', () => {
    const patch = audioProgressPatch({ positionSeconds: 50, playbackRate: 1 }, 'now')
    expect(patch.percent).toBeUndefined()
    expect('percent' in patch).toBe(false)
  })
  it('round-trips through the stored reading state without disturbing other keys', () => {
    const existing = { lastReadLocation: 'x', fontSize: 18, updatedAt: '2026-01-01T00:00:00.000Z' }
    const merged = { ...existing, ...audioProgressPatch({ positionSeconds: 7, durationSeconds: 70, playbackRate: 1.5 }, 'T') }
    const state = parseReadingState(JSON.stringify(merged))
    expect(state.fontSize).toBe(18)
    expect(state.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(parseAudioProgress(state)).toEqual({ positionSeconds: 7, durationSeconds: 70, playbackRate: 1.5, updatedAt: 'T' })
  })
  it('malformed stored progress → undefined; other formats have none', () => {
    expect(parseAudioProgress({})).toBeUndefined()
    expect(parseAudioProgress(null)).toBeUndefined()
    expect(parseAudioProgress({ audioProgress: { positionSeconds: -3 } })).toBeUndefined()
    expect(parseAudioProgress(parseReadingState('{"audioProgress":"oops"}'))).toBeUndefined()
    expect(parseAudioProgress(parseReadingState('not json'))).toBeUndefined()
  })
})
