/**
 * Official destinations of the About page (spec 014 FR-020, FR-021). A row without a destination is hidden, never shown
 * disabled; add a link here only when it is the real, published one.
 */

export const PRIVACY_POLICY_URL = 'https://lethaian15112004.github.io/reading-book-app-privacy-policy/'

/** Package id `com.anle.readmate` (app.json `android.package`). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.anle.readmate'

export const APP_STORE_URL = 'https://apps.apple.com/us/app/readmate-reader/id6789796532'

/** The store page of this app for the platform reported by `getAppInfo()`; null where there is none (Desktop). */
export function storePageUrl(platform: string | null | undefined): string | null {
  if (platform === 'android') return PLAY_STORE_URL
  if (platform === 'ios') return APP_STORE_URL
  return null
}
