import { create } from 'zustand'
import { resolveUiLanguage, setI18nWarningHandler, type UiLanguage, type UiLanguagePreference } from '@core'
import { useAppAppearanceStore } from '../theme/appAppearanceStore'

/**
 * Effective interface language (spec 012), derived from the App Language preference of the appearance store.
 *
 * The appearance store reads localStorage synchronously when its module loads, so this store already holds the right
 * language before React's first frame (FR-004) — no separate boot call is needed. Every preference change (Settings,
 * Reset App Settings) reaches it through the subscription below; Main is told by `AppAppearanceBridge`.
 */

export function deviceLocales(): readonly string[] {
  try {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages
    return typeof navigator.language === 'string' ? [navigator.language] : []
  } catch {
    return []
  }
}

export function resolveForDevice(preference: UiLanguagePreference): UiLanguage {
  return resolveUiLanguage(preference, deviceLocales())
}

type UiLanguageState = { language: UiLanguage }

export const useUiLanguageStore = create<UiLanguageState>()(() => ({
  language: resolveForDevice(useAppAppearanceStore.getState().language),
}))

useAppAppearanceStore.subscribe((state, previous) => {
  if (state.language === previous.language) return
  const language = resolveForDevice(state.language)
  if (useUiLanguageStore.getState().language !== language) useUiLanguageStore.setState({ language })
})

setI18nWarningHandler((warning) => {
  console.warn(`[i18n] ${warning.kind}: ${warning.key}${warning.param ? ` {${warning.param}}` : ''}`)
})

export function getUiLanguage(): UiLanguage {
  return useUiLanguageStore.getState().language
}
