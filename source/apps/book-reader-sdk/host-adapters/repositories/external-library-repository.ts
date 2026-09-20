import { createDefaultProviderInfo, type ExternalLibraryInfo } from '../../src/domain/index.js';
import type { ExternalLibraryProvider } from '../../src/domain-ports/index.js';
import {
  createDefaultExternalLibraryStorage,
  type ExternalLibraryStorage,
} from '../storage/external-library-storage.js';

const STORAGE_PREFIX = 'reading_book:external_lib:';

export interface ExternalLibraryRepository {
  getProvider(provider: ExternalLibraryProvider): Promise<ExternalLibraryInfo>;
  getAllProviders(): Promise<Record<ExternalLibraryProvider, ExternalLibraryInfo>>;
  saveProvider(info: ExternalLibraryInfo): Promise<void>;
  removeProvider(provider: ExternalLibraryProvider): Promise<void>;
  updateSyncMetadata(
    provider: ExternalLibraryProvider,
    itemCount: number,
    lastError?: string,
  ): Promise<ExternalLibraryInfo>;
}

export class DefaultExternalLibraryRepository implements ExternalLibraryRepository {
  private readonly storage: ExternalLibraryStorage;
  private readonly supportedProviders: ExternalLibraryProvider[] = [
    'google_drive',
    'dropbox',
    'onedrive',
  ];

  constructor(storage?: ExternalLibraryStorage) {
    this.storage = storage ?? createDefaultExternalLibraryStorage();
  }

  private storageKey(provider: ExternalLibraryProvider): string {
    return `${STORAGE_PREFIX}${provider}`;
  }

  async getProvider(provider: ExternalLibraryProvider): Promise<ExternalLibraryInfo> {
    try {
      const raw = await this.storage.getItem(this.storageKey(provider));
      if (!raw) {
        return createDefaultProviderInfo(provider, 'unlinked');
      }
      const parsed = JSON.parse(raw) as ExternalLibraryInfo;
      return {
        ...createDefaultProviderInfo(provider, parsed.status ?? 'unlinked'),
        ...parsed,
        provider,
      };
    } catch {
      return createDefaultProviderInfo(provider, 'unlinked');
    }
  }

  async getAllProviders(): Promise<Record<ExternalLibraryProvider, ExternalLibraryInfo>> {
    const result = {} as Record<ExternalLibraryProvider, ExternalLibraryInfo>;
    for (const provider of this.supportedProviders) {
      result[provider] = await this.getProvider(provider);
    }
    return result;
  }

  async saveProvider(info: ExternalLibraryInfo): Promise<void> {
    await this.storage.setItem(this.storageKey(info.provider), JSON.stringify(info));
  }

  async removeProvider(provider: ExternalLibraryProvider): Promise<void> {
    const unlinkedInfo = createDefaultProviderInfo(provider, 'unlinked');
    await this.storage.setItem(this.storageKey(provider), JSON.stringify(unlinkedInfo));
  }

  async updateSyncMetadata(
    provider: ExternalLibraryProvider,
    itemCount: number,
    lastError?: string,
  ): Promise<ExternalLibraryInfo> {
    const current = await this.getProvider(provider);
    const updated: ExternalLibraryInfo = {
      ...current,
      lastSyncedAt: new Date().toISOString(),
      itemCount,
      lastError: lastError ?? undefined,
      status: lastError ? 'error' : 'linked',
    };
    await this.saveProvider(updated);
    return updated;
  }
}
