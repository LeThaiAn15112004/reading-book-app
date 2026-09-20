/**
 * Types and interfaces for the Dropbox Integration (OAuth 2.0, File Service, Download, and Sync).
 */

/**
 * No app key/secret is baked in here — they live in the gitignored
 * `packages/config/cloud-oauth-secrets.json` (loaded by the desktop app's
 * `electron/config/cloud-oauth-config.ts`) or the `DROPBOX_APP_KEY`/`DROPBOX_APP_SECRET` env vars,
 * both handled inside `DropboxAuthService`. These constants stay empty so nothing sensitive ships
 * in source control.
 */
export const DROPBOX_DEFAULT_APP_KEY = '';
export const DROPBOX_DEFAULT_APP_SECRET = '';
export const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
export const DROPBOX_API_BASE = 'https://api.dropboxapi.com/2';
export const DROPBOX_CONTENT_BASE = 'https://content.dropboxapi.com/2';

/** Supported book file extensions in the reading app. */
export const SUPPORTED_BOOK_EXTENSIONS = [
  'epub',
  'pdf',
  'txt',
  'md',
  'docx',
  'doc',
] as const;

export type SupportedBookExtension = (typeof SUPPORTED_BOOK_EXTENSIONS)[number];

export interface DropboxAppCredentials {
  readonly appKey: string;
  readonly appSecret: string;
}

/** Raw response from Dropbox /oauth2/token */
export interface DropboxTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly refresh_token?: string;
  readonly scope?: string;
  readonly uid?: string;
  readonly account_id?: string;
}

/** Sanitized & timestamped tokens for local/session storage */
export interface DropboxStoredTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number; // UNIX timestamp in milliseconds
  readonly tokenType: string;
  readonly scope?: string;
  readonly accountId?: string;
  readonly uid?: string;
}

/** Options for building the OAuth2 authorization URL */
export interface OAuthAuthUrlOptions {
  readonly appKey?: string;
  readonly redirectUri?: string;
  readonly state?: string;
  readonly tokenAccessType?: 'offline' | 'online';
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: 'S256';
  readonly forceReapprove?: boolean;
  readonly scope?: string;
}

/** Options for exchanging authorization code for tokens */
export interface TokenExchangeOptions {
  readonly code: string;
  readonly appKey?: string;
  readonly appSecret?: string;
  readonly redirectUri?: string;
  readonly codeVerifier?: string;
}

/** File metadata returned by Dropbox Files API */
export interface DropboxFileMetadata {
  readonly '.tag': 'file';
  readonly id: string;
  readonly name: string;
  readonly path_lower: string;
  readonly path_display: string;
  readonly size: number;
  readonly server_modified: string;
  readonly client_modified: string;
  readonly rev: string;
  readonly is_downloadable?: boolean;
  readonly content_hash?: string;
  readonly formatHint?: string;
}

/** Folder metadata returned by Dropbox Files API */
export interface DropboxFolderMetadata {
  readonly '.tag': 'folder';
  readonly id: string;
  readonly name: string;
  readonly path_lower: string;
  readonly path_display: string;
}

/** Deleted entry metadata returned by Dropbox delta sync */
export interface DropboxDeletedMetadata {
  readonly '.tag': 'deleted';
  readonly name: string;
  readonly path_lower?: string;
  readonly path_display?: string;
}

export type DropboxMetadataEntry =
  | DropboxFileMetadata
  | DropboxFolderMetadata
  | DropboxDeletedMetadata;

/** Options for listing files in a Dropbox folder */
export interface DropboxListFolderOptions {
  /** Folder path (use '' or '/' for root folder). */
  readonly path?: string;
  /** Whether to list recursively inside subdirectories. Default: true. */
  readonly recursive?: boolean;
  /** Whether to include deleted entries (useful during delta sync). */
  readonly includeDeleted?: boolean;
  /** Maximum number of entries per page. */
  readonly limit?: number;
  /** Allowed file extensions to filter for. Default: supported book extensions. */
  readonly allowedExtensions?: readonly string[];
}

/** Result of listing a Dropbox folder */
export interface DropboxListFolderResult {
  /** Filtered list of book files matching allowed extensions. */
  readonly entries: DropboxFileMetadata[];
  /** Latest cursor to use for future delta sync. */
  readonly cursor: string;
  /** Whether there are more entries to fetch. */
  readonly hasMore: boolean;
  /** All raw metadata entries returned by Dropbox (including non-book files/folders). */
  readonly rawEntries: DropboxMetadataEntry[];
}

/** Options for downloading a file from Dropbox */
export interface DropboxDownloadOptions {
  /** The path or ID of the file to download (e.g. '/books/alice.epub' or 'id:a4ayc_80_OEAAAAAAAAAXw') */
  readonly path: string;
  /** Optional specific revision */
  readonly rev?: string;
}

/** Result of downloading a file from Dropbox */
export interface DropboxDownloadResult {
  readonly metadata: DropboxFileMetadata;
  readonly data: ArrayBuffer;
  readonly text?: () => string;
  readonly blob?: () => Blob;
}

/** Type of file change detected during sync */
export type DropboxSyncChangeType = 'added' | 'modified' | 'deleted';

/** Single file change record */
export interface DropboxFileChange {
  readonly type: DropboxSyncChangeType;
  readonly path: string;
  readonly name: string;
  readonly formatHint?: string;
  readonly file?: DropboxFileMetadata;
}

/** Result of a delta sync execution */
export interface DropboxSyncResult {
  readonly cursor: string;
  readonly changes: DropboxFileChange[];
  readonly addedCount: number;
  readonly modifiedCount: number;
  readonly deletedCount: number;
  readonly totalProcessed: number;
}

/** Options for sync execution */
export interface DropboxSyncOptions {
  /** Dropbox folder path to sync from (default: ''). */
  readonly folderPath?: string;
  /** Cursor from previous sync (if available). */
  readonly cursor?: string;
  /** Allowed extensions (default: book extensions). */
  readonly allowedExtensions?: readonly string[];
  /** Optional local file records for timestamp comparison fallback. */
  readonly localFiles?: Array<{
    readonly path: string;
    readonly modifiedTime?: string;
    readonly size?: number;
  }>;
}
