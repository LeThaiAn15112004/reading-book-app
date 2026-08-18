import type {
  ConnectionTestResult,
  ExternalCatalogEntry,
  ExternalLibraryProvider,
  LinkLibraryOptions,
} from '@reading-book/domain';

export interface ExternalLibraryProviderAdapter {
  readonly provider: ExternalLibraryProvider;
  testConnection(options?: LinkLibraryOptions): Promise<ConnectionTestResult>;
  pullCatalog(options?: LinkLibraryOptions, query?: string): Promise<ExternalCatalogEntry[]>;
}
