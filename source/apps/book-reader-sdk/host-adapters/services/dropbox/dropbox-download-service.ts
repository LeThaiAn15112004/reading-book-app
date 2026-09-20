import {
  DROPBOX_CONTENT_BASE,
  type DropboxDownloadResult,
  type DropboxFileMetadata,
} from './types.js';
import { detectDropboxBookFormat } from './dropbox-file-service.js';
import { readResponseBodyWithProgress, type DownloadProgressListener } from '../download-progress.js';

/** Download-progress options for {@link DropboxDownloadService.downloadFile}. */
interface DropboxDownloadProgressOptions {
  /** Called with cumulative bytes received as the binary content streams in. */
  onProgress?: DownloadProgressListener;
}

export class DropboxDownloadService {
  /**
   * Downloads a file from Dropbox content API.
   *
   * @param accessToken Valid Dropbox OAuth 2.0 access token
   * @param pathOrId The path (e.g. '/books/story.epub') or ID ('id:...') of the file
   * @param options Download options (progress reporting)
   * @returns DropboxDownloadResult containing raw ArrayBuffer and parsed Dropbox metadata
   */
  async downloadFile(
    accessToken: string,
    pathOrId: string,
    options?: DropboxDownloadProgressOptions,
  ): Promise<DropboxDownloadResult> {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Dropbox Download Error: Access token is missing.');
    }
    if (!pathOrId || !pathOrId.trim()) {
      throw new Error('Dropbox Download Error: File path or ID is required.');
    }

    const response = await fetch(`${DROPBOX_CONTENT_BASE}/files/download`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Dropbox-API-Arg': JSON.stringify({ path: pathOrId.trim() }),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Dropbox download failed (HTTP ${response.status}): ${errorText}`,
      );
    }

    // Extract metadata from Dropbox-API-Result header
    const resultHeader = response.headers.get('Dropbox-API-Result') || '{}';
    let metadata: DropboxFileMetadata;
    try {
      const parsed = JSON.parse(resultHeader) as DropboxFileMetadata;
      metadata = {
        ...parsed,
        formatHint: detectDropboxBookFormat(parsed.name || pathOrId),
      };
    } catch {
      metadata = {
        '.tag': 'file',
        id: pathOrId,
        name: pathOrId.split('/').pop() || 'book',
        path_lower: pathOrId.toLowerCase(),
        path_display: pathOrId,
        size: Number(response.headers.get('Content-Length') || 0),
        server_modified: new Date().toISOString(),
        client_modified: new Date().toISOString(),
        rev: 'unknown',
        formatHint: detectDropboxBookFormat(pathOrId),
      };
    }

    const arrayBuffer = await readResponseBodyWithProgress(response, options?.onProgress);

    return {
      metadata,
      data: arrayBuffer,
      blob: () => new Blob([arrayBuffer]),
      text: () => new TextDecoder().decode(arrayBuffer),
    };
  }

  /**
   * Downloads a file from Dropbox and saves it directly to a local filesystem path.
   * Works in Node.js / Electron desktop environment.
   *
   * @param accessToken Valid Dropbox access token
   * @param remotePathOrId Remote Dropbox path or ID
   * @param localDestinationPath Destination file path on local storage
   */
  async downloadToFile(
    accessToken: string,
    remotePathOrId: string,
    localDestinationPath: string,
    onProgress?: DownloadProgressListener,
  ): Promise<{ localPath: string; metadata: DropboxFileMetadata }> {
    const downloaded = await this.downloadFile(accessToken, remotePathOrId, { onProgress });

    // If running in Node.js / Electron, use fs.promises
    if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const { writeFile, mkdir } = await import('node:fs/promises');
        const { dirname } = await import('node:path');

        // Ensure parent directory exists
        await mkdir(dirname(localDestinationPath), { recursive: true });
        const buffer = Buffer.from(downloaded.data);
        await writeFile(localDestinationPath, buffer);

        return {
          localPath: localDestinationPath,
          metadata: downloaded.metadata,
        };
      } catch (fsErr) {
        console.warn('Node fs write failed, attempting standard response:', fsErr);
        throw fsErr;
      }
    }

    throw new Error(
      'downloadToFile is only supported in desktop/Node.js runtime. In browser, use downloadFile() or blob().',
    );
  }

  /**
   * Helper to download directly as a browser Blob (e.g. for ePub reader rendering).
   */
  async downloadAsBlob(accessToken: string, pathOrId: string): Promise<Blob> {
    const result = await this.downloadFile(accessToken, pathOrId);
    return new Blob([result.data]);
  }
}
