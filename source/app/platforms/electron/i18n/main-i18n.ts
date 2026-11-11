import { app } from 'electron'
import {
  createTranslator,
  isUiLanguagePreference,
  resolveUiLanguage,
  setI18nWarningHandler,
  type Translator,
  type UiLanguage,
  type UiLanguagePreference,
} from '@core'
import type { SetUiLanguageResultDto } from '../ipc/api-types'
import { readJsonPrefsFile, writeJsonPrefsFile } from '../prefs/json-prefs-file'

/**
 * Main-process interface language (spec 012, contract `ui-language-ipc.md`).
 *
 * The App Language preference is owned by the renderer (localStorage); Main keeps a MIRROR in
 * `{userData}/ui-language.json` so the tray, an early Reading Reminder and native dialogs are right before / without a
 * window. The renderer re-sends the preference at every start, so a stale mirror heals itself. Texts are built with
 * {@link tMain} at the moment they are shown, so a change applies without a restart.
 */

export const UI_LANGUAGE_FILE = 'ui-language.json'
const MIRROR_VERSION = 1

let preference: UiLanguagePreference = 'system'
let effective: UiLanguage = 'en'
let translator: Translator = createTranslator('en')
const listeners = new Set<(language: UiLanguage) => void>()

setI18nWarningHandler((warning) => {
  console.warn(`[i18n] ${warning.kind}: ${warning.key}${warning.param ? ` {${warning.param}}` : ''}`)
})

/** Device locales in preference order; same rule as the renderer's `navigator.languages`. */
function systemLocales(): readonly string[] {
  try {
    const preferred = app.getPreferredSystemLanguages()
    if (Array.isArray(preferred) && preferred.length > 0) return preferred
  } catch {
    // fall through to the app locale
  }
  try {
    const locale = app.getLocale()
    return locale ? [locale] : []
  } catch {
    return []
  }
}

/** Mirror file content → preference; missing, unreadable or invalid → `system`. */
export function parseUiLanguageMirror(raw: unknown): UiLanguagePreference {
  if (typeof raw !== 'object' || raw === null) return 'system'
  const value = (raw as { preference?: unknown }).preference
  return isUiLanguagePreference(value) ? value : 'system'
}

function apply(next: UiLanguagePreference): UiLanguage {
  preference = next
  const previous = effective
  effective = resolveUiLanguage(next, systemLocales())
  translator = createTranslator(effective)
  if (effective !== previous) {
    for (const listener of listeners) {
      try {
        listener(effective)
      } catch (err) {
        console.warn('[i18n] language listener failed', err)
      }
    }
  }
  return effective
}

/** At `ready`, before the tray, windows and the reminder worker. */
export function loadMainUiLanguage(): UiLanguage {
  return apply(parseUiLanguageMirror(readJsonPrefsFile(UI_LANGUAGE_FILE)))
}

export function getMainUiLanguage(): UiLanguage {
  return effective
}

export function getMainUiLanguagePreference(): UiLanguagePreference {
  return preference
}

/**
 * New preference from the renderer: applied in memory first (texts follow it even when the disk is full), then
 * written. `saved: false` when the mirror could not be written.
 */
export function setMainUiLanguagePreference(next: UiLanguagePreference): { effective: UiLanguage; saved: boolean } {
  const language = apply(next)
  try {
    writeJsonPrefsFile(UI_LANGUAGE_FILE, { version: MIRROR_VERSION, preference: next })
    return { effective: language, saved: true }
  } catch (err) {
    console.warn('[i18n] could not write the language mirror', err)
    return { effective: language, saved: false }
  }
}

/** `app:setUiLanguage` (renderer input is untrusted: a bad value changes nothing). */
export function handleSetUiLanguage(input: unknown): SetUiLanguageResultDto {
  if (!isUiLanguagePreference(input)) return { ok: false, code: 'INVALID_ARGUMENT' }
  const { effective: language, saved } = setMainUiLanguagePreference(input)
  return saved ? { ok: true, effective: language } : { ok: false, code: 'WRITE_FAILED' }
}

/** Translate in Main's current language. */
export const tMain: Translator = ((key: never, params?: never) =>
  (translator as (k: unknown, p?: unknown) => string)(key, params)) as Translator

/** Called with the new effective language each time it changes (e.g. to rebuild the tray menu). */
export function onMainUiLanguageChange(listener: (language: UiLanguage) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
