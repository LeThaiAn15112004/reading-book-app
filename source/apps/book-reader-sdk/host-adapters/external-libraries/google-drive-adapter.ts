import type { ConnectionTestResult } from '../../src/domain/index.js';
import type {
  ExternalCatalogEntry,
  ExternalLibraryProvider,
  LinkLibraryOptions,
} from '../../src/domain-ports/index.js';
import type { ExternalLibraryProviderAdapter } from './types.js';
import {
  GoogleDriveAuthService,
  GoogleDriveFileService,
  GoogleDriveSyncService,
  GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS,
  type GoogleDriveFileMetadata,
} from '../services/google-drive/index.js';

// ─── File System Scanner (folder-first mode) ────────────────────────────────

export interface FileSystemScanner {
  scanDirectory(path: string): Promise<
    Array<{
      name: string;
      path: string;
      size?: number;
      modifiedTime?: string;
    }>
  >;
}

// ─── Re-export helpers from the service layer ────────────────────────────────

export {
  detectBookFormat as detectGoogleDriveBookFormat,
  GoogleDriveFileService,
} from '../services/google-drive/index.js';

// ─── Folder ID handling ─────────────────────────────────────────────────────

/**
 * Google Drive scopes listings by folder *ID* (the opaque string after
 * `/folders/` in the folder's Drive URL), not a filesystem-style path.
 * Returns `undefined` (search the whole Drive) when the field is empty, and
 * throws a clear, actionable error when the value looks like a path instead
 * of an ID so a bad query is never silently sent to the API.
 */
export function normalizeGoogleDriveFolderId(rawFolderPath?: string): string | undefined {
  const trimmed = rawFolderPath?.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(
      `"${trimmed}" looks like a folder path, but Google Drive needs a folder ID instead ` +
        `(the string after /folders/ in the folder's Drive URL). Leave the field empty to search your whole Drive.`,
    );
  }
  return trimmed;
}

// ─── Map a Drive metadata object to an ExternalCatalogEntry ────────────────

function toCatalogEntry(file: GoogleDriveFileMetadata): ExternalCatalogEntry {
  return {
    externalId: `gdrive_${file.id}`,
    sourceProvider: 'google_drive',
    title: file.name.replace(/\.[^/.]+$/, ''),
    formatHint: file.formatHint,
    downloadUrl: file.webContentLink,
    previewUrl: file.webViewLink,
    coverUrl: file.thumbnailLink,
    fileSizeBytes: file.size,
    publishedDate: file.modifiedTime,
    mimeType: file.mimeType,
    description: `Book from Google Drive (${file.formatHint?.toUpperCase() ?? file.mimeType})`,
  };
}

// ─── Adapter ────────────────────────────────────────────────────────────────

/**
 * Adapter connecting the `GoogleDriveLibraryService` layer to the
 * `ExternalLibraryConnector` infrastructure. Supports two operating modes,
 * tried in order — errors from either mode are thrown, never swallowed into
 * placeholder data:
 *
 *  1. **OAuth2 API mode** – uses a live access token (`options.apiKey`, or the
 *     adapter's own stored token) to query the Drive REST API in real-time.
 *  2. **Folder-first mode** – scans a locally-synced Google Drive folder on disk
 *     (via `FileSystemScanner`) when `options.folderPath` is provided and no
 *     token is available.
 */
export class GoogleDriveLibraryAdapter implements ExternalLibraryProviderAdapter {
  readonly provider: ExternalLibraryProvider = 'google_drive';

  private readonly fileService: GoogleDriveFileService;
  private readonly syncService: GoogleDriveSyncService;
  private readonly authService: GoogleDriveAuthService;
  private readonly fileScanner?: FileSystemScanner;

  constructor(fileScanner?: FileSystemScanner) {
    this.fileScanner = fileScanner;
    this.fileService = new GoogleDriveFileService();
    this.syncService = new GoogleDriveSyncService();
    this.authService = new GoogleDriveAuthService();
  }

  // ─── testConnection ──────────────────────────────────────────────────────

  async testConnection(options?: LinkLibraryOptions): Promise<ConnectionTestResult> {
    // Mode 1: OAuth2 token provided (or already stored) → verify by listing 1 file
    const token = options?.apiKey && options.apiKey !== 'xxx'
      ? options.apiKey
      : await this.authService.getValidAccessToken() ?? undefined;
    if (token && token !== 'xxx') {
      try {
        const result = await this.fileService.listFiles(token, { pageSize: 1 });
        return {
          success: true,
          message: `Google Drive connected successfully. Found ${result.entries.length} book file(s) on first page.`,
          itemCount: result.entries.length,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GoogleDriveAdapter] testConnection failed:', err);
        return {
          success: false,
          message: `Google Drive connection failed: ${msg}`,
        };
      }
    }

    // Mode 2: Folder path on disk, and there's a scanner available to read it
    if (options?.folderPath && this.fileScanner) {
      return {
        success: true,
        message: `Connected to local Google Drive folder: ${options.folderPath}`,
      };
    }

    return {
      success: false,
      message: 'Not connected. Sign in with Google Drive, or provide a local synced folder path.',
    };
  }

  // ─── pullCatalog ──────────────────────────────────────────────────────────

  async pullCatalog(
    options?: LinkLibraryOptions,
    query?: string,
  ): Promise<ExternalCatalogEntry[]> {
    // Mode 1: OAuth2 access token (explicit or already stored) → real Drive API call
    const token = options?.apiKey && options.apiKey !== 'xxx'
      ? options.apiKey
      : await this.authService.getValidAccessToken() ?? undefined;
    if (token && token !== 'xxx') {
      const folderId = normalizeGoogleDriveFolderId(options?.folderPath);
      try {
        const result = await this.fileService.listFiles(token, {
          searchTerm: query,
          folderId,
        });
        return result.entries.map(toCatalogEntry);
      } catch (err) {
        console.error(
          '[GoogleDriveAdapter] pullCatalog failed',
          { folderId, query, error: err },
        );
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Google Drive sync failed: ${msg}`);
      }
    }

    // Mode 2: Folder-first — scan local synced directory
    if (options?.folderPath && this.fileScanner) {
      const files = await this.fileScanner.scanDirectory(options.folderPath);
      const results: ExternalCatalogEntry[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop() ?? '';
        if (
          GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS.includes(
            ext.toLowerCase() as (typeof GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS)[number],
          )
        ) {
          const title = file.name.replace(/\.[^/.]+$/, '');
          if (!query || title.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              externalId: `gdrive_local_${encodeURIComponent(file.path)}`,
              sourceProvider: 'google_drive',
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
    }

    throw new Error(
      'Google Drive is not connected. Connect first, or provide a local synced folder path.',
    );
  }

  // ─── runSync (bonus: delta sync via Changes API) ─────────────────────────

  /**
   * Runs a full or incremental sync using the Google Drive Changes API.
   * Returns the new page token to persist for the next sync run.
   *
   * @param accessToken     - Valid Google OAuth2 access token
   * @param changesPageToken - Cursor from previous sync (undefined = first sync)
   * @param folderId         - Scope sync to a specific Drive folder (optional)
   */
  async runSync(
    accessToken: string,
    changesPageToken?: string,
    folderId?: string,
  ) {
    return this.syncService.sync({
      accessToken,
      changesPageToken,
      folderId,
    });
  }
}
