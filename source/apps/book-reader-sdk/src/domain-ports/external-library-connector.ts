/**
 * External library catalog connector (Phase 3 / Giai đoạn 8 — SDS §2.9 / SRS FR-30, NFR-11, BR-08).
 *
 * Pulls document lists from Google Drive or Google Books into
 * the local Library. No app account: no email/password, no OAuth2 identity login.
 * Prefer folder / library path links already present on the device.
 */
import type {
  ExternalCatalogEntry,
  ExternalLibraryInfo,
  ExternalLibraryProvider,
  ExternalLibraryStatus,
  LinkLibraryOptions,
  ConnectionTestResult,
} from '../domain/external-library.js';

export type {
  ExternalLibraryProvider,
  ExternalLibraryStatus,
  ExternalLibraryConfig,
  ExternalLibraryInfo,
  ExternalCatalogEntry,
  LinkLibraryOptions,
  ConnectionTestResult,
} from '../domain/external-library.js';

/**
 * Port for linking external libraries (Google Drive, Google Books)
 * and querying/pulling their document catalogs into local Library.
 */
export interface ExternalLibraryConnector {
  /** Returns list of supported external library providers. */
  listProviders(): ExternalLibraryProvider[];

  /** Get connection status and metadata for a single provider. */
  getProviderInfo(provider: ExternalLibraryProvider): Promise<ExternalLibraryInfo>;

  /** Get status and metadata for all supported providers. */
  getAllProvidersInfo(): Promise<Record<ExternalLibraryProvider, ExternalLibraryInfo>>;

  /** Synchronous status helper if available. */
  status(provider: ExternalLibraryProvider): ExternalLibraryStatus;

  /** Link a provider using local folder path or API config (placeholder key: 'xxx'). */
  link(
    provider: ExternalLibraryProvider,
    options?: LinkLibraryOptions,
  ): Promise<ExternalLibraryInfo>;

  /** Unlink a provider. Does NOT delete already imported books or highlights. */
  unlink(provider: ExternalLibraryProvider): Promise<void>;

  /** Pull document catalog entries from the linked provider. */
  pullCatalog(
    provider: ExternalLibraryProvider,
    query?: string,
  ): Promise<ExternalCatalogEntry[]>;

  /** Test connection/path validity before saving link. */
  testConnection(
    provider: ExternalLibraryProvider,
    options?: LinkLibraryOptions,
  ): Promise<ConnectionTestResult>;
}

/** Fallback / No-Op stub — used when running in restricted environments or initial state. */
export class NoOpExternalLibraryConnector implements ExternalLibraryConnector {
  listProviders(): ExternalLibraryProvider[] {
    return ['google_drive', 'dropbox', 'onedrive'];
  }

  status(_provider: ExternalLibraryProvider): ExternalLibraryStatus {
    return 'unlinked';
  }

  async getProviderInfo(provider: ExternalLibraryProvider): Promise<ExternalLibraryInfo> {
    const defaultNames: Record<ExternalLibraryProvider, string> = {
      google_drive: 'Google Drive',
      dropbox: 'Dropbox',
      onedrive: 'Microsoft OneDrive',
    };
    return {
      provider,
      name: defaultNames[provider] ?? provider,
      status: 'unlinked',
      config: { apiKey: 'xxx' },
    };
  }

  async getAllProvidersInfo(): Promise<Record<ExternalLibraryProvider, ExternalLibraryInfo>> {
    const providers = this.listProviders();
    const result: Record<string, ExternalLibraryInfo> = {};
    for (const p of providers) {
      result[p] = await this.getProviderInfo(p);
    }
    return result as Record<ExternalLibraryProvider, ExternalLibraryInfo>;
  }

  async link(
    provider: ExternalLibraryProvider,
    options?: LinkLibraryOptions,
  ): Promise<ExternalLibraryInfo> {
    const defaultNames: Record<ExternalLibraryProvider, string> = {
      google_drive: 'Google Drive',
      dropbox: 'Dropbox',
      onedrive: 'Microsoft OneDrive',
    };
    return {
      provider,
      name: defaultNames[provider] ?? provider,
      status: 'linked',
      linkedAt: new Date().toISOString(),
      config: {
        folderPath: options?.folderPath,
        apiKey: options?.apiKey ?? 'xxx',
        oauthClientId: options?.oauthClientId,
        oauthRedirectUris: options?.oauthRedirectUris,
        oauthScopes: options?.oauthScopes,
        query: options?.query,
      },
    };
  }

  async unlink(_provider: ExternalLibraryProvider): Promise<void> {
    /* no-op */
  }

  async pullCatalog(
    _provider: ExternalLibraryProvider,
    _query?: string,
  ): Promise<ExternalCatalogEntry[]> {
    return [];
  }

  async testConnection(
    _provider: ExternalLibraryProvider,
    _options?: LinkLibraryOptions,
  ): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'NoOp connector test passed',
    };
  }
}
