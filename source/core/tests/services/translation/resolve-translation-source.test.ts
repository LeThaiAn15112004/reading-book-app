import { describe, expect, it } from 'vitest'
import { resolveTranslationSource } from '../../../src/services/translation/translation-languages.js'

describe('resolveTranslationSource (spec 011 FR-007)', () => {
  it('prefers the remembered choice over the selection language', () => {
    expect(resolveTranslationSource({ remembered: 'vi', selectionLang: 'fr', fallback: 'en' })).toBe('vi')
  })

  it('keeps a remembered regional catalog code as is', () => {
    expect(resolveTranslationSource({ remembered: 'zh-TW', selectionLang: '', fallback: 'en' })).toBe('zh-TW')
  })

  it('ignores a remembered value that is not a catalog code', () => {
    expect(resolveTranslationSource({ remembered: 'xx-invalid', selectionLang: 'fr', fallback: 'en' })).toBe('fr')
  })

  it('normalizes the selection language', () => {
    expect(resolveTranslationSource({ remembered: null, selectionLang: 'fr-FR', fallback: 'en' })).toBe('fr')
    expect(resolveTranslationSource({ remembered: undefined, selectionLang: 'zh-Hant', fallback: 'en' })).toBe('zh-TW')
  })

  it('falls back when the selection carries no usable language', () => {
    expect(resolveTranslationSource({ remembered: null, selectionLang: '', fallback: 'en' })).toBe('en')
    expect(resolveTranslationSource({ remembered: null, selectionLang: 'qq', fallback: 'en' })).toBe('en')
    expect(resolveTranslationSource({ remembered: '', selectionLang: null, fallback: 'en' })).toBe('en')
  })
})
