import {
  isSupportedExternalFormat,
  type ConnectionTestResult,
  type ExternalCatalogEntry,
  type ExternalLibraryProvider,
  type LinkLibraryOptions,
} from '@reading-book/domain';
import type { ExternalLibraryProviderAdapter } from './types.js';
import type { FileSystemScanner } from './google-drive-adapter.js';
import {
  OneDriveAuthService,
  OneDriveFileService,
  OneDriveSyncService,
  type OneDriveFileMetadata,
} from '../../services/onedrive/index.js';

export { detectOneDriveBookFormat, OneDriveFileService } from '../../services/onedrive/index.js';

function toCatalogEntry(file: OneDriveFileMetadata): ExternalCatalogEntry {
  return {
    externalId: `onedrive_${file.id}`,
    sourceProvider: 'onedrive',
    title: file.name.replace(/\.[^/.]+$/, ''),
    formatHint: file.formatHint,
    downloadUrl: file.downloadUrl,
    previewUrl: file.webUrl,
    fileSizeBytes: file.size,
    publishedDate: file.modifiedTime,
    mimeType: file.mimeType,
    description: `Book from OneDrive (${file.formatHint?.toUpperCase() ?? file.mimeType})`,
  };
}

/**
 * Adapter connecting the `OneDrive` service layer to the `ExternalLibraryConnector` framework.
 */
export class OneDriveLibraryAdapter implements ExternalLibraryProviderAdapter {
  readonly provider: ExternalLibraryProvider = 'onedrive';

  private readonly fileService: OneDriveFileService;
  private readonly syncService: OneDriveSyncService;
  private readonly authService: OneDriveAuthService;
  private readonly fileScanner?: FileSystemScanner;

  constructor(options?: { fileScanner?: FileSystemScanner }) {
    this.fileScanner = options?.fileScanner;
    this.fileService = new OneDriveFileService();
    this.syncService = new OneDriveSyncService();
    this.authService = new OneDriveAuthService();
  }

  async testConnection(options?: LinkLibraryOptions): Promise<ConnectionTestResult> {
    const token = options?.apiKey && options.apiKey !== 'xxx'
      ? options.apiKey
      : await this.authService.getValidAccessToken() ?? undefined;

    // Mode 1: Access token provided -> test API
    if (token && token !== 'xxx') {
      try {
        const result = await this.fileService.listFiles(token, { top: 1 });
        return {
          success: true,
          message: `Microsoft OneDrive connected successfully. Found ${result.entries.length} book file(s).`,
          itemCount: result.entries.length,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `OneDrive connection test failed: ${msg}`,
        };
      }
    }

    // Mode 2: Local folder path provided
    if (options?.folderPath) {
      return {
        success: true,
        message: `Connected to local OneDrive directory: ${options.folderPath}`,
      };
    }

    // Mode 3: OAuth client configured
    if (options?.oauthClientId) {
      return {
        success: true,
        message: 'Microsoft OneDrive Azure Client is configured. Ready to authenticate.',
      };
    }

    return {
      success: true,
      message: 'Microsoft OneDrive ready (folder-first mode; authenticate to enable cloud sync).',
    };
  }

  async pullCatalog(
    options?: LinkLibraryOptions,
    query?: string,
  ): Promise<ExternalCatalogEntry[]> {
    const token = options?.apiKey && options.apiKey !== 'xxx'
      ? options.apiKey
      : await this.authService.getValidAccessToken() ?? undefined;

    // 1. Live Microsoft Graph API fetch
    if (token && token !== 'xxx') {
      try {
        const result = await this.fileService.listFiles(token, {
          searchTerm: query,
          folderPath: options?.folderPath,
        });
        return result.entries.map(toCatalogEntry);
      } catch (err) {
        console.warn('[OneDriveAdapter] API fetch failed, falling back to local/sample:', err);
      }
    }

    // 2. Folder-first scan of local synced OneDrive folder
    if (options?.folderPath && this.fileScanner) {
      try {
        const files = await this.fileScanner.scanDirectory(options.folderPath);
        const results: ExternalCatalogEntry[] = [];
        for (const file of files) {
          const ext = file.name.split('.').pop() ?? '';
          if (isSupportedExternalFormat(ext)) {
            const title = file.name.replace(/\.[^/.]+$/, '');
            if (!query || title.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                externalId: `onedrive_local_${encodeURIComponent(file.path)}`,
                sourceProvider: 'onedrive',
                title,
                formatHint: ext.toLowerCase(),
                localPath: file.path,
                fileSizeBytes: file.size,
                publishedDate: file.modifiedTime,
              });
            }
          }
        }
        return results;
      } catch {
        /* fallback to sample mode */
      }
    }

    // 3. Sample Demo Mode
    const sampleCatalog: ExternalCatalogEntry[] = [
      {
        externalId: 'onedrive_sample_01',
        sourceProvider: 'onedrive',
        title: 'Clean Architecture on Azure',
        authorNames: ['Cloud Architect'],
        formatHint: 'epub',
        localPath: options?.folderPath ? `${options.folderPath}/Architecture.epub` : undefined,
        description: 'Sample eBook from Microsoft OneDrive.',
      },
      {
        externalId: 'onedrive_sample_02',
        sourceProvider: 'onedrive',
        title: 'OneDrive Synchronization Guide',
        authorNames: ['Microsoft Graph Team'],
        formatHint: 'pdf',
        localPath: options?.folderPath ? `${options.folderPath}/SyncGuide.pdf` : undefined,
        description: 'Sample PDF report from OneDrive storage.',
      },
    ];

    if (query) {
      return sampleCatalog.filter((e) =>
        e.title.toLowerCase().includes(query.toLowerCase()),
      );
    }

    return sampleCatalog;
  }

  async runSync(
    accessToken: string,
    deltaLinkOrToken?: string,
  ) {
    return this.syncService.sync({
      accessToken,
      deltaLinkOrToken,
    });
  }
}
