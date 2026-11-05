import { describe, expect, it } from 'vitest'
import {
  audioProgressPatch,
  parseAudioProgress,
  sanitizeAudioProgressInput,
  type AudioProgressInput,
} from '../../src/audio/audio-progress'

const NOW = '2026-01-01T00:00:00.000Z'

/** RFC 7396 JSON merge-patch — the semantics of SQLite's `json_patch` (also re-checked against the real engine in the spikes). */
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out: Record<string, unknown> =
    target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {}
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === null) delete out[k]
    else out[k] = mergePatch(out[k], v)
  }
  return out
}

describe('audioProgressPatch — single-file output is unchanged (golden)', () => {
  const cases: Array<[string, AudioProgressInput, unknown]> = [
    [
      'position + rate only',
      { positionSeconds: 12.5, playbackRate: 1 },
      { audioProgress: { positionSeconds: 12.5, playbackRate: 1, updatedAt: NOW } },
    ],
    [
      'with duration -> percent',
      { positionSeconds: 30, playbackRate: 1.25, durationSeconds: 120 },
      { audioProgress: { positionSeconds: 30, playbackRate: 1.25, updatedAt: NOW, durationSeconds: 120 }, percent: 25 },
    ],
    [
      'scope and chapter',
      { positionSeconds: 5, playbackRate: 1, durationSeconds: 100, scope: 'chapter', chapterId: 'c1' },
      { audioProgress: { positionSeconds: 5, playbackRate: 1, updatedAt: NOW, durationSeconds: 100, scope: 'chapter', chapterId: 'c1' }, percent: 5 },
    ],
    [
      'null chapter id deletes',
      { positionSeconds: 5, playbackRate: 1, chapterId: null },
      { audioProgress: { positionSeconds: 5, playbackRate: 1, updatedAt: NOW, chapterId: null } },
    ],
  ]
  it.each(cases)('%s', (_n, input, expected) => {
    expect(audioProgressPatch(input, NOW)).toEqual(expected)
    // key set is exactly what it was: no trackId / percent null leaks into single-file patches
    const patch = audioProgressPatch(input, NOW) as { audioProgress: Record<string, unknown> } & Record<string, unknown>
    expect('trackId' in patch.audioProgress).toBe(false)
  })
})

describe('audioProgressPatch — trackId (multi-chapter) deletes stale book-level values', () => {
  const stored = {
    percent: 42,
    lastReadLocation: 'x',
    updatedAt: 'state-updated',
    audioBookmarks: [{ id: 'n1', positionSeconds: 3 }],
    audioProgress: {
      positionSeconds: 100,
      durationSeconds: 3600,
      playbackRate: 1.5,
      scope: 'book',
      chapterId: 'old-chapter',
      updatedAt: 'old',
    },
  }
  const input: AudioProgressInput = { positionSeconds: 5, playbackRate: 1, trackId: 't1', scope: 'chapter' }

  it('a stored progress that already has percent + durationSeconds + chapterId ends with none of them', () => {
    const next = mergePatch(stored, audioProgressPatch(input, NOW)) as typeof stored & { audioProgress: Record<string, unknown> }
    expect('percent' in next).toBe(false)
    expect('durationSeconds' in next.audioProgress).toBe(false)
    expect('chapterId' in next.audioProgress).toBe(false)
    expect(next.audioProgress).toEqual({ positionSeconds: 5, playbackRate: 1, scope: 'chapter', trackId: 't1', updatedAt: NOW })
    // everything else of the reading state survives
    expect(next.lastReadLocation).toBe('x')
    expect(next.updatedAt).toBe('state-updated')
    expect(next.audioBookmarks).toEqual(stored.audioBookmarks)
  })

  it('does so even when the input carries a duration or a chapter id', () => {
    const noisy: AudioProgressInput = { ...input, durationSeconds: 90, chapterId: 'c9' }
    const patch = audioProgressPatch(noisy, NOW)
    const next = mergePatch(stored, patch) as { percent?: number; audioProgress: Record<string, unknown> }
    expect('percent' in next).toBe(false)
    expect('durationSeconds' in next.audioProgress).toBe(false)
    expect('chapterId' in next.audioProgress).toBe(false)
  })

  it('saving again keeps them absent, and the position stays the one just written', () => {
    const once = mergePatch(stored, audioProgressPatch(input, NOW))
    const twice = mergePatch(once, audioProgressPatch({ ...input, positionSeconds: 9, trackId: 't2' }, NOW)) as { audioProgress: Record<string, unknown> }
    expect(twice.audioProgress).toMatchObject({ positionSeconds: 9, trackId: 't2' })
    expect('durationSeconds' in twice.audioProgress).toBe(false)
    expect('percent' in (twice as object)).toBe(false)
  })

  it('never computes a percentage (null = delete), even for a position that would give one', () => {
    const patch = audioProgressPatch({ positionSeconds: 50, playbackRate: 1, durationSeconds: 100, trackId: 't1' }, NOW)
    expect(patch.percent).toBeNull()
    expect(patch.audioProgress.durationSeconds).toBeNull()
    expect(patch.audioProgress.chapterId).toBeNull()
  })

  it('omission would have left the stale values (why explicit nulls are required)', () => {
    const omitted = mergePatch(stored, { audioProgress: { positionSeconds: 5, playbackRate: 1, trackId: 't1', updatedAt: NOW } }) as { percent?: number; audioProgress: Record<string, unknown> }
    expect(omitted.percent).toBe(42)
    expect(omitted.audioProgress.durationSeconds).toBe(3600)
  })
})

describe('trackId in sanitize / parse', () => {
  const base = { positionSeconds: 3, playbackRate: 1 }
  it('sanitize keeps a valid trackId and drops empty, blank, over-long and non-string ones', () => {
    expect(sanitizeAudioProgressInput({ ...base, trackId: 'abc' })?.trackId).toBe('abc')
    for (const bad of ['', '   ', 'x'.repeat(101), 5, null, {}, ['a']]) {
      expect(sanitizeAudioProgressInput({ ...base, trackId: bad })?.trackId, String(bad)).toBeUndefined()
    }
    expect(sanitizeAudioProgressInput({ ...base, trackId: 'x'.repeat(100) })?.trackId).toHaveLength(100)
  })
  it('sanitize without trackId is exactly what it was', () => {
    expect(sanitizeAudioProgressInput({ ...base, scope: 'book', chapterId: 'c', durationSeconds: 10 })).toEqual({
      positionSeconds: 3,
      playbackRate: 1,
      durationSeconds: 10,
      scope: 'book',
      chapterId: 'c',
    })
  })
  it('parse round-trips trackId and reads legacy rows (no trackId) as before', () => {
    expect(parseAudioProgress({ audioProgress: { positionSeconds: 3, playbackRate: 1, updatedAt: 'u', trackId: 't9' } })).toEqual({
      positionSeconds: 3,
      playbackRate: 1,
      updatedAt: 'u',
      trackId: 't9',
    })
    expect(parseAudioProgress({ audioProgress: { positionSeconds: 3, durationSeconds: 60, playbackRate: 1, updatedAt: 'u', chapterId: 'c', scope: 'chapter' } })).toEqual({
      positionSeconds: 3,
      durationSeconds: 60,
      playbackRate: 1,
      updatedAt: 'u',
      chapterId: 'c',
      scope: 'chapter',
    })
    for (const bad of [5, '', null, {}]) {
      expect(parseAudioProgress({ audioProgress: { positionSeconds: 3, playbackRate: 1, trackId: bad as string | null } })?.trackId).toBeUndefined()
    }
  })
})
