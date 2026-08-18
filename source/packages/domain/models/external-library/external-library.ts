import { DocumentFormat, isDocumentFormat } from '../book/document-format.js';

export type ExternalLibraryProvider =
  | 'google_drive'
  | 'google_books'
  | 'apple_books';

export type ExternalLibraryStatus =
  | 'unlinked'
  | 'linked'
  | 'syncing'
  | 'error'
  | 'disabled';

export interface ExternalLibraryConfig {
  /** Local folder path when linking to local synced directory or Apple Books. */
  readonly folderPath?: string;
  /** API key placeholder or key ('xxx' if not configured). */
  readonly apiKey?: string;
  /** OAuth client id loaded from a local Google client_secret JSON file. */
  readonly oauthClientId?: string;
  /** OAuth redirect URIs declared by the Google client. */
  readonly oauthRedirectUris?: readonly string[];
  /** OAuth scopes requested by Google sync flows. */
  readonly oauthScopes?: readonly string[];
  /** Optional custom search query or bookshelf identifier. */
  readonly query?: string;
  /** Auto sync interval in minutes if configured. */
  readonly autoSyncIntervalMinutes?: number;
}

export interface ExternalLibraryInfo {
  readonly provider: ExternalLibraryProvider;
  readonly name: string;
  readonly status: ExternalLibraryStatus;
  readonly linkedAt?: string;
  readonly lastSyncedAt?: string;
  readonly itemCount?: number;
  readonly config?: ExternalLibraryConfig;
  readonly lastError?: string;
}

export interface ExternalCatalogEntry {
  readonly externalId: string;
  readonly sourceProvider: ExternalLibraryProvider;
  readonly title: string;
  readonly authorNames?: string[];
  readonly formatHint?: DocumentFormat | string;
  /** Absolute path when the source is a local synced folder. */
  readonly localPath?: string;
  /** Direct or preview download URL if available. */
  readonly downloadUrl?: string;
  readonly previewUrl?: string;
  readonly coverUrl?: string;
  readonly fileSizeBytes?: number;
  readonly publishedDate?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface LinkLibraryOptions {
  /** Folder or library path chosen by the user (preferred over remote OAuth). */
  readonly folderPath?: string;
  /** API key or token if provider supports remote fetch (default/placeholder: 'xxx'). */
  readonly apiKey?: string;
  /** OAuth client id loaded from a local Google client_secret JSON file. */
  readonly oauthClientId?: string;
  /** OAuth redirect URIs declared by the Google client. */
  readonly oauthRedirectUris?: readonly string[];
  /** OAuth scopes requested by Google sync flows. */
  readonly oauthScopes?: readonly string[];
  /** Optional custom search query or bookshelf identifier. */
  readonly query?: string;
}

export interface ConnectionTestResult {
  readonly success: boolean;
  readonly message: string;
  readonly itemCount?: number;
}

const PROVIDER_NAMES: Record<ExternalLibraryProvider, string> = {
  google_drive: 'Google Drive',
  google_books: 'Google Books',
  apple_books: 'Apple Books',
};

export function getProviderDisplayName(provider: ExternalLibraryProvider): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

export function createDefaultProviderInfo(
  provider: ExternalLibraryProvider,
  status: ExternalLibraryStatus = 'unlinked',
): ExternalLibraryInfo {
  return {
    provider,
    name: getProviderDisplayName(provider),
    status,
    config: {
      apiKey: 'xxx',
    },
  };
}

export function isSupportedExternalFormat(formatOrExt: string): boolean {
  const clean = formatOrExt.trim().toLowerCase().replace(/^\./, '');
  if (isDocumentFormat(clean)) {
    return true;
  }
  return ['epub', 'pdf', 'txt', 'md'].includes(clean);
}
