import { useEffect, useState } from 'react'
import {
  applyAppearanceAttributes,
  onSystemColorSchemeChange,
  resolveThemeMode,
  systemPrefersDark,
} from '../theme/appAppearance'
import { useAppAppearanceStore } from '../theme/appAppearanceStore'
import { useGlobalReadingPrefs } from './GlobalReadingPrefsContext'

/**
 * Applies the global app appearance: resolves the theme mode (incl. System → OS light/dark) into
 * GlobalReadingPrefs.theme — the existing `html[data-theme]` engine — and sets the accent /
 * density attributes and `<html lang>`. Mounted once inside `GlobalReadingPrefsProvider`.
 */
export function AppAppearanceBridge() {
  const themeMode = useAppAppearanceStore((s) => s.themeMode)
  const accent = useAppAppearanceStore((s) => s.accent)
  const customAccent = useAppAppearanceStore((s) => s.customAccent)
  const density = useAppAppearanceStore((s) => s.density)
  const language = useAppAppearanceStore((s) => s.language)
  const { prefs, setPrefs } = useGlobalReadingPrefs()
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (themeMode !== 'system') return
    setPrefersDark(systemPrefersDark())
    try {
      return onSystemColorSchemeChange(setPrefersDark)
    } catch {
      return undefined
    }
  }, [themeMode])

  const resolvedTheme = resolveThemeMode(themeMode, prefersDark)
  useEffect(() => {
    if (prefs.theme !== resolvedTheme) setPrefs({ theme: resolvedTheme })
  }, [prefs.theme, resolvedTheme, setPrefs])

  useEffect(() => {
    applyAppearanceAttributes({ accent, customAccent, density, language })
  }, [accent, customAccent, density, language])

  return null
}
