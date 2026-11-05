import { describe, expect, it } from 'vitest'
import {
  AUTO_LANGUAGE,
  WHISPER_LANGUAGES,
  isSupportedTranscriptionLanguage,
  resolveDefaultTranscriptionLanguage,
  whisperLanguageForTag,
} from '../../src/transcription/languages'

describe('WHISPER_LANGUAGES', () => {
  it('has the 99 Whisper languages, unique codes, non-empty names', () => {
    expect(WHISPER_LANGUAGES).toHaveLength(99)
    expect(new Set(WHISPER_LANGUAGES.map((l) => l.code)).size).toBe(99)
    expect(WHISPER_LANGUAGES.every((l) => l.code.length >= 2 && l.name.length > 0)).toBe(true)
  })
})

describe('isSupportedTranscriptionLanguage', () => {
  it('accepts auto and Whisper codes, rejects everything else', () => {
    expect(isSupportedTranscriptionLanguage(AUTO_LANGUAGE)).toBe(true)
    expect(isSupportedTranscriptionLanguage('vi')).toBe(true)
    expect(isSupportedTranscriptionLanguage('haw')).toBe(true)
    expect(isSupportedTranscriptionLanguage('xx')).toBe(false)
    expect(isSupportedTranscriptionLanguage('EN')).toBe(false)
    expect(isSupportedTranscriptionLanguage('')).toBe(false)
    expect(isSupportedTranscriptionLanguage(undefined)).toBe(false)
    expect(isSupportedTranscriptionLanguage(42)).toBe(false)
  })
})

describe('whisperLanguageForTag', () => {
  it('maps BCP 47 tags, ISO 639-2 codes and legacy aliases', () => {
    expect(whisperLanguageForTag('en-US')).toBe('en')
    expect(whisperLanguageForTag('pt_BR')).toBe('pt')
    expect(whisperLanguageForTag('vie')).toBe('vi')
    expect(whisperLanguageForTag(' FRA ')).toBe('fr')
    expect(whisperLanguageForTag('iw')).toBe('he')
  })

  it('unmapped or empty → null', () => {
    expect(whisperLanguageForTag('tlh')).toBeNull()
    expect(whisperLanguageForTag('')).toBeNull()
    expect(whisperLanguageForTag(null)).toBeNull()
    expect(whisperLanguageForTag(undefined)).toBeNull()
  })
})

describe('resolveDefaultTranscriptionLanguage', () => {
  it('the book tag wins, then the app language, then auto', () => {
    expect(resolveDefaultTranscriptionLanguage('fr', 'vi')).toBe('fr')
    expect(resolveDefaultTranscriptionLanguage('tlh', 'vi')).toBe('vi')
    expect(resolveDefaultTranscriptionLanguage(null, 'en-GB')).toBe('en')
    expect(resolveDefaultTranscriptionLanguage(undefined, undefined)).toBe(AUTO_LANGUAGE)
    expect(resolveDefaultTranscriptionLanguage('zzz', 'qqq')).toBe(AUTO_LANGUAGE)
  })
})
