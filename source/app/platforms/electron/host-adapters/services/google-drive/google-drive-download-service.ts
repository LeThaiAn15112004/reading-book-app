import { GOOGLE_DRIVE_API_BASE, type GoogleDriveDownloadResult, type GoogleDriveFileMetadata } from './types.js';
import { GoogleDriveFileService, detectBookFormat } from './google-drive-file-service.js';
import { readResponseBodyWithProgress, type DownloadProgressListener } from '../download-progress.js';

export interface GoogleDriveDownloadOptions {
  /**
   * Optional: include fetched metadata in the result.
   * If set to false, metadata is fetched separately; defaults to true.
   */
  fetchMetadata?: boolean;
  /** Called with cumulative bytes received as the binary content streams in. */
  onProgress?: DownloadProgressListener;
}

/**
 * Error thrown when the access token is expired or invalid during download.
 * Callers should catch this and refresh the token, then retry.
 */
export class GoogleDriveTokenExpiredError extends Error {
  readonly code = 'TOKEN_EXPIRED';
  constructor(message: string) {
    super(message);
    this.name = 'GoogleDriveTokenExpiredError';
  }
}

/**
 * Handles Google Drive file download operations.
 *
 * Uses the Drive v3 `files.get?alt=media` endpoint to download the raw binary
 * content of a file, then returns it as an ArrayBuffer along with metadata.
 */
export class GoogleDriveDownloadService {
  private readonly fileService: GoogleDriveFileService;

  constructor() {
    this.fileService = new GoogleDriveFileService();
  }

  /**
   * Downloads a file's binary content from Google Drive.
   *
   * - Fetches file metadata first (for name, size, modifiedTime, etc.)
   * - Downloads binary content via `GET /drive/v3/files/{fileId}?alt=media`
   * - Returns a `GoogleDriveDownloadResult` with `data` (ArrayBuffer), `blob()`, `text()` helpers
   *
   * @param accessToken - Valid Google OAuth2 access token
   * @param fileId      - Google Drive file ID
   * @param options     - Download options
   *
   * @throws {GoogleDriveTokenExpiredError} on HTTP 401
   * @throws {Error} on other HTTP errors
   */
  async downloadFile(
    accessToken: string,
    fileId: string,
    options?: GoogleDriveDownloadOptions,
  ): Promise<GoogleDriveDownloadResult> {
    if (!accessToken?.trim()) {
      throw new Error('GoogleDriveDownloadService: accessToken is required.');
    }
    if (!fileId?.trim()) {
      throw new Error('GoogleDriveDownloadService: fileId is required.');
    }

    // 1. Fetch file metadata (unless caller explicitly skips it)
    let metadata: GoogleDriveFileMetadata;
    const shouldFetchMetadata = options?.fetchMetadata !== false;
    if (shouldFetchMetadata) {
      metadata = await this.fileService.getFileMetadata(accessToken, fileId);
    } else {
      metadata = {
        id: fileId,
        name: 'unknown',
        mimeType: 'application/octet-stream',
        formatHint: 'unknown',
      };
    }

    // 2. Download binary content
    const downloadUrl = new URL(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`);
    downloadUrl.searchParams.set('alt', 'media');

    const response = await fetch(downloadUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new GoogleDriveTokenExpiredError(
          `Access token expired while downloading file "${metadata.name}" (${fileId}).`,
        );
      }

      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Google Drive Download Error (HTTP ${response.status}) for file "${metadata.name}": ${errorText}`,
      );
    }

    const data = await readResponseBodyWithProgress(response, options?.onProgress);
    const capturedData = data;

    // 3. Return result with convenience helper methods
    const result: GoogleDriveDownloadResult = {
      metadata,
      data: capturedData,
      blob: () => new Blob([capturedData], { type: metadata.mimeType }),
      text: () => new TextDecoder('utf-8').decode(capturedData),
    };

    return result;
  }

  /**
   * Downloads a file from Google Drive and writes it to a local file path.
   *
   * Intended for use in Node.js / Electron main process where `fs` is available.
   * In browser-only environments this method throws a `NotSupportedError`.
   *
   * @param accessToken - Valid Google OAuth2 access token
   * @param fileId      - Google Drive file ID
   * @param localPath   - Absolute local path to write the file to
   * @returns Metadata of the downloaded file
   */
  async downloadToFile(
    accessToken: string,
    fileId: string,
    localPath: string,
    onProgress?: DownloadProgressListener,
  ): Promise<GoogleDriveFileMetadata> {
    if (!localPath?.trim()) {
      throw new Error('GoogleDriveDownloadService: localPath is required.');
    }

    const result = await this.downloadFile(accessToken, fileId, { onProgress });
    const buffer = Buffer.from(result.data);

    // Dynamic import so the module doesn't break in browser builds
    try {
      const { writeFile, mkdir } = await import('fs/promises');
      const { dirname } = await import('path');

      const dir = dirname(localPath);
      await mkdir(dir, { recursive: true });
      await writeFile(localPath, buffer);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          'GoogleDriveDownloadService.downloadToFile: Node.js "fs" module is not available in this environment.',
        );
      }
      throw err;
    }

    return result.metadata;
  }

  /**
   * Downloads a file and returns it as a URL that can be assigned to an <a> or
   * used for a programmatic download in the browser.
   *
   * @param accessToken - Valid Google OAuth2 access token
   * @param fileId      - Google Drive file ID
   * @returns Object URL (browser) – caller is responsible for calling `URL.revokeObjectURL()` when done.
   */
  async downloadToObjectUrl(accessToken: string, fileId: string): Promise<string> {
    const result = await this.downloadFile(accessToken, fileId);
    const blob = result.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Infers file metadata from a downloaded result's binary content, useful when
   * metadata was not pre-fetched.
   */
  static inferMetadataFromFilename(filename: string): Partial<GoogleDriveFileMetadata> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = ext === 'epub'
      ? 'application/epub+zip'
      : ext === 'pdf'
        ? 'application/pdf'
        : 'application/octet-stream';

    return {
      name: filename,
      mimeType,
      formatHint: detectBookFormat(filename, mimeType),
    };
  }
}
