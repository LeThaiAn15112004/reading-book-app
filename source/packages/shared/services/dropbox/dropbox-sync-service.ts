import {
  DROPBOX_API_BASE,
  SUPPORTED_BOOK_EXTENSIONS,
  type DropboxFileChange,
  type DropboxFileMetadata,
  type DropboxMetadataEntry,
  type DropboxSyncOptions,
  type DropboxSyncResult,
} from './types.js';
import {
  detectDropboxBookFormat,
  normalizeDropboxPath,
} from './dropbox-file-service.js';

export interface SyncExecutionOptions extends DropboxSyncOptions {
  accessToken: string;
  /** Optional callback invoked for each detected change */
  onChangeDetected?: (change: DropboxFileChange) => Promise<void> | void;
}

/**
 * Service providing cursor-based delta sync and timestamp-based synchronization for Dropbox.
 */
export class DropboxSyncService {
  /**
   * Performs delta synchronization against Dropbox.
   * - If cursor is not provided, performs full catalog discovery and establishes baseline cursor.
   * - If cursor is provided, fetches only changed/added/deleted files since last cursor.
   *
   * @param options Sync options including accessToken, folderPath, previous cursor, local file catalog
   * @returns DropboxSyncResult with new cursor, change list, and summary counts.
   */
  async sync(options: SyncExecutionOptions): Promise<DropboxSyncResult> {
    const {
      accessToken,
      folderPath,
      cursor,
      allowedExtensions = SUPPORTED_BOOK_EXTENSIONS,
      localFiles = [],
      onChangeDetected,
    } = options;

    if (!accessToken || !accessToken.trim()) {
      throw new Error('Dropbox Sync Error: Access token is missing.');
    }

    const changes: DropboxFileChange[] = [];
    const localMap = new Map<string, { path: string; modifiedTime?: string; size?: number }>();
    for (const f of localFiles) {
      localMap.set(f.path.toLowerCase(), f);
      // Also map basename for loose matching
      const baseName = f.path.split(/[/\\\\]/).pop()?.toLowerCase();
      if (baseName) {
        localMap.set(baseName, f);
      }
    }

    let latestCursor = cursor || '';
    let hasMore = false;

    try {
      if (!cursor) {
        // === INITIAL SYNC: Full directory scan to establish cursor & detect new files ===
        const normalizedPath = normalizeDropboxPath(folderPath);
        const response = await fetch(`${DROPBOX_API_BASE}/files/list_folder`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path: normalizedPath,
            recursive: true,
            include_deleted: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Dropbox initial sync failed (HTTP ${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as {
          entries: DropboxMetadataEntry[];
          cursor: string;
          has_more: boolean;
        };

        latestCursor = data.cursor;
        hasMore = data.has_more;

        await this.processEntries(
          data.entries,
          allowedExtensions,
          localMap,
          changes,
          onChangeDetected,
        );

        // Fetch remaining pages if any
        while (hasMore) {
          const contResp = await fetch(
            `${DROPBOX_API_BASE}/files/list_folder/continue`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken.trim()}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ cursor: latestCursor }),
            },
          );

          if (!contResp.ok) break;

          const contData = (await contResp.json()) as {
            entries: DropboxMetadataEntry[];
            cursor: string;
            has_more: boolean;
          };

          latestCursor = contData.cursor;
          hasMore = contData.has_more;

          await this.processEntries(
            contData.entries,
            allowedExtensions,
            localMap,
            changes,
            onChangeDetected,
          );
        }
      } else {
        // === DELTA SYNC: Continue from previous cursor ===
        let currentCursor = cursor;
        hasMore = true;

        while (hasMore) {
          const response = await fetch(
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

          if (!response.ok) {
            const errorText = await response.text();
            // Handle cursor expiration / reset (e.g. 409 reset)
            if (response.status === 409) {
              console.warn('Dropbox cursor expired or invalid. Re-running full sync.');
              return this.sync({ ...options, cursor: undefined });
            }
            throw new Error(
              `Dropbox delta sync failed (HTTP ${response.status}): ${errorText}`,
            );
          }

          const data = (await response.json()) as {
            entries: DropboxMetadataEntry[];
            cursor: string;
            has_more: boolean;
          };

          currentCursor = data.cursor;
          latestCursor = data.cursor;
          hasMore = data.has_more;

          await this.processEntries(
            data.entries,
            allowedExtensions,
            localMap,
            changes,
            onChangeDetected,
          );
        }
      }

      let addedCount = 0;
      let modifiedCount = 0;
      let deletedCount = 0;

      for (const ch of changes) {
        if (ch.type === 'added') addedCount++;
        else if (ch.type === 'modified') modifiedCount++;
        else if (ch.type === 'deleted') deletedCount++;
      }

      return {
        cursor: latestCursor,
        changes,
        addedCount,
        modifiedCount,
        deletedCount,
        totalProcessed: changes.length,
      };
    } catch (err) {
      console.error('Dropbox Sync Error:', err);
      throw err;
    }
  }

  /**
   * Internal helper to process a batch of entries and determine added/modified/deleted status.
   */
  private async processEntries(
    entries: DropboxMetadataEntry[],
    allowedExtensions: readonly string[],
    localMap: Map<string, { path: string; modifiedTime?: string; size?: number }>,
    changes: DropboxFileChange[],
    onChangeDetected?: (change: DropboxFileChange) => Promise<void> | void,
  ): Promise<void> {
    for (const entry of entries) {
      const tag = entry['.tag'];

      if (tag === 'deleted') {
        const path = entry.path_display || entry.path_lower || entry.name;
        const format = detectDropboxBookFormat(entry.name);
        if (allowedExtensions.includes(format)) {
          const change: DropboxFileChange = {
            type: 'deleted',
            path,
            name: entry.name,
            formatHint: format,
          };
          changes.push(change);
          if (onChangeDetected) {
            await onChangeDetected(change);
          }
        }
        continue;
      }

      if (tag === 'file') {
        const file = entry as DropboxFileMetadata;
        const format = detectDropboxBookFormat(file.name);

        // Only process supported book formats
        if (!allowedExtensions.includes(format)) {
          continue;
        }

        const enrichedFile: DropboxFileMetadata = {
          ...file,
          formatHint: format,
        };

        const keyByPath = (file.path_lower || '').toLowerCase();
        const keyByName = file.name.toLowerCase();
        const localMatch = localMap.get(keyByPath) || localMap.get(keyByName);

        let changeType: 'added' | 'modified' = 'added';

        if (localMatch) {
          // Compare modification timestamps if available
          if (localMatch.modifiedTime && file.server_modified) {
            const localTime = new Date(localMatch.modifiedTime).getTime();
            const remoteTime = new Date(file.server_modified).getTime();
            // Remote is newer by more than 1 second
            if (remoteTime - localTime > 1000) {
              changeType = 'modified';
            } else {
              // Same or older, already up to date
              continue;
            }
          } else {
            changeType = 'modified';
          }
        }

        const change: DropboxFileChange = {
          type: changeType,
          path: file.path_display || file.path_lower,
          name: file.name,
          formatHint: format,
          file: enrichedFile,
        };

        changes.push(change);
        if (onChangeDetected) {
          await onChangeDetected(change);
        }
      }
    }
  }
}
