import {
  MICROSOFT_GRAPH_API_BASE,
  ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS,
  type GraphDriveItem,
  type OneDriveFileMetadata,
  type OneDriveFolderMetadata,
  type OneDriveListFilesOptions,
  type OneDriveListFilesResult,
} from './types.js';

// ─── MIME Type → Normalized Book Format ─────────────────────────────────────

const MIME_TO_FORMAT: Record<string, string> = {
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'azw3',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/x-fb2': 'fb2',
  'application/vnd.comicbook+zip': 'cbz',
};

/**
 * Detects the book format from filename and MIME type.
 */
export function detectOneDriveBookFormat(name: string, mimeType?: string): string {
  if (mimeType && MIME_TO_FORMAT[mimeType]) {
    return MIME_TO_FORMAT[mimeType]!;
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext || 'unknown';
}

/**
 * Checks if a given filename or mimeType represents a supported book format.
 */
export function isSupportedOneDriveBookFile(
  name: string,
  mimeType?: string,
  allowedExtensions: readonly string[] = ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS,
): boolean {
  if (mimeType && MIME_TO_FORMAT[mimeType]) {
    const fmt = MIME_TO_FORMAT[mimeType]!;
    return allowedExtensions.includes(fmt);
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return allowedExtensions.includes(ext);
}

// ─── Graph API Response Shapes ──────────────────────────────────────────────

interface GraphListChildrenResponse {
  value?: GraphDriveItem[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

// ─── Service Class ──────────────────────────────────────────────────────────

/**
 * Handles all file listing, searching, and metadata operations on Microsoft OneDrive
 * via the Microsoft Graph API (`/v1.0/me/drive`).
 */
export class OneDriveFileService {
  /**
   * Transforms a Microsoft Graph DriveItem into a normalized OneDriveFileMetadata.
   */
  static toFileMetadata(item: GraphDriveItem): OneDriveFileMetadata {
    const name = item.name || 'Untitled';
    const mimeType = item.file?.mimeType || 'application/octet-stream';
    const formatHint = detectOneDriveBookFormat(name, mimeType);

    return {
      id: item.id,
      name,
      mimeType,
      size: item.size,
      modifiedTime: item.lastModifiedDateTime,
      createdTime: item.createdDateTime,
      webUrl: item.webUrl,
      downloadUrl: item['@microsoft.graph.downloadUrl'],
      formatHint,
      parentPath: item.parentReference?.path,
      isDeleted: Boolean(item.deleted),
    };
  }

  /**
   * Lists book files from the user's OneDrive root or specified folder.
   * Filters results to include only supported book formats (.epub, .pdf, .txt, .mobi, etc.).
   *
   * @param accessToken - Valid Microsoft OAuth2 access token
   * @param options     - Filtering, pagination, and folder options
   */
  async listFiles(
    accessToken: string,
    options?: OneDriveListFilesOptions,
  ): Promise<OneDriveListFilesResult> {
    if (!accessToken?.trim()) {
      throw new Error('OneDriveFileService: accessToken is required.');
    }

    const {
      folderId,
      folderPath,
      searchTerm,
      top = 100,
      nextLink,
      allowedExtensions = ONEDRIVE_SUPPORTED_BOOK_EXTENSIONS,
    } = options ?? {};

    let url: string;

    if (nextLink) {
      url = nextLink;
    } else if (searchTerm && searchTerm.trim()) {
      url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/root/search(q='${encodeURIComponent(searchTerm.trim())}')?$top=${top}&$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,@microsoft.graph.downloadUrl`;
    } else if (folderId) {
      url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/items/${encodeURIComponent(folderId)}/children?$top=${top}&$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,@microsoft.graph.downloadUrl`;
    } else if (folderPath && folderPath.trim()) {
      const cleanPath = folderPath.trim().replace(/^\//, '').replace(/\/$/, '');
      url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/root:/${encodeURIComponent(cleanPath)}:/children?$top=${top}&$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,@microsoft.graph.downloadUrl`;
    } else {
      url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/root/children?$top=${top}&$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,@microsoft.graph.downloadUrl`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as {
        error?: { message?: string; code?: string };
      };
      const msg = errData.error?.message || `Microsoft Graph API Error (HTTP ${response.status}: ${response.statusText})`;
      if (response.status === 401) {
        throw Object.assign(new Error(`TokenExpired: ${msg}`), { code: 'TOKEN_EXPIRED' });
      }
      throw new Error(msg);
    }

    const data = (await response.json()) as GraphListChildrenResponse;
    const items = data.value ?? [];

    const entries: OneDriveFileMetadata[] = [];
    for (const item of items) {
      // Exclude folders from book file list
      if (item.folder) continue;

      const mimeType = item.file?.mimeType;
      if (isSupportedOneDriveBookFile(item.name, mimeType, allowedExtensions)) {
        entries.push(OneDriveFileService.toFileMetadata(item));
      }
    }

    return {
      entries,
      nextLink: data['@odata.nextLink'],
    };
  }

  /**
   * Lists ALL book files in OneDrive, traversing pagination automatically.
   */
  async listAllFiles(
    accessToken: string,
    options?: Omit<OneDriveListFilesOptions, 'nextLink'>,
  ): Promise<OneDriveFileMetadata[]> {
    const allEntries: OneDriveFileMetadata[] = [];
    let currentNextLink: string | undefined;

    do {
      const result = await this.listFiles(accessToken, {
        ...options,
        nextLink: currentNextLink,
      });
      allEntries.push(...result.entries);
      currentNextLink = result.nextLink;
    } while (currentNextLink);

    return allEntries;
  }

  /**
   * Fetches metadata for a single DriveItem by its ID.
   */
  async getFileMetadata(
    accessToken: string,
    itemId: string,
  ): Promise<OneDriveFileMetadata> {
    if (!accessToken?.trim()) {
      throw new Error('OneDriveFileService: accessToken is required.');
    }
    if (!itemId?.trim()) {
      throw new Error('OneDriveFileService: itemId is required.');
    }

    const url = `${MICROSOFT_GRAPH_API_BASE}/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,size,createdDateTime,lastModifiedDateTime,webUrl,file,folder,parentReference,@microsoft.graph.downloadUrl`;

    const response = await fetch(url, {
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
      throw new Error(errData.error?.message || `Graph API Error (HTTP ${response.status})`);
    }

    const item = (await response.json()) as GraphDriveItem;
    return OneDriveFileService.toFileMetadata(item);
  }

  /**
   * Lists only folders in OneDrive (root or child of parentFolderId) for folder picker UI.
   */
  async listFolders(
    accessToken: string,
    parentFolderId?: string,
  ): Promise<OneDriveFolderMetadata[]> {
    if (!accessToken?.trim()) {
      throw new Error('OneDriveFileService: accessToken is required.');
    }

    const endpoint = parentFolderId
      ? `${MICROSOFT_GRAPH_API_BASE}/me/drive/items/${encodeURIComponent(parentFolderId)}/children?$filter=folder ne null&$select=id,name,folder,webUrl,parentReference`
      : `${MICROSOFT_GRAPH_API_BASE}/me/drive/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,parentReference`;

    const response = await fetch(endpoint, {
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
      throw new Error(errData.error?.message || `Graph API Error (HTTP ${response.status})`);
    }

    const data = (await response.json()) as GraphListChildrenResponse;
    const folders: OneDriveFolderMetadata[] = [];

    for (const item of data.value ?? []) {
      if (item.folder) {
        folders.push({
          id: item.id,
          name: item.name,
          childCount: item.folder.childCount,
          webUrl: item.webUrl,
          parentPath: item.parentReference?.path,
        });
      }
    }

    return folders;
  }
}
