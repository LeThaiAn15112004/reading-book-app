import {
  getProviderDisplayName,
  type ConnectionTestResult,
  type ExternalLibraryInfo,
} from '../../src/domain/index.js';
import type {
  ExternalCatalogEntry,
  ExternalLibraryConnector,
  ExternalLibraryProvider,
  ExternalLibraryStatus,
  LinkLibraryOptions,
} from '../../src/domain-ports/index.js';
import {
  DefaultExternalLibraryRepository,
  type ExternalLibraryRepository,
} from '../repositories/external-library-repository.js';
import { GoogleDriveLibraryAdapter, type FileSystemScanner } from './google-drive-adapter.js';
import { DropboxLibraryAdapter } from './dropbox-adapter.js';
import { OneDriveLibraryAdapter } from './onedrive-adapter.js';
import type { ExternalLibraryProviderAdapter } from './types.js';

function createStoredConfig(options?: LinkLibraryOptions): ExternalLibraryInfo['config'] {
  return {
    folderPath: options?.folderPath,
    apiKey: options?.apiKey ?? 'xxx',
    oauthClientId: options?.oauthClientId,
    oauthRedirectUris: options?.oauthRedirectUris,
    oauthScopes: options?.oauthScopes,
    query: options?.query,
  };
}

export interface CompositeExternalLibraryConnectorOptions {
  repository?: ExternalLibraryRepository;
  fileScanner?: FileSystemScanner;
}

export class CompositeExternalLibraryConnector implements ExternalLibraryConnector {
  private readonly repository: ExternalLibraryRepository;
  private readonly adapters: Map<ExternalLibraryProvider, ExternalLibraryProviderAdapter>;
  private readonly inMemoryStatusCache = new Map<ExternalLibraryProvider, ExternalLibraryStatus>();

  constructor(options?: CompositeExternalLibraryConnectorOptions) {
    this.repository = options?.repository ?? new DefaultExternalLibraryRepository();
    this.adapters = new Map();

    const fileScanner = options?.fileScanner;
    this.adapters.set('google_drive', new GoogleDriveLibraryAdapter(fileScanner));
    this.adapters.set('dropbox', new DropboxLibraryAdapter({ fileScanner }));
    this.adapters.set('onedrive', new OneDriveLibraryAdapter({ fileScanner }));
  }

  listProviders(): ExternalLibraryProvider[] {
    return ['google_drive', 'dropbox', 'onedrive'];
  }

  status(provider: ExternalLibraryProvider): ExternalLibraryStatus {
    return this.inMemoryStatusCache.get(provider) ?? 'unlinked';
  }

  async getProviderInfo(provider: ExternalLibraryProvider): Promise<ExternalLibraryInfo> {
    const info = await this.repository.getProvider(provider);
    this.inMemoryStatusCache.set(provider, info.status);
    return info;
  }

  async getAllProvidersInfo(): Promise<Record<ExternalLibraryProvider, ExternalLibraryInfo>> {
    const infos = await this.repository.getAllProviders();
    for (const [p, info] of Object.entries(infos)) {
      this.inMemoryStatusCache.set(p as ExternalLibraryProvider, info.status);
    }
    return infos;
  }

  async link(
    provider: ExternalLibraryProvider,
    options?: LinkLibraryOptions,
  ): Promise<ExternalLibraryInfo> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Provider không được hỗ trợ: ${provider}`);
    }

    // Verify connection / path
    const testResult = await adapter.testConnection(options);
    if (!testResult.success) {
      const errorInfo: ExternalLibraryInfo = {
        provider,
        name: getProviderDisplayName(provider),
        status: 'error',
        lastError: testResult.message,
        config: createStoredConfig(options),
      };
      await this.repository.saveProvider(errorInfo);
      this.inMemoryStatusCache.set(provider, 'error');
      return errorInfo;
    }

    // Initial catalog pull to count items
    let initialCount = 0;
    try {
      const catalog = await adapter.pullCatalog(options);
      initialCount = catalog.length;
    } catch (err) {
      console.error(`[CompositeExternalLibraryConnector] link(${provider}) initial catalog pull failed:`, err);
      initialCount = 0;
    }

    const linkedInfo: ExternalLibraryInfo = {
      provider,
      name: getProviderDisplayName(provider),
      status: 'linked',
      linkedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      itemCount: initialCount,
      config: createStoredConfig(options),
    };

    await this.repository.saveProvider(linkedInfo);
    this.inMemoryStatusCache.set(provider, 'linked');
    return linkedInfo;
  }

  async unlink(provider: ExternalLibraryProvider): Promise<void> {
    await this.repository.removeProvider(provider);
    this.inMemoryStatusCache.set(provider, 'unlinked');
  }

  async pullCatalog(
    provider: ExternalLibraryProvider,
    query?: string,
  ): Promise<ExternalCatalogEntry[]> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      return [];
    }

    const info = await this.repository.getProvider(provider);
    if (info.status !== 'linked') {
      // Auto return empty or try with current config
    }

    try {
      const entries = await adapter.pullCatalog(info.config, query);
      await this.repository.updateSyncMetadata(provider, entries.length);
      return entries;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[CompositeExternalLibraryConnector] pullCatalog(${provider}) failed:`, err);
      await this.repository.updateSyncMetadata(provider, 0, errorMsg);
      throw err;
    }
  }

  async testConnection(
    provider: ExternalLibraryProvider,
    options?: LinkLibraryOptions,
  ): Promise<ConnectionTestResult> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      return {
        success: false,
        message: `Provider không được hỗ trợ: ${provider}`,
      };
    }
    return adapter.testConnection(options);
  }
}
