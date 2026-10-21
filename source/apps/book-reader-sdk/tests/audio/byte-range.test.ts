import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../../src/audio/byte-range'

const SIZE = 1000

describe('parseByteRange', () => {
  it('no header → none', () => {
    expect(parseByteRange(null, SIZE)).toEqual({ kind: 'none' })
    expect(parseByteRange(undefined, SIZE)).toEqual({ kind: 'none' })
    expect(parseByteRange('  ', SIZE)).toEqual({ kind: 'none' })
  })

  it('start-end', () => {
    expect(parseByteRange('bytes=0-99', SIZE)).toEqual({ kind: 'range', start: 0, end: 99 })
    expect(parseByteRange('bytes=0-0', SIZE)).toEqual({ kind: 'range', start: 0, end: 0 })
    expect(parseByteRange('BYTES=10-20', SIZE)).toEqual({ kind: 'range', start: 10, end: 20 })
  })

  it('open-ended', () => {
    expect(parseByteRange('bytes=900-', SIZE)).toEqual({ kind: 'range', start: 900, end: 999 })
    expect(parseByteRange('bytes=0-', SIZE)).toEqual({ kind: 'range', start: 0, end: 999 })
  })

  it('suffix', () => {
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({ kind: 'range', start: 900, end: 999 })
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({ kind: 'range', start: 0, end: 999 })
    expect(parseByteRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('end past EOF is clamped', () => {
    expect(parseByteRange('bytes=990-5000', SIZE)).toEqual({ kind: 'range', start: 990, end: 999 })
    expect(parseByteRange('bytes=0-99999999999999999999999', SIZE)).toEqual({ kind: 'range', start: 0, end: 999 })
  })

  it('start at or past EOF → unsatisfiable (416)', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=1000-1500', SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=99999999999999999999999-', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  it('any range of an empty file is unsatisfiable', () => {
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=-10', 0)).toEqual({ kind: 'unsatisfiable' })
  })

  it('malformed, multi-range, inverted or foreign unit → ignore (serve whole file)', () => {
    for (const h of ['bytes=abc', 'bytes=-', 'bytes=0-1,5-6', 'bytes=200-100', 'items=0-5', 'bytes 0-5', 'bytes=0-5-9', 'bytes=-1-2'])
      expect(parseByteRange(h, SIZE)).toEqual({ kind: 'ignore' })
  })
})
