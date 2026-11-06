/**
 * Platform adapter `host`, Mobile WebView (spec 009 T041; contracts/platform-adapters.md). Chosen at build time by the
 * `.native` suffix, so this module is always the phone host. Width alone is never used: a phone in landscape can be
 * wider than 900 px.
 */
export type { AppFeature } from './host-types'
import type { AppFeature } from './host-types'

const MOBILE_UNAVAILABLE: ReadonlySet<AppFeature> = new Set<AppFeature>([
  'cloudSources',
  'urlImport',
  'audiobooks',
  'annotationTransfer',
  'storageSettings',
  'notificationSettings',
  'keyboardShortcuts',
  'updates',
  'fileSystemActions',
  'desktopChrome',
])

export function isMobileHost(): boolean {
  return true
}

export function isFeatureAvailable(feature: AppFeature): boolean {
  return !MOBILE_UNAVAILABLE.has(feature)
}
