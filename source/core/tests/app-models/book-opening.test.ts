import { describe, expect, it } from 'vitest'
import {
  actionsFor,
  causeFromOpenErrorCode,
  contentFailed,
  contentReady,
  firstPageDrawn,
  isProtectedEpubEncryption,
  leave,
  outcomeTimingStep,
  positionDone,
  positionStarted,
  prepareFailed,
  showIndicator,
  showSlowNote,
  startOpening,
  stepLineKey,
  tick,
  type Opening,
} from '../../src/app-models/book-opening'

const open = (now = 0, extra: Partial<Parameters<typeof startOpening>[0]> = {}): Opening =>
  startOpening({ token: 't1', bookId: 'b1', now, ...extra })

describe('book opening — steps', () => {
  it('starts at content, pending', () => {
    const o = open(10)
    expect(o).toMatchObject({ step: 'content', outcome: 'pending', stepStartedAt: 10, startedAt: 10, retried: false })
  })

  it('moves forward only: content → prepare → position → firstPage → opened', () => {
    let o = contentReady(open(), 'EPUB', 100)
    expect(o).toMatchObject({ step: 'prepare', format: 'epub', stepStartedAt: 100 })
    o = positionStarted(o, 200)
    expect(o).toMatchObject({ step: 'position', stepStartedAt: 200 })
    o = positionDone(o, true, 300)
    expect(o).toMatchObject({ step: 'firstPage', positionRestored: null })
    // A late "content ready" never moves it back.
    expect(contentReady(o, 'epub', 400).step).toBe('firstPage')
    expect(firstPageDrawn(o).outcome).toBe('opened')
  })

  it('without a saved position: prepare → opened directly', () => {
    const o = firstPageDrawn(contentReady(open(), 'pdf', 5))
    expect(o.outcome).toBe('opened')
  })

  it('a position that could not be used sets positionRestored=false and still opens', () => {
    const o = positionDone(positionStarted(contentReady(open(), 'epub', 0), 0), false, 10)
    expect(o).toMatchObject({ step: 'firstPage', positionRestored: false, outcome: 'pending' })
  })

  it('maps formats; anything else is audio', () => {
    expect(contentReady(open(), 'md', 0).format).toBe('md')
    expect(contentReady(open(), 'mp3', 0).format).toBe('audio')
  })
})

describe('book opening — time limits (foreground clock)', () => {
  it('fails with took_too_long only after 20 000 ms of the step', () => {
    const o = contentReady(open(0), 'epub', 1_000)
    expect(tick(o, 21_000).outcome).toBe('pending')
    const failed = tick(o, 21_001)
    expect(failed).toMatchObject({ outcome: 'failed', error: { cause: 'took_too_long', step: 'prepare' } })
  })

  it('a paused clock does not count (the caller passes foreground time)', () => {
    const o = open(0)
    // 60 s in the background: the foreground clock did not move.
    expect(tick(o, 5_000).outcome).toBe('pending')
  })

  it('the position step falls back after 3 s instead of failing', () => {
    const o = positionStarted(contentReady(open(), 'epub', 0), 1_000)
    expect(tick(o, 4_000).step).toBe('position')
    const next = tick(o, 4_001)
    expect(next).toMatchObject({ step: 'firstPage', positionRestored: false, outcome: 'pending' })
  })

  it('the retry restarts the step clock', () => {
    const { opening, retry } = contentFailed(open(0), 'read_failed', true, 15_000)
    expect(retry).toBe(true)
    expect(tick(opening, 30_000).outcome).toBe('pending')
  })
})

describe('book opening — retry rule (FR-004)', () => {
  it('retries a passing failure once, then fails', () => {
    const first = contentFailed(open(), 'read_failed', true, 1)
    expect(first.retry).toBe(true)
    expect(first.opening).toMatchObject({ retried: true, outcome: 'pending' })
    const second = contentFailed(first.opening, 'read_failed', true, 2)
    expect(second.retry).toBe(false)
    expect(second.opening).toMatchObject({ outcome: 'failed', error: { cause: 'unreadable', step: 'content' } })
  })

  it.each(['missing_file', 'path_denied', 'not_found', 'too_large'])('never retries %s', (code) => {
    const r = contentFailed(open(), code, true, 1)
    expect(r.retry).toBe(false)
    expect(r.opening.outcome).toBe('failed')
  })

  it('does not retry a failure reported as not retryable', () => {
    expect(contentFailed(open(), 'read_failed', false, 1).retry).toBe(false)
  })

  it('a changed file is retried (the second read gets the new version)', () => {
    expect(contentFailed(open(), 'file_changed', true, 1).retry).toBe(true)
  })
})

describe('book opening — leave and terminal states', () => {
  it.each([
    ['content', open()],
    ['prepare', contentReady(open(), 'epub', 0)],
    ['position', positionStarted(contentReady(open(), 'epub', 0), 0)],
  ] as const)('leave() from %s', (_step, o) => {
    const left = leave(o)
    expect(left.outcome).toBe('left')
    expect(leave(left)).toBe(left)
  })

  it('nothing changes an ended opening', () => {
    const left = leave(open())
    expect(firstPageDrawn(left).outcome).toBe('left')
    expect(tick(left, 99_999).outcome).toBe('left')
    expect(prepareFailed(left, 'damaged').outcome).toBe('left')
    const opened = firstPageDrawn(open())
    expect(leave(opened).outcome).toBe('opened')
  })

  it('prepareFailed keeps the step for the message', () => {
    const o = prepareFailed(contentReady(open(), 'pdf', 0), 'protected')
    expect(o.error).toEqual({ cause: 'protected', step: 'prepare' })
  })
})

describe('book opening — screen rules', () => {
  it('indicator after 300 ms, slow note after 5 s, both only while pending', () => {
    const o = open(1_000)
    expect(showIndicator(o, 1_299)).toBe(false)
    expect(showIndicator(o, 1_300)).toBe(true)
    expect(showSlowNote(o, 5_999)).toBe(false)
    expect(showSlowNote(o, 6_000)).toBe(true)
    expect(showIndicator(firstPageDrawn(o), 9_000)).toBe(false)
  })

  it('step line keys', () => {
    expect(stepLineKey('content')).toBe('step.content')
    expect(stepLineKey('prepare')).toBe('step.prepare')
    expect(stepLineKey('position')).toBe('step.position')
    expect(stepLineKey('firstPage')).toBe('step.prepare')
  })

  it('outcome timing step', () => {
    expect(outcomeTimingStep(open())).toBeNull()
    expect(outcomeTimingStep(firstPageDrawn(open()))).toBe('open-first-page')
    expect(outcomeTimingStep(leave(open()))).toBe('open-left')
    expect(outcomeTimingStep(prepareFailed(open(), 'damaged'))).toBe('open-failed-damaged')
  })
})

describe('book opening — causes and actions (FR-006)', () => {
  it('maps error codes', () => {
    expect(causeFromOpenErrorCode('missing_file')).toBe('missing_file')
    expect(causeFromOpenErrorCode('not_found')).toBe('missing_file')
    expect(causeFromOpenErrorCode('path_denied')).toBe('missing_file')
    expect(causeFromOpenErrorCode('too_large')).toBe('too_large')
    expect(causeFromOpenErrorCode('read_failed')).toBe('unreadable')
    expect(causeFromOpenErrorCode('not_available_offline')).toBe('not_available_offline')
    expect(causeFromOpenErrorCode('file_changed')).toBe('file_changed')
    expect(causeFromOpenErrorCode(undefined)).toBe('unreadable')
  })

  const err = (cause: Parameters<typeof actionsFor>[0]['cause']) => ({ cause, step: 'content' as const })

  it('missing file: Locate (Desktop) / import again (phone) + Back, never Try again', () => {
    expect(actionsFor(err('missing_file'), { host: 'desktop', usesSavedPosition: true })).toEqual(['locateFile', 'back'])
    expect(actionsFor(err('missing_file'), { host: 'phone', usesSavedPosition: false })).toEqual(['importAgain', 'back'])
  })

  it.each(['protected', 'too_large'] as const)('%s: Back only', (cause) => {
    expect(actionsFor(err(cause), { host: 'desktop', usesSavedPosition: true })).toEqual(['back'])
  })

  it.each(['unreadable', 'damaged', 'took_too_long', 'not_available_offline', 'file_changed'] as const)(
    '%s: Try again (+ Open from the beginning with a saved position) + Back',
    (cause) => {
      expect(actionsFor(err(cause), { host: 'phone', usesSavedPosition: false })).toEqual(['tryAgain', 'back'])
      expect(actionsFor(err(cause), { host: 'desktop', usesSavedPosition: true })).toEqual(['tryAgain', 'fromBeginning', 'back'])
    },
  )
})

describe('book opening — protected EPUB detection', () => {
  const xml = (algs: string[]) =>
    `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">${algs
      .map((a) => `<EncryptedData><EncryptionMethod Algorithm="${a}"/><CipherData><CipherReference URI="x"/></CipherData></EncryptedData>`)
      .join('')}</encryption>`

  it('font obfuscation only is not protection', () => {
    expect(isProtectedEpubEncryption(xml(['http://www.idpf.org/2008/embedding']))).toBe(false)
    expect(isProtectedEpubEncryption(xml(['http://ns.adobe.com/pdf/enc#RC', 'http://www.idpf.org/2008/embedding']))).toBe(false)
    expect(isProtectedEpubEncryption('<encryption/>')).toBe(false)
  })

  it('any other algorithm (ADEPT / LCP / AES) is protection', () => {
    expect(isProtectedEpubEncryption(xml(['http://www.w3.org/2001/04/xmlenc#aes128-cbc']))).toBe(true)
    expect(isProtectedEpubEncryption(xml(['http://www.idpf.org/2008/embedding', 'http://www.w3.org/2001/04/xmlenc#aes256-cbc']))).toBe(true)
  })
})
