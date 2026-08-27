import { useCallback, useEffect, useState } from 'react'
import { useLinkedLibraries } from '@reading-book/shared/hooks/app'
import type { ExternalCatalogEntry, ExternalLibraryProvider } from '@reading-book/domain'
import { cloudApi } from '../../../bridge'

/** Byte progress for the entry currently being downloaded (keyed by externalId). */
export type DownloadProgress = { receivedBytes: number; totalBytes: number | null }

/**
 * Google Drive is scoped by folder ID, not a path — default to empty (whole
 * Drive) so we never send a bogus query. Dropbox/OneDrive use real paths.
 */
const DEFAULT_FOLDER_PATH: Record<ExternalLibraryProvider, string> = {
  google_drive: '',
  dropbox: '/Ebooks',
  onedrive: '/Ebooks',
}

export type CloudToastVariant = 'success' | 'error' | 'info'

export type UseCloudSourcesOptions = {
  showToast: (message: string, variant: CloudToastVariant) => void
  /** Called after a successful download so the Library grid refreshes. */
  onDownloaded: () => void
}

/** Cloud Sources tab controller: connect/disconnect, folder-scoped sync, lazy download. */
export function useCloudSources(options: UseCloudSourcesOptions) {
  const { providers, isLoading, link, unlink, pullCatalog } = useLinkedLibraries()
  const [folderPaths, setFolderPaths] = useState<
    Record<ExternalLibraryProvider, string>
  >({ ...DEFAULT_FOLDER_PATH })
  const [catalogs, setCatalogs] = useState<
    Partial<Record<ExternalLibraryProvider, ExternalCatalogEntry[]>>
  >({})
  const [connectingProvider, setConnectingProvider] =
    useState<ExternalLibraryProvider | null>(null)
  const [syncingProvider, setSyncingProvider] =
    useState<ExternalLibraryProvider | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [progressByExternalId, setProgressByExternalId] = useState<
    Record<string, DownloadProgress>
  >({})

  useEffect(() => {
    return cloudApi.onDownloadProgress((progress) => {
      setProgressByExternalId((prev) => ({
        ...prev,
        [progress.externalId]: {
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes,
        },
      }))
    })
  }, [])

  const downloadProgress = downloadingId ? (progressByExternalId[downloadingId] ?? null) : null

  function setFolderPath(provider: ExternalLibraryProvider, value: string) {
    setFolderPaths((prev) => ({ ...prev, [provider]: value }))
  }

  const connect = useCallback(
    async (provider: ExternalLibraryProvider) => {
      setConnectingProvider(provider)
      try {
        const result = await cloudApi.connect(provider)
        if (!result.ok) {
          options.showToast(
            result.errorMessage ?? `Could not connect to ${provider}.`,
            'error',
          )
          return
        }
        const token = await cloudApi.getAccessToken(provider)
        await link(provider, {
          apiKey: token ?? undefined,
          folderPath: folderPaths[provider],
        })
        options.showToast('Connected.', 'success')
      } catch (err) {
        options.showToast(
          err instanceof Error ? err.message : 'Could not connect.',
          'error',
        )
      } finally {
        setConnectingProvider(null)
      }
    },
    [link, folderPaths, options],
  )

  const disconnect = useCallback(
    async (provider: ExternalLibraryProvider) => {
      await cloudApi.disconnect(provider)
      await unlink(provider)
      setCatalogs((prev) => ({ ...prev, [provider]: undefined }))
    },
    [unlink],
  )

  const sync = useCallback(
    async (provider: ExternalLibraryProvider) => {
      setSyncingProvider(provider)
      try {
        const token = await cloudApi.getAccessToken(provider)
        await link(provider, {
          apiKey: token ?? undefined,
          folderPath: folderPaths[provider],
        })
        const entries = await pullCatalog(provider)
        setCatalogs((prev) => ({ ...prev, [provider]: entries }))
      } catch (err) {
        console.error(`[Cloud Sources] Sync now failed for ${provider}:`, err)
        options.showToast(
          err instanceof Error ? err.message : 'Sync failed.',
          'error',
        )
      } finally {
        setSyncingProvider(null)
      }
    },
    [link, pullCatalog, folderPaths, options],
  )

  const download = useCallback(
    async (provider: ExternalLibraryProvider, entry: ExternalCatalogEntry) => {
      setDownloadingId(entry.externalId)
      try {
        const result = await cloudApi.downloadAndImport(provider, entry)
        if (result.ok) {
          options.showToast(`Downloaded "${entry.title}".`, 'success')
          options.onDownloaded()
        } else {
          options.showToast(
            result.errorMessage ?? `Could not download "${entry.title}".`,
            'error',
          )
        }
      } finally {
        setDownloadingId(null)
        setProgressByExternalId((prev) => {
          if (!(entry.externalId in prev)) return prev
          const { [entry.externalId]: _removed, ...rest } = prev
          return rest
        })
      }
    },
    [options],
  )

  return {
    providers,
    isLoading,
    folderPaths,
    setFolderPath,
    catalogs,
    connectingProvider,
    syncingProvider,
    downloadingId,
    downloadProgress,
    connect,
    disconnect,
    sync,
    download,
  }
}
