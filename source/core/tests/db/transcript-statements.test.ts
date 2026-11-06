import { describe, expect, it } from 'vitest'
import { transcriptCodec, transcriptStatements as q } from '../../src/index.js'

const placeholders = (sql: string): number => (sql.match(/\?/g) ?? []).length
const now = '2026-01-01T00:00:00.000Z'

describe('transcript statements', () => {
  it('every builder binds exactly as many parameters as it has placeholders', () => {
    const all = [
      q.selectTranscriptWithCount('b'),
      q.selectBookExists('b'),
      q.updateTranscriptModel('b', 'en', 'm', now),
      q.insertTranscript('t', 'b', 'en', 'm', now),
      q.selectTranscriptCovered('b'),
      q.selectTranscriptId('b'),
      q.selectOverlappingPassages('t', undefined, 0, 1000),
      q.selectOverlappingPassages('t', 'track', 0, 1000),
      q.deletePassage(1),
      q.insertPassage('t', null, 0, 1, 'x'),
      q.updateCovered('t', '{}', now),
      q.selectPassages('b'),
      q.selectPassages('b', { trackId: 'c', fromMs: 1, toMs: 2, limit: 5, offset: 3 }),
      q.searchPassages('"a"*', 'b'),
      q.updateJobState('b', 'running', now),
      q.updateJobState('b', null, now, 'INTERRUPTED'),
      q.updateStatus('b', 'partial', now),
      q.updateStatus('b', 'failed', now, null),
      q.updateScope('b', { kind: 'whole' }, now),
      q.endJob('b', 'complete', null, now),
      q.deletePassagesOfTranscript('t'),
      q.resetTranscript('t', now),
      q.deleteTranscriptOfBook('b'),
      q.recoverInterrupted(now),
    ]
    for (const statement of all) expect(statement.params.length, statement.sql).toBe(placeholders(statement.sql))
  })

  it('the overlap query filters by track only when there is one', () => {
    expect(q.selectOverlappingPassages('t', undefined, 10, 20).sql).toContain('p.track_id IS NULL')
    expect(q.selectOverlappingPassages('t', 'x', 10, 20).params).toEqual(['t', 'x', 20, 10])
  })

  it('selectPassages clamps the limit and floors the offset', () => {
    expect(q.selectPassages('b', { limit: 99999, offset: -4 }).params).toEqual(['b', transcriptCodec.MAX_PASSAGE_LIMIT, 0])
    expect(q.selectPassages('b').params).toEqual(['b', transcriptCodec.DEFAULT_PASSAGE_LIMIT, 0])
  })

  it('an optional last error is only touched when given', () => {
    expect(q.updateJobState('b', 'queued', now).sql).not.toContain('last_error')
    expect(q.updateJobState('b', 'queued', now, null).params).toEqual(['queued', now, null, 'b'])
  })
})

describe('transcript codec', () => {
  it('builds a safe FTS query: quoted words, prefix on the last, empty -> null', () => {
    expect(transcriptCodec.buildFtsQuery(' a  "b" ')).toBe('"a" "b"*')
    expect(transcriptCodec.buildFtsQuery('""')).toBeNull()
    expect(transcriptCodec.buildFtsQuery('NEAR -x')).toBe('"NEAR" "-x"*')
  })

  it('parseScope accepts valid scopes and turns anything else into null', () => {
    expect(transcriptCodec.parseScope(JSON.stringify({ kind: 'whole' }))).toEqual({ kind: 'whole' })
    expect(transcriptCodec.parseScope(JSON.stringify({ kind: 'track', trackId: 't' }))).toEqual({ kind: 'track', trackId: 't' })
    expect(transcriptCodec.parseScope(JSON.stringify({ kind: 'range', startMs: 0, endMs: 10 }))).toEqual({ kind: 'range', startMs: 0, endMs: 10 })
    expect(transcriptCodec.parseScope(JSON.stringify({ kind: 'range', startMs: 10, endMs: 0 }))).toBeNull()
    expect(transcriptCodec.parseScope(JSON.stringify({ kind: 'track' }))).toBeNull()
    expect(transcriptCodec.parseScope('nope')).toBeNull()
    expect(transcriptCodec.parseScope(null)).toBeNull()
  })

  it('a row reads back with a safe status, job state and coverage', () => {
    const record = transcriptCodec.transcriptFromRow({
      id: 't', book_id: 'b', language: 'en', model_id: 'm', status: 'garbage', job_state: 'weird', last_error: 'nope',
      scope_json: null, covered_json: '{"-":[[0,1000],[1000,3000]]}', created_at: now, updated_at: now, passage_count: 2,
    })
    expect(record).toMatchObject({ status: 'failed', jobState: null, lastError: null, scope: null, passageCount: 2 })
    expect(record.coveredMs).toBeGreaterThan(0)
  })
})
