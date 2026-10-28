import { describe, expect, it } from 'vitest'
import { formatTimestamp, formatTranscriptText, transcriptExportFileName } from '../../src/transcription/transcript-export'
import type { TranscriptPassage } from '../../src/transcription/transcript-model'

const p = (startMs: number, endMs: number, text: string, trackId?: string): TranscriptPassage => ({ startMs, endMs, text, trackId })

describe('formatTimestamp', () => {
  it('formats [hh:mm:ss], flooring milliseconds', () => {
    expect(formatTimestamp(0)).toBe('[00:00:00]')
    expect(formatTimestamp(999)).toBe('[00:00:00]')
    expect(formatTimestamp(61_000)).toBe('[00:01:01]')
    expect(formatTimestamp(3_661_999)).toBe('[01:01:01]')
  })

  it('hours do not wrap; bad input is zero', () => {
    expect(formatTimestamp(100 * 3600 * 1000)).toBe('[100:00:00]')
    expect(formatTimestamp(-5)).toBe('[00:00:00]')
    expect(formatTimestamp(NaN)).toBe('[00:00:00]')
  })
})

describe('transcriptExportFileName', () => {
  it('title + .txt, Unicode kept', () => {
    expect(transcriptExportFileName('Dế Mèn phiêu lưu ký')).toBe('Dế Mèn phiêu lưu ký.txt')
  })

  it('replaces path separators, reserved and control characters; collapses spaces', () => {
    expect(transcriptExportFileName('A/B\\C:D*E?F"G<H>I|J')).toBe('A B C D E F G H I J.txt')
    expect(transcriptExportFileName('line\none\ttab')).toBe('line one tab.txt')
  })

  it('no trailing dots or spaces, at most 80 characters of title', () => {
    expect(transcriptExportFileName('Book...  ')).toBe('Book.txt')
    const long = transcriptExportFileName('x'.repeat(200))
    expect(long).toBe(`${'x'.repeat(80)}.txt`)
  })

  it('falls back to "transcript" for nothing usable or a reserved Windows device name', () => {
    for (const bad of ['', '   ', '...', '///', null, undefined, 'CON', 'nul', 'com1', 'LPT9']) {
      expect(transcriptExportFileName(bad as string | null | undefined)).toBe('transcript.txt')
    }
    expect(transcriptExportFileName('console')).toBe('console.txt')
  })
})

describe('formatTranscriptText — single file', () => {
  it('empty transcript → empty string', () => {
    expect(formatTranscriptText([])).toBe('')
  })

  it('passages in reading order, one per line, ending with a newline, no heading', () => {
    const text = formatTranscriptText([p(5000, 6000, 'second'), p(0, 1000, 'first')])
    expect(text).toBe('first\nsecond\n')
  })

  it('optional timestamps', () => {
    expect(formatTranscriptText([p(0, 1000, 'one'), p(65_000, 66_000, 'two')], { timestamps: true })).toBe('[00:00:00] one\n[00:01:05] two\n')
  })

  it('keeps Unicode text as is', () => {
    expect(formatTranscriptText([p(0, 1000, 'Xin chào, thế giới')])).toBe('Xin chào, thế giới\n')
  })
})

describe('formatTranscriptText — multi-track', () => {
  const tracks = [
    { id: 'b-id', title: 'Opening' },
    { id: 'a-id', title: 'Middle' },
    { id: 'c-id', title: 'Silent' },
  ]

  it('headings follow playback order (not id order); tracks without passages get none; blank line between groups', () => {
    const text = formatTranscriptText(
      [p(0, 1000, 'mid one', 'a-id'), p(2000, 3000, 'open two', 'b-id'), p(0, 1000, 'open one', 'b-id')],
      { tracks },
    )
    expect(text).toBe('Track 1 — Opening\nopen one\nopen two\n\nTrack 2 — Middle\nmid one\n')
  })

  it('timestamps are per track (start inside its own file)', () => {
    const text = formatTranscriptText([p(61_000, 62_000, 'x', 'a-id')], { tracks, timestamps: true })
    expect(text).toBe('Track 2 — Middle\n[00:01:01] x\n')
  })

  it('passages of an unknown track come last under their raw id (nothing is dropped)', () => {
    const text = formatTranscriptText([p(0, 1000, 'ghost', 'zzz'), p(0, 1000, 'known', 'b-id')], { tracks })
    expect(text).toBe('Track 1 — Opening\nknown\n\nTrack zzz\nghost\n')
  })

  it('does not mutate its input', () => {
    const input = [p(5000, 6000, 'b'), p(0, 1000, 'a')]
    formatTranscriptText(input)
    expect(input.map((x) => x.text)).toEqual(['b', 'a'])
  })
})

