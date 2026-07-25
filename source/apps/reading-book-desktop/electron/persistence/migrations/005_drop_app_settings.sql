-- App-level preferences are platform-specific (not SQLite overlay):
-- Desktop: electron-store (or equivalent JSON); Mobile: MMKV / AsyncStorage.
-- Drop legacy app_settings if present from earlier schema versions.

DROP TABLE IF EXISTS app_settings;
