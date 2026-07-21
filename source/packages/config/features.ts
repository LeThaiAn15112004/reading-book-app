/** Feature flags for MVP / phase gates (SDS §2.11 / T0.3). */
export interface FeatureFlags {
  readonly aiEnabled: boolean;
  /** Phase 3 — Google Drive / Books / Apple Books connectors (not app account sync). */
  readonly externalLibrariesEnabled: boolean;
  /** @deprecated Alias of externalLibrariesEnabled during migration. */
  readonly syncEnabled: boolean;
  readonly fileScanEnabled: boolean;
  readonly autoImportEnabled: boolean;
  readonly multiDocEnabled: boolean;
  readonly restoreSessionEnabled: boolean;
  readonly systemThemeSync: boolean;
  readonly hideToolbarOnRead: boolean;
}

export const defaultFeatures: FeatureFlags = {
  aiEnabled: false,
  externalLibrariesEnabled: false,
  syncEnabled: false,
  fileScanEnabled: true,
  autoImportEnabled: true,
  multiDocEnabled: true,
  restoreSessionEnabled: true,
  systemThemeSync: false,
  hideToolbarOnRead: true,
};

/** Alias used by G0 acceptance checklist. */
export const features: FeatureFlags = defaultFeatures;
