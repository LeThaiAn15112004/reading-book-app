import type { ConnectionTestResult } from '../../../../core/src/domain/index.js';
import type {
  ExternalCatalogEntry,
  ExternalLibraryProvider,
  LinkLibraryOptions,
} from '../../../../core/src/domain-ports/index.js';

export interface ExternalLibraryProviderAdapter {
  readonly provider: ExternalLibraryProvider;
  testConnection(options?: LinkLibraryOptions): Promise<ConnectionTestResult>;
  pullCatalog(options?: LinkLibraryOptions, query?: string): Promise<ExternalCatalogEntry[]>;
}
