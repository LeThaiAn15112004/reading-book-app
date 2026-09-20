import type { ConnectionTestResult, ExternalLibraryInfo } from '../../src/domain/index.js';
import type {
  ExternalCatalogEntry,
  ExternalLibraryConnector,
  ExternalLibraryProvider,
  LinkLibraryOptions,
} from '../../src/domain-ports/index.js';

/**
 * Link an external library provider (Google Drive, Google Books)
 * without requiring any user account/identity.
 */
export async function linkExternalLibrary(
  connector: ExternalLibraryConnector,
  provider: ExternalLibraryProvider,
  options?: LinkLibraryOptions,
): Promise<ExternalLibraryInfo> {
  return connector.link(provider, options);
}

/**
 * Unlink an external library provider.
 * Guarantees that already imported books and highlights in local sandbox remain intact.
 */
export async function unlinkExternalLibrary(
  connector: ExternalLibraryConnector,
  provider: ExternalLibraryProvider,
): Promise<void> {
  return connector.unlink(provider);
}

/**
 * Pull document catalog list from an external library source.
 */
export async function pullExternalCatalog(
  connector: ExternalLibraryConnector,
  provider: ExternalLibraryProvider,
  query?: string,
): Promise<ExternalCatalogEntry[]> {
  return connector.pullCatalog(provider, query);
}

/**
 * Get status and metadata for a specific provider.
 */
export async function getExternalLibraryStatus(
  connector: ExternalLibraryConnector,
  provider: ExternalLibraryProvider,
): Promise<ExternalLibraryInfo> {
  return connector.getProviderInfo(provider);
}

/**
 * Get status and metadata for all supported external library providers.
 */
export async function getAllExternalLibrariesStatus(
  connector: ExternalLibraryConnector,
): Promise<Record<ExternalLibraryProvider, ExternalLibraryInfo>> {
  return connector.getAllProvidersInfo();
}

/**
 * Test connection or folder path before saving link options.
 */
export async function testExternalLibraryConnection(
  connector: ExternalLibraryConnector,
  provider: ExternalLibraryProvider,
  options?: LinkLibraryOptions,
): Promise<ConnectionTestResult> {
  return connector.testConnection(provider, options);
}
