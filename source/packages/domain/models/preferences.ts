/** App chrome theme (SCR-06 Appearance) — not per-book reading theme. */
export enum AppTheme {
  Night = 'night',
  Sepia = 'sepia',
  Day = 'day',
}

/** Multi-document display mode (SCR-06). */
export enum MultiDocumentDisplayMode {
  Tabs = 'tabs',
  Windows = 'windows',
  Split = 'split',
}

/** UI language (SCR-06 Language). */
export enum InterfaceLanguage {
  En = 'en',
  Vi = 'vi',
}

/** Date/time format preference (SCR-06 Language). */
export enum DateTimeFormatPreference {
  MatchUi = 'match-ui',
  ViVN = 'vi-VN',
  EnUS = 'en-US',
}

export interface AppPreferencesProps {
  appTheme: AppTheme;
  followSystem: boolean;
  reduceMotion: boolean;
  watchFoldersEnabled: boolean;
  autoImportOnDetect: boolean;
  watchedFolderPaths: string[];
  allowMultipleDocuments: boolean;
  displayMode: MultiDocumentDisplayMode;
  maxDocuments: number;
  restorePreviousSession: boolean;
  interfaceLanguage: InterfaceLanguage;
  dateTimeFormat: DateTimeFormatPreference;
  launchInFullscreen: boolean;
  hideToolbarWhileReading: boolean;
}

/**
 * App-level preferences (SDS §3.6 + SCR-06).
 * Stored in app_settings / key-value — not on the book ERD.
 */
export class AppPreferences {
  appTheme: AppTheme;
  followSystem: boolean;
  reduceMotion: boolean;
  watchFoldersEnabled: boolean;
  autoImportOnDetect: boolean;
  watchedFolderPaths: string[];
  allowMultipleDocuments: boolean;
  displayMode: MultiDocumentDisplayMode;
  maxDocuments: number;
  restorePreviousSession: boolean;
  interfaceLanguage: InterfaceLanguage;
  dateTimeFormat: DateTimeFormatPreference;
  launchInFullscreen: boolean;
  hideToolbarWhileReading: boolean;

  constructor(props: AppPreferencesProps) {
    this.appTheme = props.appTheme;
    this.followSystem = props.followSystem;
    this.reduceMotion = props.reduceMotion;
    this.watchFoldersEnabled = props.watchFoldersEnabled;
    this.autoImportOnDetect = props.autoImportOnDetect;
    this.watchedFolderPaths = [...props.watchedFolderPaths];
    this.allowMultipleDocuments = props.allowMultipleDocuments;
    this.displayMode = props.displayMode;
    this.maxDocuments = AppPreferences.clampMaxDocuments(props.maxDocuments);
    this.restorePreviousSession = props.restorePreviousSession;
    this.interfaceLanguage = props.interfaceLanguage;
    this.dateTimeFormat = props.dateTimeFormat;
    this.launchInFullscreen = props.launchInFullscreen;
    this.hideToolbarWhileReading = props.hideToolbarWhileReading;
  }

  static clampMaxDocuments(value: number): number {
    const allowed = [3, 5, 8, 12];
    if (allowed.includes(value)) return value;
    return 5;
  }

  static defaults(): AppPreferences {
    return new AppPreferences({
      appTheme: AppTheme.Day,
      followSystem: true,
      reduceMotion: false,
      watchFoldersEnabled: false,
      autoImportOnDetect: false,
      watchedFolderPaths: [],
      allowMultipleDocuments: false,
      displayMode: MultiDocumentDisplayMode.Tabs,
      maxDocuments: 5,
      restorePreviousSession: true,
      interfaceLanguage: InterfaceLanguage.En,
      dateTimeFormat: DateTimeFormatPreference.MatchUi,
      launchInFullscreen: false,
      hideToolbarWhileReading: true,
    });
  }

  addWatchFolder(folderPath: string): void {
    const normalized = folderPath.trim();
    if (!normalized) return;
    if (!this.watchedFolderPaths.includes(normalized)) {
      this.watchedFolderPaths.push(normalized);
    }
  }

  removeWatchFolder(folderPath: string): void {
    this.watchedFolderPaths = this.watchedFolderPaths.filter((p) => p !== folderPath);
  }

  merge(partial: Partial<AppPreferencesProps>): void {
    if (partial.appTheme !== undefined) this.appTheme = partial.appTheme;
    if (partial.followSystem !== undefined) this.followSystem = partial.followSystem;
    if (partial.reduceMotion !== undefined) this.reduceMotion = partial.reduceMotion;
    if (partial.watchFoldersEnabled !== undefined) {
      this.watchFoldersEnabled = partial.watchFoldersEnabled;
    }
    if (partial.autoImportOnDetect !== undefined) {
      this.autoImportOnDetect = partial.autoImportOnDetect;
    }
    if (partial.watchedFolderPaths !== undefined) {
      this.watchedFolderPaths = [...partial.watchedFolderPaths];
    }
    if (partial.allowMultipleDocuments !== undefined) {
      this.allowMultipleDocuments = partial.allowMultipleDocuments;
    }
    if (partial.displayMode !== undefined) this.displayMode = partial.displayMode;
    if (partial.maxDocuments !== undefined) {
      this.maxDocuments = AppPreferences.clampMaxDocuments(partial.maxDocuments);
    }
    if (partial.restorePreviousSession !== undefined) {
      this.restorePreviousSession = partial.restorePreviousSession;
    }
    if (partial.interfaceLanguage !== undefined) {
      this.interfaceLanguage = partial.interfaceLanguage;
    }
    if (partial.dateTimeFormat !== undefined) this.dateTimeFormat = partial.dateTimeFormat;
    if (partial.launchInFullscreen !== undefined) {
      this.launchInFullscreen = partial.launchInFullscreen;
    }
    if (partial.hideToolbarWhileReading !== undefined) {
      this.hideToolbarWhileReading = partial.hideToolbarWhileReading;
    }
  }
}

/** Alias used in G0 task list / SDS preferences.ts naming. */
export { AppPreferences as Preferences };
