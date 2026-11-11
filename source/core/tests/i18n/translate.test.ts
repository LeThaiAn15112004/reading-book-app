import { afterEach, describe, expect, it } from 'vitest'
import { pendingArea } from '../../src/i18n/pending'
import type { CatalogueSet } from '../../src/i18n/registry'
import {
  createTranslator,
  setI18nWarningHandler,
  translate,
  translateFrom,
  type I18nWarning,
} from '../../src/i18n/translate'

const catalogues: CatalogueSet = {
  en: {
    lib: {
      title: 'Library',
      greet: 'Open {name}',
      pair: '{a} and {b}',
      books: { one: '{count} book', other: '{count} books' },
      nested: { deep: { key: 'Deep' } },
      onlyEn: 'Only in English',
    },
    'reader.chrome': { zoom: 'Zoom' },
    todo: { later: 'Later' },
  },
  vi: {
    lib: {
      title: 'Thư viện',
      greet: 'Mở {name}',
      pair: '{b} và {a}',
      books: { other: '{count} cuốn sách' },
      nested: { deep: { key: 'Sâu' } },
    },
    'reader.chrome': { zoom: 'Thu phóng' },
    todo: pendingArea('not translated yet'),
  },
}

const warnings: I18nWarning[] = []
afterEach(() => {
  warnings.length = 0
  setI18nWarningHandler(null)
})

describe('translateFrom', () => {
  it('looks up nested keys and two-segment areas', () => {
    expect(translateFrom(catalogues, 'vi', 'lib.title')).toBe('Thư viện')
    expect(translateFrom(catalogues, 'vi', 'lib.nested.deep.key')).toBe('Sâu')
    expect(translateFrom(catalogues, 'vi', 'reader.chrome.zoom')).toBe('Thu phóng')
    expect(translateFrom(catalogues, 'en', 'reader.chrome.zoom')).toBe('Zoom')
  })

  it('places values by each language word order', () => {
    expect(translateFrom(catalogues, 'en', 'lib.pair', { a: 'X', b: 'Y' })).toBe('X and Y')
    expect(translateFrom(catalogues, 'vi', 'lib.pair', { a: 'X', b: 'Y' })).toBe('Y và X')
  })

  it('shows inserted values literally (never re-parsed)', () => {
    for (const name of ['{b}', '<b>bold</b>', '100% {count}', '$&']) {
      expect(translateFrom(catalogues, 'en', 'lib.greet', { name })).toBe(`Open ${name}`)
    }
  })

  it('plurals: English one/other, Vietnamese other', () => {
    expect(translateFrom(catalogues, 'en', 'lib.books', { count: 0 })).toBe('0 books')
    expect(translateFrom(catalogues, 'en', 'lib.books', { count: 1 })).toBe('1 book')
    expect(translateFrom(catalogues, 'en', 'lib.books', { count: 2 })).toBe('2 books')
    expect(translateFrom(catalogues, 'vi', 'lib.books', { count: 1 })).toBe('1 cuốn sách')
    expect(translateFrom(catalogues, 'vi', 'lib.books', { count: 5 })).toBe('5 cuốn sách')
  })

  it('falls back to English for a pending area and for a key missing in Vietnamese', () => {
    expect(translateFrom(catalogues, 'vi', 'todo.later')).toBe('Later')
    expect(translateFrom(catalogues, 'vi', 'lib.onlyEn')).toBe('Only in English')
  })

  it('unknown key → empty text (never the raw key), reported once', () => {
    setI18nWarningHandler((w) => warnings.push(w))
    expect(translateFrom(catalogues, 'vi', 'lib.nope')).toBe('')
    expect(translateFrom(catalogues, 'vi', 'lib.nope')).toBe('')
    expect(translateFrom(catalogues, 'en', 'nowhere.key')).toBe('')
    expect(translateFrom(catalogues, 'en', 'lib')).toBe('')
    expect(translateFrom(catalogues, 'en', 'lib.nested')).toBe('')
    expect(warnings.filter((w) => w.key === 'lib.nope')).toHaveLength(1)
    expect(warnings.every((w) => w.kind === 'missing-key')).toBe(true)
  })

  it('missing param → empty text in its place, reported', () => {
    setI18nWarningHandler((w) => warnings.push(w))
    expect(translateFrom(catalogues, 'en', 'lib.greet')).toBe('Open ')
    expect(warnings).toEqual([{ kind: 'missing-param', key: 'lib.greet', param: 'name' }])
  })

  it('works without a warning handler (core has no console)', () => {
    expect(translateFrom(catalogues, 'en', 'lib.nope')).toBe('')
  })
})

describe('translate on the real catalogue', () => {
  it('common area is translated in both languages', () => {
    expect(translate('en', 'common.actions.delete')).toBe('Delete')
    expect(translate('vi', 'common.actions.delete')).toBe('Xóa')
    expect(translate('vi', 'common.actions.remove')).toBe('Gỡ')
    expect(translate('vi', 'common.duration.minutes', { count: 3 })).toBe('3 phút')
    expect(translate('en', 'common.duration.minutes', { count: 1 })).toBe('1 min')
  })

  it('createTranslator binds the language', () => {
    const t = createTranslator('vi')
    expect(t('common.appLanguage.system')).toBe('Theo hệ thống')
    expect(t('common.units.megabytes', { value: '1,5' })).toBe('1,5 MB')
  })

  it('keys are typed', () => {
    const t = createTranslator('en')
    // @ts-expect-error — not a key of the English catalogue
    expect(t('common.actions.nope')).toBe('')
    // @ts-expect-error — a plural key needs { count }
    t('common.duration.hours')
  })
})
