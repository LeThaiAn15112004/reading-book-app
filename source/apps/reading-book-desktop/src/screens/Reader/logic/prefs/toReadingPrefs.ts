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
