import { useCallback, useEffect, useState } from 'react';
import type {
  ConnectionTestResult,
  ExternalCatalogEntry,
  ExternalLibraryConnector,
  ExternalLibraryInfo,
  ExternalLibraryProvider,
  LinkLibraryOptions,
} from '@reading-book/book-reader-sdk';
import { CompositeExternalLibraryConnector } from '../../../../book-reader-sdk/host-adapters/external-libraries/composite-connector.js';
import {
  getAllExternalLibrariesStatus,
  linkExternalLibrary,
  pullExternalCatalog,
  testExternalLibraryConnection,
  unlinkExternalLibrary,
} from '../../../../book-reader-sdk/host-adapters/services/external-library.js';

let defaultConnectorInstance: ExternalLibraryConnector | null = null;

function getSharedConnector(): ExternalLibraryConnector {
  if (!defaultConnectorInstance) {
    defaultConnectorInstance = new CompositeExternalLibraryConnector();
  }
  return defaultConnectorInstance;
}

export interface UseLinkedLibrariesOptions {
  connector?: ExternalLibraryConnector;
  autoLoad?: boolean;
}

export function useLinkedLibraries(options?: UseLinkedLibrariesOptions) {
  const connector = options?.connector ?? getSharedConnector();
  const [providers, setProviders] = useState<Record<ExternalLibraryProvider, ExternalLibraryInfo>>({
    google_drive: {
      provider: 'google_drive',
      name: 'Google Drive',
      status: 'unlinked',
      config: { apiKey: 'xxx' },
    },
    dropbox: {
      provider: 'dropbox',
      name: 'Dropbox',
      status: 'unlinked',
      config: { apiKey: 'xxx' },
    },
    onedrive: {
      provider: 'onedrive',
      name: 'Microsoft OneDrive',
      status: 'unlinked',
      config: { apiKey: 'xxx' },
    },
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const all = await getAllExternalLibrariesStatus(connector);
      setProviders(all);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [connector]);

  useEffect(() => {
    if (options?.autoLoad !== false) {
      void refresh();
    }
  }, [options?.autoLoad, refresh]);

  const link = useCallback(
    async (
      provider: ExternalLibraryProvider,
      linkOpts?: LinkLibraryOptions,
    ): Promise<ExternalLibraryInfo> => {
      setIsLoading(true);
      setError(null);
      try {
        const info = await linkExternalLibrary(connector, provider, linkOpts);
        setProviders((prev) => ({
          ...prev,
          [provider]: info,
        }));
        return info;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connector],
  );

  const unlink = useCallback(
    async (provider: ExternalLibraryProvider): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        await unlinkExternalLibrary(connector, provider);
        await refresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connector, refresh],
  );

  const pullCatalog = useCallback(
    async (
      provider: ExternalLibraryProvider,
      query?: string,
    ): Promise<ExternalCatalogEntry[]> => {
      setIsLoading(true);
      setError(null);
      try {
        const catalog = await pullExternalCatalog(connector, provider, query);
        await refresh();
        return catalog;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connector, refresh],
  );

  const testConnection = useCallback(
    async (
      provider: ExternalLibraryProvider,
      testOpts?: LinkLibraryOptions,
    ): Promise<ConnectionTestResult> => {
      return testExternalLibraryConnection(connector, provider, testOpts);
    },
    [connector],
  );

  return {
    providers,
    isLoading,
    error,
    refresh,
    link,
    unlink,
    pullCatalog,
    testConnection,
  };
}
