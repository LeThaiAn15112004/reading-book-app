import type { ConnectionTestResult } from '../../src/domain/index.js';
import type {
  ExternalCatalogEntry,
  ExternalLibraryProvider,
  LinkLibraryOptions,
} from '../../src/domain-ports/index.js';

export interface ExternalLibraryProviderAdapter {
  readonly provider: ExternalLibraryProvider;
  testConnection(options?: LinkLibraryOptions): Promise<ConnectionTestResult>;
  pullCatalog(options?: LinkLibraryOptions, query?: string): Promise<ExternalCatalogEntry[]>;
}
