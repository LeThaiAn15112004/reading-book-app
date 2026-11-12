import { createTranslator, type Translator, type UiLanguage } from '@core'

/**
 * Main's translator (spec 012), kept apart from `main-i18n.ts` so services can use {@link tMain} without importing
 * `electron` (their spikes run in plain Node). `main-i18n.ts` sets the language; until then it is English.
 */
let translator: Translator = createTranslator('en')

export function setMainTranslatorLanguage(language: UiLanguage): void {
  translator = createTranslator(language)
}

/** Translate in Main's current language, at the moment the text is produced. */
export const tMain: Translator = ((key: never, params?: never) =>
  (translator as (k: unknown, p?: unknown) => string)(key, params)) as Translator
