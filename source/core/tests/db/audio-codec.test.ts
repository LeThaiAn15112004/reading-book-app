import { describe, expect, it } from 'vitest'
import { MAX_AUDIO_BOOKMARKS, audioCodec, audioStatements as q } from '../../src/index.js'

const note = (id: string, trackId?: string) => ({ id, positionSeconds: 5, createdAt: '2026-01-01T00:00:00.000Z', ...(trackId ? { trackId } : {}) })
const state = (audioBookmarks: unknown) => JSON.stringify({ audioBookmarks })
const ids = (list: { id: string }[]) => list.map((n) => n.id)

describe('audioCodec: single-file book', () => {
  it('a save without a trackId is written; one with a trackId is refused', () => {
    expect(ids(audioCodec.planAudioBookmarksSave('{}', [note('a'), note('b')], null)!)).toEqual(['a', 'b'])
    expect(audioCodec.planAudioBookmarksSave('{}', [note('a', 't1')], null)).toBeNull()
  })

  it('a stored stray trackId is never handed out', () => {
    const read = audioCodec.readAudioBookmarks(state([note('a', 't9')]), null)
    expect(read).toHaveLength(1)
    expect('trackId' in read[0]!).toBe(false)
  })
})

describe('audioCodec: multi-track book', () => {
  const owned = new Set(['t1', 't2'])

  it('a read returns only owned entries, and foreign ones do not take a visible slot', () => {
    const stored = [note('f1'), note('f2', 'other'), note('a', 't1')]
    expect(ids(audioCodec.readAudioBookmarks(state(stored), owned))).toEqual(['a'])
  })

  it('a save is refused whole when a Note names a foreign or missing track, or the list is over the cap', () => {
    expect(audioCodec.planAudioBookmarksSave('{}', [note('a', 't1'), note('b', 'other')], owned)).toBeNull()
    expect(audioCodec.planAudioBookmarksSave('{}', [note('a')], owned)).toBeNull()
    const tooMany = Array.from({ length: MAX_AUDIO_BOOKMARKS + 1 }, (_, i) => note(`n${i}`, 't1'))
    expect(audioCodec.planAudioBookmarksSave('{}', tooMany, owned)).toBeNull()
    expect(audioCodec.planAudioBookmarksSave('{}', 'not an array', owned)).toBeNull()
  })

  it('foreign stored entries are carried over, and an incoming Note wins over a foreign one with the same id', () => {
    const stored = state([note('keep'), note('dup', 'other'), note('mine', 't1')])
    const out = audioCodec.planAudioBookmarksSave(stored, [note('mine', 't1'), note('dup', 't2')], owned)!
    expect(ids(out).sort()).toEqual(['dup', 'keep', 'mine'])
    expect(out.find((n) => n.id === 'dup')?.trackId).toBe('t2')
  })
})

describe('audio statements', () => {
  it('bind as many parameters as placeholders', () => {
    for (const s of [q.selectFormatAndReadingState('b'), q.selectChapterIdsOfBook('b'), q.patchAudioBookmarks('b', '{}', 'now')]) {
      expect(s.params.length, s.sql).toBe((s.sql.match(/\?/g) ?? []).length)
    }
  })
})
