/**
 * Platform signal (spec 008, T065; `specs/008-shared-core-architecture/contracts/phone-ui.md`).
 *
 * The Mobile app's web entry sets `window.__READMATE_HOST__ = 'mobile'` before this UI loads; Electron never sets
 * it. So in Electron `isMobileHost()` is false and `isFeatureAvailable()` is true for everything: every Desktop
 * result is the existing behaviour. Width alone is never used, because a phone in landscape can be wider than 900 px.
 */

/** App features that the first Mobile release does not have. A feature not listed here is everywhere. */
export type AppFeature =
  /** Library → Cloud Sources (Google Drive, Dropbox, OneDrive). */
  | 'cloudSources'
  /** Import → From URL. */
  | 'urlImport'
  /** Import → Audiobook ZIP, and audiobooks in general. */
  | 'audiobooks'
  /** Import / export of annotation files. */
  | 'annotationTransfer'
  /** Settings → Storage (sizes, cache, models). */
  | 'storageSettings'
  /** Settings → Notifications (reminders, background, tray). */
  | 'notificationSettings'
  /** Settings → Keyboard Shortcuts. */
  | 'keyboardShortcuts'
  /** Settings → Advanced → Updates. */
  | 'updates'
  /** Show in folder, copy file path, locate file, signature checks: things about a file on a computer. */
  | 'fileSystemActions'
  /** Desktop's title bar and menu bar (window chrome). */
  | 'desktopChrome'

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

declare global {
  interface Window {
    /** Set only by the Mobile app's web entry (`reading-book-mobile/web/src/main.ts`). */
    __READMATE_HOST__?: 'mobile'
  }
}

/** True only inside the Mobile app. Safe outside a browser (Node spikes): false. */
export function isMobileHost(): boolean {
  return typeof window !== 'undefined' && window.__READMATE_HOST__ === 'mobile'
}

/** Always true when not on the Mobile host. */
export function isFeatureAvailable(feature: AppFeature): boolean {
  return !isMobileHost() || !MOBILE_UNAVAILABLE.has(feature)
}
