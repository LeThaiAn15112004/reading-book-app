/**
 * Types, interfaces, and constants for the Google Drive Integration.
 * Covers OAuth 2.0 authentication, file listing, download, and Changes API delta sync.
 */

// ─── API Endpoint Constants ────────────────────────────────────────────────

export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Default OAuth2 scopes requested for Google Drive integration.
 * drive.readonly: list and download all files the user has access to.
 */
export const GOOGLE_DRIVE_DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

/** File extensions shown by the Google Drive catalog. */
export const GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS = [
  'epub',
  'pdf',
  'mobi',
  'azw3',
  'fb2',
  'txt',
  'md',
] as const;

export type GoogleDriveSupportedBookExtension = (typeof GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS)[number];

// ─── Credentials & Token Types ─────────────────────────────────────────────

export interface GoogleDriveAppCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Raw token response from Google OAuth2 token endpoint */
export interface GoogleDriveTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly scope?: string;
  readonly id_token?: string;
}

/** Persisted, normalized tokens for local storage */
export interface GoogleDriveStoredTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number; // UNIX timestamp in ms
  readonly tokenType: string;
  readonly scope?: string;
}

// ─── OAuth Options ─────────────────────────────────────────────────────────

/** Options for generating a Google OAuth2 authorization URL */
export interface GoogleOAuthUrlOptions {
  readonly clientId?: string;
  readonly redirectUri?: string;
  readonly scopes?: readonly string[];
  readonly state?: string;
  /** 'offline' requests a refresh_token; required for background sync. */
  readonly accessType?: 'online' | 'offline';
  /** 'consent' forces re-consent even if previously granted (required to get refresh_token again). */
  readonly prompt?: 'none' | 'consent' | 'select_account';
  /** PKCE code challenge */
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: 'S256';
  readonly includeGrantedScopes?: boolean;
}

/** Options for exchanging an authorization code for tokens */
export interface GoogleTokenExchangeOptions {
  readonly code: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly redirectUri?: string;
  readonly codeVerifier?: string;
}

// ─── Google Drive File Metadata ────────────────────────────────────────────

/** File metadata as returned by the Drive v3 files.list / files.get endpoint */
export interface GoogleDriveFileMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size?: number;
  readonly modifiedTime?: string;
  readonly createdTime?: string;
  readonly thumbnailLink?: string;
  readonly webViewLink?: string;
  readonly webContentLink?: string;
  /** Detected book format based on mimeType and file extension */
  readonly formatHint?: string;
  readonly parents?: readonly string[];
  readonly trashed?: boolean;
}

/** Folder metadata as returned by files.list */
export interface GoogleDriveFolderMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: 'application/vnd.google-apps.folder';
  readonly parents?: readonly string[];
}

// ─── File Listing ──────────────────────────────────────────────────────────

/** Options for listing files in Google Drive */
export interface GoogleDriveListFilesOptions {
  /** Parent folder ID (default: search all Drive). Use 'root' for My Drive root. */
  readonly folderId?: string;
  /** Keyword to filter file names */
  readonly searchTerm?: string;
  /** Max results per page (max 1000, default 100) */
  readonly pageSize?: number;
  /** Page token for continuation */
  readonly pageToken?: string;
  /** Whether to include files in subfolders (via corpora=allDrives) */
  readonly recursive?: boolean;
  /** Allowed file extensions; defaults to SUPPORTED_BOOK_EXTENSIONS */
  readonly allowedExtensions?: readonly string[];
}

/** Result of a files.list call */
export interface GoogleDriveListFilesResult {
  readonly entries: GoogleDriveFileMetadata[];
  readonly nextPageToken?: string;
}

// ─── Download ──────────────────────────────────────────────────────────────

/** Result of downloading a file from Google Drive */
export interface GoogleDriveDownloadResult {
  readonly metadata: GoogleDriveFileMetadata;
  readonly data: ArrayBuffer;
  readonly blob: () => Blob;
  readonly text: () => string;
}

// ─── Changes API / Delta Sync ──────────────────────────────────────────────

export type GoogleDriveChangeType = 'added' | 'modified' | 'deleted';

/** Represents a single detected file change */
export interface GoogleDriveFileChange {
  readonly type: GoogleDriveChangeType;
  readonly fileId: string;
  readonly path?: string;
  readonly name: string;
  readonly formatHint?: string;
  readonly file?: GoogleDriveFileMetadata;
}

/** Options for running a sync pass */
export interface GoogleDriveSyncOptions {
  /** Google Drive folder ID to scope the sync (default: all Drive) */
  readonly folderId?: string;
  /** Page token from Google Drive Changes API (stored after last sync) */
  readonly changesPageToken?: string;
  /** Allowed extensions; defaults to SUPPORTED_BOOK_EXTENSIONS */
  readonly allowedExtensions?: readonly string[];
  /** Local file records for timestamp-based fallback comparison */
  readonly localFiles?: ReadonlyArray<{
    readonly id?: string;
    readonly path: string;
    readonly modifiedTime?: string;
    readonly size?: number;
  }>;
}

/** Result of a sync pass */
export interface GoogleDriveSyncResult {
  /** New Changes API page token to persist for next sync */
  readonly nextPageToken: string;
  readonly changes: GoogleDriveFileChange[];
  readonly addedCount: number;
  readonly modifiedCount: number;
  readonly deletedCount: number;
  readonly totalProcessed: number;
}
