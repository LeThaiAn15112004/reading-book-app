/** Feature flags for MVP / phase gates (SDS §2.11 / T0.3). */
export interface FeatureFlags {
  readonly aiEnabled: boolean;
  /** Phase 3 — Google Drive / Google Books connectors (not app account sync). */
  readonly externalLibrariesEnabled: boolean;
  readonly fileScanEnabled: boolean;
  readonly autoImportEnabled: boolean;
  readonly multiDocEnabled: boolean;
  readonly restoreSessionEnabled: boolean;
  readonly systemThemeSync: boolean;
  readonly hideToolbarOnRead: boolean;
  /**
   * Audiobook ZIP import (multi-chapter). Stays `false` until import AND multi-track playback both pass the
   * release checklist (docs/implementation_plan/audiobook_multi_chapter_import.md §6); gates the Import menu
   * entry and the `zipImport:*` handlers in Main.
   */
  readonly audiobookZipImportEnabled: boolean;
  /**
   * Audiobook transcription (spec 004). Stays `false` until the own-build FFmpeg decoder (tasks T001 / T001a / T001b) is
   * integrated and verified: without it a transcription cannot run at all. While it is `false` the audiobook screen shows no
   * Transcribe entry and no Transcript tab, and Main refuses `transcription:start` and `transcription:downloadModel`
   * (`FEATURE_DISABLED`) before any model is downloaded or any job is created. Release gate:
   * book-reader-sdk/tests/config/audiobook-transcription-gate.test.ts.
   */
  readonly audiobookTranscriptionEnabled: boolean;
}

export const defaultFeatures: FeatureFlags = {
  aiEnabled: false,
  externalLibrariesEnabled: true,
  fileScanEnabled: true,
  autoImportEnabled: true,
  multiDocEnabled: true,
  restoreSessionEnabled: true,
  systemThemeSync: false,
  hideToolbarOnRead: true,
  audiobookZipImportEnabled: true, // LOCAL ONLY — the committed value must stay false (see tests/config/audiobook-zip-gate.test.ts)
  audiobookTranscriptionEnabled: true, // OFF until the own-build FFmpeg is integrated and verified (see tests/config/audiobook-transcription-gate.test.ts)
};

/** Alias used by G0 acceptance checklist. */
export const features: FeatureFlags = defaultFeatures;
