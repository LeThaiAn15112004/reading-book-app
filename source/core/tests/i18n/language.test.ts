import { describe, expect, it } from 'vitest'
import { isUiLanguagePreference, localeTag, resolveUiLanguage } from '../../src/i18n/language'

describe('resolveUiLanguage (spec 012 FR-005, data-model table)', () => {
  it('an explicit choice wins over the device', () => {
    expect(resolveUiLanguage('vi', ['fr-FR'])).toBe('vi')
    expect(resolveUiLanguage('en', ['vi-VN'])).toBe('en')
    expect(resolveUiLanguage('vi', [])).toBe('vi')
  })

  it('system follows the FIRST device locale: Vietnamese in any form → vi', () => {
    for (const tag of ['vi', 'vi-VN', 'VI-vn', ' vi-VN ', 'vi_VN']) {
      expect(resolveUiLanguage('system', [tag])).toBe('vi')
    }
    expect(resolveUiLanguage('system', ['vi-VN', 'en-US'])).toBe('vi')
  })

  it('system with any other first locale, empty or unreadable list → en', () => {
    expect(resolveUiLanguage('system', ['en-GB'])).toBe('en')
    expect(resolveUiLanguage('system', ['fr'])).toBe('en')
    expect(resolveUiLanguage('system', ['en-US', 'vi-VN'])).toBe('en')
    expect(resolveUiLanguage('system', ['video'])).toBe('en')
    expect(resolveUiLanguage('system', [])).toBe('en')
    expect(resolveUiLanguage('system', null)).toBe('en')
    expect(resolveUiLanguage('system', undefined)).toBe('en')
  })

  it('locale tags and preference guard', () => {
    expect(localeTag('vi')).toBe('vi-VN')
    expect(localeTag('en')).toBe('en-US')
    expect(['system', 'vi', 'en'].every(isUiLanguagePreference)).toBe(true)
    expect([null, 'fr', 'VI', 1, {}].some(isUiLanguagePreference)).toBe(false)
  })
})
