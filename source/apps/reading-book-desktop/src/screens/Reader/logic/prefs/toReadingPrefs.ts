import type { ResolvedReadingPrefs } from '@reading-book/shared/models'
import type { ReadingPrefs } from '../../components/settings/AaSettingsPanel'

/** Map shared resolved prefs into desktop Aa panel prefs shape. */
export function toReadingPrefs(resolved: ResolvedReadingPrefs): ReadingPrefs {
  return {
    fontFamily: resolved.fontFamily,
    fontSize: resolved.fontSize,
    fontWeight: resolved.fontWeight,
    lineHeight: resolved.lineHeight,
    textAlign: resolved.textAlign,
    margin: resolved.margin,
    marginEnabled: resolved.marginEnabled,
    layout: resolved.layout,
    pageMode: resolved.pageMode,
  }
}

/** Map desktop Aa panel prefs back into shared resolved prefs. */
export function fromReadingPrefs(prefs: ReadingPrefs): ResolvedReadingPrefs {
  const marginOff = prefs.margin === 'off'
  return {
    fontFamily: prefs.fontFamily,
    fontSize: prefs.fontSize,
    fontWeight: prefs.fontWeight,
    lineHeight: prefs.lineHeight,
    textAlign: prefs.textAlign,
    margin: marginOff ? 'normal' : prefs.margin,
    marginEnabled: marginOff ? false : prefs.marginEnabled,
    layout: prefs.layout,
    pageMode: prefs.pageMode,
  }
}
