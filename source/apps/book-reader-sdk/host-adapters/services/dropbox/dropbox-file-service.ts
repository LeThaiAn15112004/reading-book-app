import {
  DROPBOX_API_BASE,
  SUPPORTED_BOOK_EXTENSIONS,
  type DropboxFileMetadata,
  type DropboxListFolderOptions,
  type DropboxListFolderResult,
  type DropboxMetadataEntry,
} from './types.js';

/**
 * Normalizes Dropbox folder path.
 * Dropbox expects "" (empty string) for root, and paths should start with "/" and not end with "/".
 */
export function normalizeDropboxPath(path?: string): string {
  if (!path || path.trim() === '' || path.trim() === '/') {
    return '';
  }
  let clean = path.trim();
  if (!clean.startsWith('/')) {
    clean = `/${clean}`;
  }
  if (clean.endsWith('/') && clean.length > 1) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

/**
 * Helper to detect book format extension from filename.
 */
export function detectDropboxBookFormat(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length <= 1) return 'unknown';
  return parts.pop()?.toLowerCase() ?? 'unknown';
}

/**
 * Helper to check if a file name matches supported reading formats.
 */
export function isDropboxBookFile(
  fileName: string,
  allowedExtensions: readonly string[] = SUPPORTED_BOOK_EXTENSIONS,
): boolean {
  const ext = detectDropboxBookFormat(fileName);
  return allowedExtensions.includes(ext);
}

/**
 * Service for querying and browsing files in Dropbox folders.
 */
export class DropboxFileService {
  /**
   * List files in a Dropbox folder, filtered for supported book formats.
   *
   * @param accessToken Valid Dropbox OAuth 2.0 access token
   * @param options Filter, recursion, pagination and folder path options
   * @returns DropboxListFolderResult containing filtered book files, latest cursor, and raw entries
   */
  async listFiles(
    accessToken: string,
    options?: DropboxListFolderOptions,
  ): Promise<DropboxListFolderResult> {
    if (!accessToken || !accessToken.trim()) {
      throw new Error('Dropbox Error: Access token is missing or invalid.');
    }

    const path = normalizeDropboxPath(options?.path);
    const recursive = options?.recursive ?? true;
    const includeDeleted = options?.includeDeleted ?? false;
    const allowedExtensions = options?.allowedExtensions ?? SUPPORTED_BOOK_EXTENSIONS;
    const limit = options?.limit;

    const bodyPayload: Record<string, unknown> = {
      path,
      recursive,
      include_deleted: includeDeleted,
      include_has_explicit_shared_members: false,
    };
    if (limit) {
      bodyPayload.limit = limit;
    }

    const filteredBooks: DropboxFileMetadata[] = [];
    const allRawEntries: DropboxMetadataEntry[] = [];
    let currentCursor = '';
    let hasMore = false;

    try {
      // 1. Initial list_folder call
      const response = await fetch(`${DROPBOX_API_BASE}/files/list_folder`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Dropbox list_folder failed (HTTP ${response.status}): ${errorText}`,
        );
      }

      const data = (await response.json()) as {
        entries: DropboxMetadataEntry[];
        cursor: string;
        has_more: boolean;
      };

      currentCursor = data.cursor;
      hasMore = data.has_more;
      allRawEntries.push(...data.entries);

      for (const entry of data.entries) {
        if (entry['.tag'] === 'file') {
          const format = detectDropboxBookFormat(entry.name);
          if (allowedExtensions.includes(format)) {
            filteredBooks.push({
              ...entry,
              formatHint: format,
            });
          }
        }
      }

      // 2. Fetch subsequent pages if hasMore is true and limit wasn't explicitly set to 1 page
      while (hasMore && !limit) {
        const continueResp = await fetch(
          `${DROPBOX_API_BASE}/files/list_folder/continue`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken.trim()}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cursor: currentCursor }),
          },
        );

        if (!continueResp.ok) {
          break;
        }

        const continueData = (await continueResp.json()) as {
          entries: DropboxMetadataEntry[];
          cursor: string;
          has_more: boolean;
        };

        currentCursor = continueData.cursor;
        hasMore = continueData.has_more;
        allRawEntries.push(...continueData.entries);

        for (const entry of continueData.entries) {
          if (entry['.tag'] === 'file') {
            const format = detectDropboxBookFormat(entry.name);
            if (allowedExtensions.includes(format)) {
              filteredBooks.push({
                ...entry,
                formatHint: format,
              });
            }
          }
        }
      }

      return {
        entries: filteredBooks,
        cursor: currentCursor,
        hasMore,
        rawEntries: allRawEntries,
      };
    } catch (error) {
      console.error('Dropbox File Listing Error:', error);
      throw error;
    }
  }

  /**
   * Get metadata for a specific file or folder in Dropbox.
   */
  async getFileMetadata(
    accessToken: string,
    pathOrId: string,
  ): Promise<DropboxFileMetadata> {
    if (!accessToken) throw new Error('Dropbox Error: Access token is missing.');

    const response = await fetch(`${DROPBOX_API_BASE}/files/get_metadata`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: pathOrId,
        include_media_info: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dropbox get_metadata failed: ${errorText}`);
    }

    const data = (await response.json()) as DropboxMetadataEntry;
    if (data['.tag'] !== 'file') {
      throw new Error(`Target path "${pathOrId}" is not a file.`);
    }

    return {
      ...data,
      formatHint: detectDropboxBookFormat(data.name),
    };
  }

  /**
   * Get a temporary direct download/streaming link for a file.
   * Useful for web previews or streaming without full download.
   */
  async getTemporaryLink(
    accessToken: string,
    pathOrId: string,
  ): Promise<{ link: string; metadata: DropboxFileMetadata }> {
    if (!accessToken) throw new Error('Dropbox Error: Access token is missing.');

    const response = await fetch(`${DROPBOX_API_BASE}/files/get_temporary_link`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: pathOrId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dropbox get_temporary_link failed: ${errorText}`);
    }

    const data = (await response.json()) as {
      link: string;
      metadata: DropboxFileMetadata;
    };

    return {
      link: data.link,
      metadata: {
        ...data.metadata,
        formatHint: detectDropboxBookFormat(data.metadata.name),
      },
    };
  }

  /**
   * Search for files matching a query string across Dropbox.
   */
  async searchFiles(
    accessToken: string,
    query: string,
    options?: { path?: string; maxResults?: number },
  ): Promise<DropboxFileMetadata[]> {
    if (!accessToken) throw new Error('Dropbox Error: Access token is missing.');
    if (!query || !query.trim()) return [];

    const response = await fetch(`${DROPBOX_API_BASE}/files/search_v2`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: query.trim(),
        options: {
          path: normalizeDropboxPath(options?.path),
          max_results: options?.maxResults ?? 50,
          file_status: 'active',
          filename_only: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dropbox search_v2 failed: ${errorText}`);
    }

    const data = (await response.json()) as {
      matches: Array<{
        metadata: {
          metadata: DropboxMetadataEntry;
        };
      }>;
    };

    const results: DropboxFileMetadata[] = [];
    for (const match of data.matches || []) {
      const entry = match.metadata?.metadata;
      if (entry && entry['.tag'] === 'file') {
        const format = detectDropboxBookFormat(entry.name);
        if (SUPPORTED_BOOK_EXTENSIONS.includes(format as any)) {
          results.push({
            ...entry,
            formatHint: format,
          });
        }
      }
    }

    return results;
  }
}
