import {
  GOOGLE_DRIVE_API_BASE,
  GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS,
  type GoogleDriveFileMetadata,
  type GoogleDriveFolderMetadata,
  type GoogleDriveListFilesOptions,
  type GoogleDriveListFilesResult,
} from './types.js';

// ─── MIME Type → Format mapping ─────────────────────────────────────────────

const MIME_TO_FORMAT: Record<string, string> = {
  'application/epub+zip': 'epub',
  'application/pdf': 'pdf',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'azw3',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/vnd.comicbook+zip': 'cbz',
  'application/x-fb2': 'fb2',
};

/**
 * Determines the book format from a Google Drive file's name and MIME type.
 * Prioritizes MIME type, then falls back to the file extension.
 */
export function detectBookFormat(name: string, mimeType: string): string {
  const fromMime = MIME_TO_FORMAT[mimeType];
  if (fromMime) return fromMime;

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext || 'unknown';
}

/**
 * Returns true if the given file name+mimeType is a supported book format.
 */
export function isSupportedBookFile(
  name: string,
  mimeType: string,
  allowedExtensions: readonly string[] = GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS,
): boolean {
  if (MIME_TO_FORMAT[mimeType]) {
    const detected = MIME_TO_FORMAT[mimeType];
    return allowedExtensions.includes(detected ?? '');
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return allowedExtensions.includes(ext);
}

// ─── Build the Drive API query string ──────────────────────────────────────

/**
 * Builds a Google Drive API query string (`q` parameter) that filters for
 * supported book formats and excludes trashed files.
 */
function buildBookQuery(
  options?: GoogleDriveListFilesOptions,
): string {
  const extensions = options?.allowedExtensions ?? GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS;

  // MIME type conditions
  const mimeConditions = Object.entries(MIME_TO_FORMAT)
    .filter(([, fmt]) => extensions.includes(fmt))
    .map(([mime]) => `mimeType = '${mime}'`);

  // Extension name conditions (catches files with generic MIME types)
  const extConditions = extensions.map((ext) => `name contains '.${ext}'`);

  const formatFilter = `(${[...mimeConditions, ...extConditions].join(' or ')})`;
  let query = `trashed = false and ${formatFilter}`;

  if (options?.folderId) {
    query += ` and '${options.folderId}' in parents`;
  }

  if (options?.searchTerm?.trim()) {
    const escaped = options.searchTerm.trim().replace(/'/g, "\\'");
    query += ` and name contains '${escaped}'`;
  }

  return query;
}

// ─── Raw API response shapes ────────────────────────────────────────────────

interface DriveApiFile {
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
}

interface DriveApiListResponse {
  files?: DriveApiFile[];
  nextPageToken?: string;
}

interface DriveApiFolder {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
}

interface DriveApiFolderListResponse {
  files?: DriveApiFolder[];
  nextPageToken?: string;
}

// ─── Service class ──────────────────────────────────────────────────────────

/** Fields requested from the Drive API to minimise response payload size */
const FILE_FIELDS =
  'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, thumbnailLink, webViewLink, webContentLink, parents, trashed)';

const FOLDER_FIELDS =
  'nextPageToken, files(id, name, mimeType, parents)';

/**
 * Handles all Google Drive file listing and metadata retrieval operations.
 */
export class GoogleDriveFileService {
  /**
   * Lists book files in the user's Google Drive using the Drive v3 files.list endpoint.
   *
   * Supports pagination (pass `pageToken` in options for subsequent pages),
   * folder scoping, and keyword filtering.
   *
   * @param accessToken - Valid Google OAuth2 access token
   * @param options     - Filtering, pagination, and scope options
   */
  async listFiles(
    accessToken: string,
    options?: GoogleDriveListFilesOptions,
  ): Promise<GoogleDriveListFilesResult> {
    if (!accessToken?.trim()) {
      throw new Error('GoogleDriveFileService: accessToken is required.');
    }

    const pageSize = Math.min(options?.pageSize ?? 100, 1000);
    const query = buildBookQuery(options);

    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', FILE_FIELDS);
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('spaces', 'drive');
    url.searchParams.set('orderBy', 'modifiedTime desc');

    if (options?.pageToken) {
      url.searchParams.set('pageToken', options.pageToken);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as {
        error?: { message?: string; code?: number };
      };
      const msg =
        errData.error?.message ??
        `Google Drive API Error (HTTP ${response.status}: ${response.statusText})`;

      if (response.status === 401) {
        throw Object.assign(new Error(`TokenExpired: ${msg}`), { code: 'TOKEN_EXPIRED' });
      }

      throw new Error(msg);
    }

    const data = (await response.json()) as DriveApiListResponse;
    const entries: GoogleDriveFileMetadata[] = (data.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? 'Untitled',
      mimeType: f.mimeType ?? 'application/octet-stream',
      size: f.size !== undefined ? Number(f.size) : undefined,
      modifiedTime: f.modifiedTime,
      createdTime: f.createdTime,
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
      webContentLink: f.webContentLink,
      parents: f.parents,
      trashed: f.trashed,
      formatHint: detectBookFormat(f.name ?? '', f.mimeType ?? ''),
    }));

    return {
      entries,
      nextPageToken: data.nextPageToken,
    };
  }

  /**
   * Lists ALL book files in Google Drive, automatically following pagination until done.
   *
   * Use with caution for large Drive accounts — prefer paginated `listFiles` for UI-driven loading.
   */
  async listAllFiles(
    accessToken: string,
    options?: Omit<GoogleDriveListFilesOptions, 'pageToken'>,
  ): Promise<GoogleDriveFileMetadata[]> {
    const allEntries: GoogleDriveFileMetadata[] = [];
    let pageToken: string | undefined;

    do {
      const result = await this.listFiles(accessToken, { ...options, pageToken });
      allEntries.push(...result.entries);
      pageToken = result.nextPageToken;
    } while (pageToken);

    return allEntries;
  }

  /**
   * Fetches metadata for a single file by its Google Drive file ID.
   *
   * @param accessToken - Valid Google OAuth2 access token
   * @param fileId      - Google Drive file ID (e.g. "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms")
   */
  async getFileMetadata(
    accessToken: string,
    fileId: string,
  ): Promise<GoogleDriveFileMetadata> {
    if (!accessToken?.trim()) {
      throw new Error('GoogleDriveFileService: accessToken is required.');
    }
    if (!fileId?.trim()) {
      throw new Error('GoogleDriveFileService: fileId is required.');
    }

    const fields =
      'id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,webViewLink,webContentLink,parents,trashed';

    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set('fields', fields);

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
      const msg = errData.error?.message ?? `Drive API Error (HTTP ${response.status})`;
      throw new Error(msg);
    }

    const f = (await response.json()) as DriveApiFile;
    return {
      id: f.id ?? '',
      name: f.name ?? 'Untitled',
      mimeType: f.mimeType ?? 'application/octet-stream',
      size: f.size !== undefined ? Number(f.size) : undefined,
      modifiedTime: f.modifiedTime,
      createdTime: f.createdTime,
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
      webContentLink: f.webContentLink,
      parents: f.parents,
      trashed: f.trashed,
      formatHint: detectBookFormat(f.name ?? '', f.mimeType ?? ''),
    };
  }

  /**
   * Lists folders in Google Drive, optionally scoped to a parent folder.
   * Useful for building a folder picker UI so users can choose a sync directory.
   *
   * @param accessToken    - Valid Google OAuth2 access token
   * @param parentFolderId - Parent folder ID to scope listing (default: 'root')
   */
  async listFolders(
    accessToken: string,
    parentFolderId?: string,
  ): Promise<GoogleDriveFolderMetadata[]> {
    if (!accessToken?.trim()) {
      throw new Error('GoogleDriveFileService: accessToken is required.');
    }

    const parent = parentFolderId ?? 'root';
    const query =
      `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parent}' in parents`;

    const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files`);
    url.searchParams.set('q', query);
    url.searchParams.set('fields', FOLDER_FIELDS);
    url.searchParams.set('pageSize', '100');
    url.searchParams.set('orderBy', 'name');

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
        errData.error?.message ?? `Drive API Error (HTTP ${response.status})`,
      );
    }

    const data = (await response.json()) as DriveApiFolderListResponse;
    return (data.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? 'Untitled Folder',
      mimeType: 'application/vnd.google-apps.folder' as const,
      parents: f.parents,
    }));
  }
}
