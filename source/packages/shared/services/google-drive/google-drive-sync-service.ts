import {
  GOOGLE_DRIVE_API_BASE,
  GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS,
  type GoogleDriveFileChange,
  type GoogleDriveFileMetadata,
  type GoogleDriveSyncOptions,
  type GoogleDriveSyncResult,
} from './types.js';
import { GoogleDriveFileService, isSupportedBookFile } from './google-drive-file-service.js';

// ─── Google Drive Changes API response shapes ───────────────────────────────

interface DriveChangeItem {
  kind?: string;
  type?: string;
  time?: string;
  removed?: boolean;
  fileId?: string;
  file?: {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string | number;
    modifiedTime?: string;
    createdTime?: string;
    thumbnailLink?: string;
    webViewLink?: string;
    webContentLink?: string;
    parents?: string[];
    trashed?: boolean;
  };
}

interface DriveChangesListResponse {
  changes?: DriveChangeItem[];
  nextPageToken?: string;
  newStartPageToken?: string;
}

interface DriveStartPageTokenResponse {
  startPageToken?: string;
}

// ─── Execution options ──────────────────────────────────────────────────────

export interface GoogleDriveSyncExecutionOptions extends GoogleDriveSyncOptions {
  /** OAuth2 access token — required */
  accessToken: string;
  /**
   * Called for each detected change as it's discovered.
   * Useful for streaming UI progress updates.
   */
  onChangeDetected?: (change: GoogleDriveFileChange) => void;
}

/**
 * Google Drive delta synchronisation service using the **Changes API**.
 *
 * Architecture:
 * - First run (no `changesPageToken`):
 *   1. Obtain a `startPageToken` from `GET /drive/v3/changes/startPageToken`.
 *   2. Do a full `listAllFiles` pass to discover the initial corpus.
 *   3. Classify every file as `added`.
 *   4. Return the new `startPageToken` as `nextPageToken` for subsequent runs.
 *
 * - Subsequent runs (`changesPageToken` provided):
 *   1. Call `GET /drive/v3/changes` with the stored page token.
 *   2. Classify each change as `added`, `modified`, or `deleted`.
 *   3. Return the new `newStartPageToken` for the next sync.
 *
 * This approach minimises API quota usage — only changed files are inspected
 * after the first sync pass.
 */
export class GoogleDriveSyncService {
  private readonly fileService: GoogleDriveFileService;

  constructor() {
    this.fileService = new GoogleDriveFileService();
  }

  // ─── Changes API helpers ──────────────────────────────────────────────────

  /**
   * Obtains a baseline page token representing the current state of the user's Drive.
   * Must be called before the first sync to establish a starting point.
   *
   * `GET /drive/v3/changes/startPageToken`
   */
  async getStartPageToken(accessToken: string): Promise<string> {
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/changes/startPageToken`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as {
        error?: { message?: string };
      };
      throw new Error(
        errData.error?.message ??
          `Drive Changes API Error (HTTP ${response.status}: ${response.statusText})`,
      );
    }

    const data = (await response.json()) as DriveStartPageTokenResponse;
    if (!data.startPageToken) {
      throw new Error('Drive Changes API: startPageToken missing in response.');
    }

    return data.startPageToken;
  }

  /**
   * Fetches the next batch of changes from the Drive Changes API.
   *
   * `GET /drive/v3/changes?pageToken=...`
   *
   * @returns Raw changes response including `nextPageToken` or `newStartPageToken`
   */
  async fetchChanges(
    accessToken: string,
    pageToken: string,
  ): Promise<DriveChangesListResponse> {
    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/changes`);
    url.searchParams.set('pageToken', pageToken);
    url.searchParams.set('fields',
      'nextPageToken,newStartPageToken,changes(kind,type,time,removed,fileId,file(id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,webViewLink,webContentLink,parents,trashed))',
    );
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('includeRemoved', 'true');
    url.searchParams.set('pageSize', '1000');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw Object.assign(
          new Error('TokenExpired: Access token expired during Changes API fetch.'),
          { code: 'TOKEN_EXPIRED' },
        );
      }
      const errData = await response.json().catch(() => ({})) as {
        error?: { message?: string };
      };
      throw new Error(
        errData.error?.message ??
          `Drive Changes API Error (HTTP ${response.status}: ${response.statusText})`,
      );
    }

    return (await response.json()) as DriveChangesListResponse;
  }

  // ─── Main sync entry point ────────────────────────────────────────────────

  /**
   * Runs a full or incremental sync pass.
   *
   * - **First sync** (no `changesPageToken`): Does a complete Drive scan, returns
   *   all matching files as `added` changes, and a new `nextPageToken`.
   * - **Incremental sync**: Fetches only changes since the last token,
   *   classifies them, and returns the updated `nextPageToken`.
   *
   * @param options - Execution options including access token and optional cursor
   * @returns        Sync result with change list and next page token
   */
  async sync(options: GoogleDriveSyncExecutionOptions): Promise<GoogleDriveSyncResult> {
    const {
      accessToken,
      changesPageToken,
      folderId,
      allowedExtensions = GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS,
      localFiles = [],
      onChangeDetected,
    } = options;

    const changes: GoogleDriveFileChange[] = [];
    let addedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let nextPageToken: string;

    if (!changesPageToken) {
      // ── FIRST SYNC: full listing pass ─────────────────────────────────────
      nextPageToken = await this.getStartPageToken(accessToken);

      const allFiles = await this.fileService.listAllFiles(accessToken, {
        folderId,
        allowedExtensions,
      });

      for (const file of allFiles) {
        const change: GoogleDriveFileChange = {
          type: 'added',
          fileId: file.id,
          name: file.name,
          formatHint: file.formatHint,
          file,
        };
        changes.push(change);
        addedCount++;
        onChangeDetected?.(change);
      }
    } else {
      // ── INCREMENTAL SYNC: Changes API delta ───────────────────────────────
      // Build a quick lookup map from local files for modifiedTime comparison
      const localMap = new Map<string, string>();
      for (const lf of localFiles) {
        if (lf.id && lf.modifiedTime) {
          localMap.set(lf.id, lf.modifiedTime);
        }
      }

      let cursor: string = changesPageToken;
      let newStartPageToken: string | undefined;

      // Paginate through all changes since the last token
      do {
        const result = await this.fetchChanges(accessToken, cursor);

        for (const rawChange of result.changes ?? []) {
          // Only process file-type changes (not Drive-level metadata changes)
          if (rawChange.type !== 'file' && rawChange.kind !== 'drive#change') continue;

          const fileId = rawChange.fileId ?? rawChange.file?.id ?? '';
          if (!fileId) continue;

          // Deleted or trashed file
          if (rawChange.removed || rawChange.file?.trashed) {
            const change: GoogleDriveFileChange = {
              type: 'deleted',
              fileId,
              name: rawChange.file?.name ?? 'Unknown File',
              formatHint: undefined,
            };
            changes.push(change);
            deletedCount++;
            onChangeDetected?.(change);
            continue;
          }

          // Live file — check if it's a supported book format
          const file = rawChange.file;
          if (!file?.name || !file?.mimeType) continue;

          if (!isSupportedBookFile(file.name, file.mimeType, allowedExtensions)) continue;

          const fileMeta: GoogleDriveFileMetadata = {
            id: file.id ?? fileId,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size !== undefined ? Number(file.size) : undefined,
            modifiedTime: file.modifiedTime,
            createdTime: file.createdTime,
            thumbnailLink: file.thumbnailLink,
            webViewLink: file.webViewLink,
            webContentLink: file.webContentLink,
            parents: file.parents,
            trashed: file.trashed,
          };

          // Determine added vs modified using local map
          const prevModifiedTime = localMap.get(fileId);
          const changeType: 'added' | 'modified' = prevModifiedTime
            ? 'modified'
            : 'added';

          const change: GoogleDriveFileChange = {
            type: changeType,
            fileId,
            name: file.name,
            formatHint: rawChange.file?.mimeType
              ? undefined
              : undefined,
            file: fileMeta,
          };
          changes.push(change);
          if (changeType === 'added') addedCount++;
          else modifiedCount++;
          onChangeDetected?.(change);
        }

        // Advance the cursor
        if (result.newStartPageToken) {
          newStartPageToken = result.newStartPageToken;
          break; // No more pages; newStartPageToken signals the end
        }
        cursor = result.nextPageToken ?? cursor;

        // Safety: stop if we get an empty response with no continuation token
        if (!result.nextPageToken && !result.newStartPageToken) break;
      } while (true);

      nextPageToken = newStartPageToken ?? cursor;
    }

    return {
      nextPageToken,
      changes,
      addedCount,
      modifiedCount,
      deletedCount,
      totalProcessed: changes.length,
    };
  }
}
