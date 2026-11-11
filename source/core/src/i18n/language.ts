import type { UiLanguage, UiLanguagePreference } from './types.js'

const PREFERENCES: readonly UiLanguagePreference[] = ['system', 'vi', 'en']

export function isUiLanguagePreference(value: unknown): value is UiLanguagePreference {
  return typeof value === 'string' && (PREFERENCES as readonly string[]).includes(value)
}

/**
 * Concrete interface language (spec 012 FR-005). An explicit choice wins; `system` is Vietnamese when the FIRST device
 * locale is Vietnamese (`vi`, `vi-VN`, any case) and English otherwise — also when the list is empty or unreadable.
 * Renderer passes `navigator.languages`, Main `app.getPreferredSystemLanguages()`, so both processes agree.
 */
export function resolveUiLanguage(
  preference: UiLanguagePreference,
  deviceLocales: readonly string[] | null | undefined,
): UiLanguage {
  if (preference === 'vi' || preference === 'en') return preference
  const first = Array.isArray(deviceLocales) ? deviceLocales[0] : undefined
  if (typeof first !== 'string') return 'en'
  const tag = first.trim().toLowerCase()
  return tag === 'vi' || tag.startsWith('vi-') || tag.startsWith('vi_') ? 'vi' : 'en'
}

/** BCP 47 tag used for `Intl` formatting. */
export function localeTag(lang: UiLanguage): 'vi-VN' | 'en-US' {
  return lang === 'vi' ? 'vi-VN' : 'en-US'
}
