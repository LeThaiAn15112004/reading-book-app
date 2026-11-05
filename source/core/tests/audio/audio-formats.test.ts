import { describe, expect, it } from 'vitest'
import {
  AUDIO_FORMAT_KEYS,
  audioFormatFromExtension,
  audioMimeForFormat,
  audioPlaybackStatus,
  isAudioFormat,
} from '../../src/audio/audio-formats'
import { DocumentFormat, isDocumentFormat } from '../../src/domain/book/document-format'

describe('audioFormatFromExtension', () => {
  it.each([
    ['.mp3', 'mp3'],
    ['M4A', 'm4a'],
    ['.M4B', 'm4b'],
    ['aac', 'aac'],
    ['.WAV', 'wav'],
    ['.flac', 'flac'],
    ['.ogg', 'ogg'],
    ['.opus', 'opus'],
    ['.aiff', 'aiff'],
    ['.aif', 'aiff'],
    ['  .AIF ', 'aiff'],
  ])('%s → %s', (ext, format) => {
    expect(audioFormatFromExtension(ext)).toBe(format)
  })

  it.each(['.zip', '.mp4', '.wma', '', '.mp3.exe', '.toString', '.__proto__'])('%j is not an audio extension', (ext) => {
    expect(audioFormatFromExtension(ext)).toBeUndefined()
  })

  it('tolerates non-strings', () => {
    expect(audioFormatFromExtension(undefined)).toBeUndefined()
    expect(audioFormatFromExtension(null)).toBeUndefined()
  })
})

describe('MIME and playback status', () => {
  it('owns one MIME per importable format', () => {
    expect(audioMimeForFormat('mp3')).toBe('audio/mpeg')
    expect(audioMimeForFormat('m4a')).toBe('audio/mp4')
    expect(audioMimeForFormat('m4b')).toBe('audio/mp4')
    expect(audioMimeForFormat('aac')).toBe('audio/aac')
    expect(audioMimeForFormat('wav')).toBe('audio/wav')
    expect(audioMimeForFormat('flac')).toBe('audio/flac')
    expect(audioMimeForFormat('ogg')).toBe('audio/ogg')
    expect(audioMimeForFormat('opus')).toBe('audio/ogg')
  })

  it('does not serve AIFF or unknown formats', () => {
    expect(isAudioFormat('aiff')).toBe(false)
    expect(audioMimeForFormat('aiff')).toBeUndefined()
    expect(audioMimeForFormat('epub')).toBeUndefined()
    expect(audioMimeForFormat('constructor')).toBeUndefined()
    expect(audioMimeForFormat(null)).toBeUndefined()
  })

  it('records every importable format as verified; AIFF as unsupported', () => {
    for (const f of ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus']) expect(audioPlaybackStatus(f)).toBe('verified')
    expect(audioPlaybackStatus('aiff')).toBe('unsupported')
    expect(audioPlaybackStatus('pdf')).toBeUndefined()
  })

  it('every importable audio key is a DocumentFormat; AIFF is not one', () => {
    expect([...AUDIO_FORMAT_KEYS].sort()).toEqual(['aac', 'flac', 'm4a', 'm4b', 'mp3', 'ogg', 'opus', 'wav'])
    for (const k of AUDIO_FORMAT_KEYS) expect(isDocumentFormat(k)).toBe(true)
    expect(isDocumentFormat('aiff')).toBe(false)
    expect(DocumentFormat.Opus).toBe('opus')
  })
})
