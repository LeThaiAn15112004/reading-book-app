import {
  MICROSOFT_GRAPH_API_BASE,
  ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS,
  type GraphDriveItem,
  type OneDriveFileChange,
  type OneDriveFileMetadata,
  type OneDriveSyncOptions,
  type OneDriveSyncResult,
} from './types.js';
import {
  OneDriveFileService,
  detectOneDriveBookFormat,
  isSupportedOneDriveBookFile,
} from './onedrive-file-service.js';

interface GraphDeltaResponse {
  value?: GraphDriveItem[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface OneDriveSyncExecutionOptions extends OneDriveSyncOptions {
  /** OAuth2 access token — required */
  accessToken: string;
  /** Callback fired as each change is detected (for UI streaming progress) */
  onChangeDetected?: (change: OneDriveFileChange) => void;
}

/**
 * Service managing incremental delta synchronization for Microsoft OneDrive
 * using the Microsoft Graph Delta Query API (`/me/drive/root/delta`).
 */
export class OneDriveSyncService {

  /**
   * Fetches a batch of delta changes from Microsoft Graph.
   */
  async fetchDeltaPage(
    accessToken: string,
    deltaLinkOrToken?: string,
  ): Promise<GraphDeltaResponse> {
    let url: string;

    if (deltaLinkOrToken?.startsWith('http')) {
      url = deltaLinkOrToken;
    } else if (deltaLinkOrToken) {
      url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/root/delta?token=${encodeURIComponent(deltaLinkOrToken)}&$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,deleted,@microsoft.graph.downloadUrl`;
    } else {
      url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/root/delta?$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,deleted,@microsoft.graph.downloadUrl`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw Object.assign(
          new Error('TokenExpired: Access token expired during OneDrive delta fetch.'),
          { code: 'TOKEN_EXPIRED' },
        );
      }
      const errData = await response.json().catch(() => ({})) as {
        error?: { message?: string };
      };
      throw new Error(errData.error?.message || `OneDrive Delta API Error (HTTP ${response.status})`);
    }

    return (await response.json()) as GraphDeltaResponse;
  }

  /**
   * Executes a complete or incremental sync pass with Microsoft OneDrive.
   */
  async sync(options: OneDriveSyncExecutionOptions): Promise<OneDriveSyncResult> {
    const {
      accessToken,
      deltaLinkOrToken,
      allowedExtensions = ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS,
      localFiles = [],
      onChangeDetected,
    } = options;

    const changes: OneDriveFileChange[] = [];
    let addedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let nextDeltaLink = '';

    // Build lookup map for local files (id -> modifiedTime)
    const localMap = new Map<string, string>();
    for (const lf of localFiles) {
      if (lf.id && lf.modifiedTime) {
        localMap.set(lf.id, lf.modifiedTime);
      }
    }

    let currentUrl: string | undefined = deltaLinkOrToken;

    // Traverse all delta pages until @odata.deltaLink is returned
    do {
      const deltaData = await this.fetchDeltaPage(accessToken, currentUrl);
      const items = deltaData.value ?? [];

      for (const item of items) {
        // Skip folders in change output
        if (item.folder) continue;

        const fileId = item.id;
        const name = item.name || 'Untitled';
        const isDeleted = Boolean(item.deleted);

        // 1. Deleted file
        if (isDeleted) {
          const change: OneDriveFileChange = {
            type: 'deleted',
            fileId,
            name,
          };
          changes.push(change);
          deletedCount++;
          onChangeDetected?.(change);
          continue;
        }

        // 2. Check if file is a supported book format
        const mimeType = item.file?.mimeType;
        if (!isSupportedOneDriveBookFile(name, mimeType, allowedExtensions)) {
          continue;
        }

        const formatHint = detectOneDriveBookFormat(name, mimeType);
        const metadata: OneDriveFileMetadata = OneDriveFileService.toFileMetadata(item);

        const prevModifiedTime = localMap.get(fileId);
        const changeType = prevModifiedTime ? 'modified' : 'added';

        const change: OneDriveFileChange = {
          type: changeType,
          fileId,
          name,
          formatHint,
          file: metadata,
        };

        changes.push(change);
        if (changeType === 'added') {
          addedCount++;
        } else {
          modifiedCount++;
        }
        onChangeDetected?.(change);
      }

      if (deltaData['@odata.deltaLink']) {
        nextDeltaLink = deltaData['@odata.deltaLink'];
        break;
      }

      currentUrl = deltaData['@odata.nextLink'];
    } while (currentUrl);

    // If no delta link was returned, fallback to full file listing nextDeltaLink
    if (!nextDeltaLink) {
      nextDeltaLink = `${MICROSOFT_GRAPH_API_BASE}/me/drive/root/delta`;
    }

    return {
      nextDeltaLink,
      changes,
      addedCount,
      modifiedCount,
      deletedCount,
      totalProcessed: changes.length,
    };
  }
}
