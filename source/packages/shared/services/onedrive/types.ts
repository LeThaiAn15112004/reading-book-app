/**
 * Types, interfaces, and constants for Microsoft OneDrive & Microsoft Graph API integration.
 * Supports MSAL and native OAuth 2.0 PKCE auth, file listing, binary downloading, and delta sync.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * No client ID is baked in here — it lives in the gitignored
 * `packages/config/cloud-oauth-secrets.json` (loaded by the desktop app's
 * `electron/config/cloud-oauth-config.ts`) or the `AZURE_CLIENT_ID` env var, both handled inside
 * `OneDriveAuthService`.
 */
export const ONEDRIVE_DEFAULT_CLIENT_ID = '';
/**
 * No tenant is pinned by default: the app must accept personal Microsoft accounts
 * (@outlook.com, @hotmail.com, @live.com), which do not belong to any Azure AD organization
 * tenant. Leaving this empty routes sign-in through the `common` endpoint (see
 * `MICROSOFT_OAUTH_AUTH_URL` / `MICROSOFT_OAUTH_TOKEN_URL` below), which accepts both personal
 * (MSA) and work/school (AAD) accounts, matching an app registration configured for "Accounts in
 * any organizational directory and personal Microsoft accounts". A deployment that genuinely needs
 * to restrict sign-in to one organization tenant can still opt in via the `AZURE_TENANT_ID` env var
 * or `OneDriveAppCredentials.tenantId` — see `OneDriveAuthService`.
 */
export const ONEDRIVE_DEFAULT_TENANT_ID = '';
export const ONEDRIVE_DEFAULT_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
export const MICROSOFT_AUTH_AUTHORITY = 'https://login.microsoftonline.com/common';

export const MICROSOFT_OAUTH_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const MICROSOFT_OAUTH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const MICROSOFT_GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Default OAuth2 scopes required for OneDrive book reader integration.
 * - Files.ReadWrite: read and sync book files in OneDrive
 * - offline_access: get refresh_token for silent background sync
 * - User.Read: access basic profile info
 */
export const ONEDRIVE_DEFAULT_SCOPES = [
  'Files.ReadWrite',
  'offline_access',
  'User.Read',
] as const;

export type OneDriveScope = (typeof ONEDRIVE_DEFAULT_SCOPES)[number] | string;

/** Supported book extensions for OneDrive sync */
export const ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS = [
  'epub',
  'pdf',
  'txt',
  'mobi',
  'md',
  'docx',
  'doc',
  'azw3',
  'fb2',
  'cbz',
] as const;

export type OneDriveSupportedBookExtension = (typeof ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS)[number];

// ─── Credentials & Token Types ─────────────────────────────────────────────

export interface OneDriveAppCredentials {
  readonly clientId: string;
  readonly tenantId?: string;
  readonly redirectUri?: string;
  readonly authority?: string;
}

/** Raw token response from Microsoft OAuth2 token endpoint */
export interface MicrosoftOAuthTokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly ext_expires_in?: number;
  readonly refresh_token?: string;
  readonly scope?: string;
  readonly id_token?: string;
}

/** Stored & normalized tokens for local persistence */
export interface OneDriveStoredTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number; // UNIX timestamp in ms
  readonly tokenType: string;
  readonly scope?: string;
  readonly accountId?: string;
  readonly userPrincipalName?: string;
}

// ─── OAuth Options ─────────────────────────────────────────────────────────

export interface OneDriveOAuthUrlOptions {
  readonly clientId?: string;
  readonly tenantId?: string;
  readonly redirectUri?: string;
  readonly scopes?: readonly string[];
  readonly state?: string;
  readonly prompt?: 'select_account' | 'login' | 'consent' | 'none';
  /** PKCE code challenge (Base64URL encoded SHA-256) */
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: 'S256';
  readonly loginHint?: string;
  readonly domainHint?: string;
}

export interface OneDriveTokenExchangeOptions {
  readonly code: string;
  readonly clientId?: string;
  readonly redirectUri?: string;
  readonly codeVerifier?: string;
  readonly scopes?: readonly string[];
}

// ─── Microsoft Graph Drive Item Types ──────────────────────────────────────

export interface GraphDriveItem {
  readonly id: string;
  readonly name: string;
  readonly size?: number;
  readonly createdDateTime?: string;
  readonly lastModifiedDateTime?: string;
  readonly webUrl?: string;
  readonly '@microsoft.graph.downloadUrl'?: string;
  readonly file?: {
    readonly mimeType?: string;
    readonly hashes?: {
      readonly quickXorHash?: string;
      readonly sha1Hash?: string;
      readonly sha256Hash?: string;
    };
  };
  readonly folder?: {
    readonly childCount?: number;
  };
  readonly parentReference?: {
    readonly driveId?: string;
    readonly driveType?: string;
    readonly id?: string;
    readonly name?: string;
    readonly path?: string;
  };
  readonly deleted?: {
    readonly state?: string;
  };
}

export interface OneDriveFileMetadata {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size?: number;
  readonly modifiedTime?: string;
  readonly createdTime?: string;
  readonly webUrl?: string;
  readonly downloadUrl?: string;
  readonly formatHint?: string;
  readonly parentPath?: string;
  readonly isDeleted?: boolean;
}

export interface OneDriveFolderMetadata {
  readonly id: string;
  readonly name: string;
  readonly childCount?: number;
  readonly webUrl?: string;
  readonly parentPath?: string;
}

// ─── File Listing ──────────────────────────────────────────────────────────

export interface OneDriveListFilesOptions {
  /** Folder ID to list from (default: root folder) */
  readonly folderId?: string;
  /** Subfolder path relative to root, e.g., 'Books' or 'Documents/eBooks' */
  readonly folderPath?: string;
  /** Keyword search term */
  readonly searchTerm?: string;
  /** Max items per page (default: 100, max: 1000) */
  readonly top?: number;
  /** Next link token for pagination */
  readonly nextLink?: string;
  /** Allowed extensions (defaults to ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS) */
  readonly allowedExtensions?: readonly string[];
  /** Search recursively in subfolders */
  readonly recursive?: boolean;
}

export interface OneDriveListFilesResult {
  readonly entries: OneDriveFileMetadata[];
  readonly nextLink?: string;
}

// ─── Download ──────────────────────────────────────────────────────────────

export interface OneDriveDownloadResult {
  readonly metadata: OneDriveFileMetadata;
  readonly data: ArrayBuffer;
  readonly blob: () => Blob;
  readonly text: () => string;
}

// ─── Delta Sync Types ──────────────────────────────────────────────────────

export type OneDriveChangeType = 'added' | 'modified' | 'deleted';

export interface OneDriveFileChange {
  readonly type: OneDriveChangeType;
  readonly fileId: string;
  readonly name: string;
  readonly formatHint?: string;
  readonly file?: OneDriveFileMetadata;
}

export interface OneDriveSyncOptions {
  /** Delta link / token from previous sync run */
  readonly deltaLinkOrToken?: string;
  /** Specific folder ID or path to sync */
  readonly folderId?: string;
  /** Allowed book extensions */
  readonly allowedExtensions?: readonly string[];
  /** Local files for fallback timestamp comparison */
  readonly localFiles?: ReadonlyArray<{
    readonly id?: string;
    readonly path: string;
    readonly modifiedTime?: string;
    readonly size?: number;
  }>;
}

export interface OneDriveSyncResult {
  /** New delta token or delta URL for the next sync pass */
  readonly nextDeltaLink: string;
  readonly changes: OneDriveFileChange[];
  readonly addedCount: number;
  readonly modifiedCount: number;
  readonly deletedCount: number;
  readonly totalProcessed: number;
}
