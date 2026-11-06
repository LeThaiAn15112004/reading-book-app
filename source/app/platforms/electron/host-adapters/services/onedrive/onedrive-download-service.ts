import {
  MICROSOFT_GRAPH_API_BASE,
  type OneDriveDownloadResult,
  type OneDriveFileMetadata,
} from './types.js';
import { OneDriveFileService } from './onedrive-file-service.js';
import { readResponseBodyWithProgress, type DownloadProgressListener } from '../download-progress.js';

export interface OneDriveDownloadOptions {
  /**
   * Whether to pre-fetch metadata if not already supplied. Defaults to true.
   */
  fetchMetadata?: boolean;
  /** Called with cumulative bytes received as the binary content streams in. */
  onProgress?: DownloadProgressListener;
}

export class OneDriveTokenExpiredError extends Error {
  readonly code = 'TOKEN_EXPIRED';
  constructor(message: string) {
    super(message);
    this.name = 'OneDriveTokenExpiredError';
  }
}

/**
 * Service for downloading binary book content from Microsoft OneDrive.
 */
export class OneDriveDownloadService {
  private readonly fileService: OneDriveFileService;

  constructor() {
    this.fileService = new OneDriveFileService();
  }

  /**
   * Downloads a file's binary content from OneDrive using Microsoft Graph API.
   *
   * Calls `GET /me/drive/items/{itemId}/content` which follows Microsoft Graph's 302 redirect
   * to the pre-authenticated Azure blob download URL.
   *
   * @param accessToken - Valid Microsoft OAuth2 access token
   * @param itemId      - OneDrive DriveItem ID
   * @param options     - Download options
   * @returns OneDriveDownloadResult with ArrayBuffer, Blob, and text helpers
   */
  async downloadFile(
    accessToken: string,
    itemId: string,
    options?: OneDriveDownloadOptions,
  ): Promise<OneDriveDownloadResult> {
    if (!accessToken?.trim()) {
      throw new Error('OneDriveDownloadService: accessToken is required.');
    }
    if (!itemId?.trim()) {
      throw new Error('OneDriveDownloadService: itemId is required.');
    }

    // 1. Fetch metadata if requested
    let metadata: OneDriveFileMetadata;
    const shouldFetchMetadata = options?.fetchMetadata !== false;
    if (shouldFetchMetadata) {
      try {
        metadata = await this.fileService.getFileMetadata(accessToken, itemId);
      } catch {
        metadata = {
          id: itemId,
          name: 'downloaded-book',
          mimeType: 'application/octet-stream',
          formatHint: 'unknown',
        };
      }
    } else {
      metadata = {
        id: itemId,
        name: 'downloaded-book',
        mimeType: 'application/octet-stream',
        formatHint: 'unknown',
      };
    }

    // 2. Perform download
    const downloadEndpoint = metadata.downloadUrl || `${MICROSOFT_GRAPH_API_BASE}/me/drive/items/${encodeURIComponent(itemId)}/content`;

    const headers: Record<string, string> = {};
    if (!metadata.downloadUrl) {
      // Graph API /content endpoint requires bearer token
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(downloadEndpoint, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new OneDriveTokenExpiredError(
          `Access token expired while downloading file "${metadata.name}" (${itemId}).`,
        );
      }
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `OneDrive Download Error (HTTP ${response.status}) for "${metadata.name}": ${errorText}`,
      );
    }

    const data = await readResponseBodyWithProgress(response, options?.onProgress);
    const capturedData = data;

    return {
      metadata,
      data: capturedData,
      blob: () => new Blob([capturedData], { type: metadata.mimeType }),
      text: () => new TextDecoder('utf-8').decode(capturedData),
    };
  }

  /**
   * Downloads a file from OneDrive and saves it to a local disk path (Node.js / Electron).
   */
  async downloadToFile(
    accessToken: string,
    itemId: string,
    localPath: string,
    onProgress?: DownloadProgressListener,
  ): Promise<OneDriveFileMetadata> {
    if (!localPath?.trim()) {
      throw new Error('OneDriveDownloadService: localPath is required.');
    }

    const result = await this.downloadFile(accessToken, itemId, { onProgress });
    const buffer = Buffer.from(result.data);

    try {
      const { writeFile, mkdir } = await import('fs/promises');
      const { dirname } = await import('path');

      const dir = dirname(localPath);
      await mkdir(dir, { recursive: true });
      await writeFile(localPath, buffer);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error('OneDriveDownloadService.downloadToFile: "fs" is not available in browser runtimes.');
      }
      throw err;
    }

    return result.metadata;
  }

  /**
   * Downloads a file and returns an Object URL for browser viewing or client-side save.
   */
  async downloadToObjectUrl(accessToken: string, itemId: string): Promise<string> {
    const result = await this.downloadFile(accessToken, itemId);
    const blob = result.blob();
    return URL.createObjectURL(blob);
  }
}
