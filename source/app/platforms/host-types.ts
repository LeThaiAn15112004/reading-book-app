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
