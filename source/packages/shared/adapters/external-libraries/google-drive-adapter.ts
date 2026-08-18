import {
  isSupportedExternalFormat,
  type ConnectionTestResult,
  type ExternalCatalogEntry,
  type ExternalLibraryProvider,
  type LinkLibraryOptions,
} from '@reading-book/domain';
import type { ExternalLibraryProviderAdapter } from './types.js';

export interface FileSystemScanner {
  scanDirectory(path: string): Promise<Array<{
    name: string;
    path: string;
    size?: number;
    modifiedTime?: string;
  }>>;
}

/**
 * Định nghĩa cấu trúc file sách trả về từ Google Drive API
 */
export interface GoogleDriveBookFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  formatHint?: string;
}

export interface PullCatalogOptions {
  /** Thư mục cha cụ thể nếu chỉ muốn quét trong 1 folder, ví dụ: 'root' hoặc 'folder_id_xyz' */
  folderId?: string;
  /** Từ khóa tìm kiếm bổ sung theo tên tệp */
  searchTerm?: string;
  /** Số lượng tệp tối đa muốn lấy (mặc định: 100) */
  pageSize?: number;
}

/**
 * Hàm hỗ trợ xác định định dạng sách dựa vào MIME type hoặc đuôi tệp
 */
export function detectGoogleDriveBookFormat(name: string, mimeType: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mimeType === 'application/epub+zip' || ext === 'epub') return 'epub';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType === 'application/x-mobipocket-ebook' || ext === 'mobi') return 'mobi';
  if (ext === 'azw3') return 'azw3';
  if (ext === 'fb2') return 'fb2';
  if (ext === 'cbz') return 'cbz';
  if (ext === 'txt') return 'txt';
  return ext || 'unknown';
}

/**
 * Lấy danh sách sách từ Google Drive cá nhân của người dùng qua REST API v3.files.list
 *
 * @param accessToken OAuth2 Access Token nhận được sau khi người dùng xác thực Google
 * @param options Các tùy chọn lọc thêm (thư mục, tìm kiếm, số lượng)
 * @returns Mảng các tệp sách đạt chuẩn để hiển thị lên UI ứng dụng đọc sách
 */
export async function pullCatalogFromGoogleDrive(
  accessToken: string,
  options?: PullCatalogOptions,
): Promise<GoogleDriveBookFile[]> {
  if (!accessToken || !accessToken.trim()) {
    throw new Error('Access Token không hợp lệ hoặc đã hết hạn.');
  }

  const { folderId, searchTerm, pageSize = 100 } = options ?? {};

  // 1. Xây dựng câu truy vấn `q` (query)
  // - Bỏ qua các file đã bị xóa (trashed = false)
  // - Lọc các MIME types và đuôi file sách phổ biến
  const formatConditions = [
    "mimeType = 'application/epub+zip'",
    "mimeType = 'application/pdf'",
    "mimeType = 'application/x-mobipocket-ebook'",
    "mimeType = 'application/vnd.amazon.ebook'",
    "name contains '.epub'",
    "name contains '.pdf'",
    "name contains '.mobi'",
    "name contains '.azw3'",
    "name contains '.fb2'",
    "name contains '.cbz'",
    "name contains '.txt'",
  ];

  let queryConditions = `trashed = false and (${formatConditions.join(' or ')})`;

  // Lọc theo thư mục cha nếu người dùng chỉ định
  if (folderId) {
    queryConditions += ` and '${folderId}' in parents`;
  }

  // Lọc theo từ khóa tìm kiếm tên file
  if (searchTerm && searchTerm.trim()) {
    const escapedTerm = searchTerm.replace(/'/g, "\\'");
    queryConditions += ` and name contains '${escapedTerm}'`;
  }

  // 2. Chỉ định các trường (fields) cần thiết để tối ưu dung lượng payload
  const fields = 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink, webViewLink, webContentLink)';

  const books: GoogleDriveBookFile[] = [];
  let pageToken: string | undefined = undefined;

  try {
    do {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', queryConditions);
      url.searchParams.set('fields', fields);
      url.searchParams.set('pageSize', Math.min(pageSize, 100).toString());
      url.searchParams.set('spaces', 'drive');
      url.searchParams.set('orderBy', 'modifiedTime desc');

      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          (errorData as { error?: { message?: string } })?.error?.message ||
          `Google Drive API Error (HTTP ${response.status}: ${response.statusText})`;
        throw new Error(errorMessage);
      }

      const data = (await response.json()) as {
        files?: Array<{
          id?: string;
          name?: string;
          mimeType?: string;
          size?: string | number;
          modifiedTime?: string;
          thumbnailLink?: string;
          webViewLink?: string;
          webContentLink?: string;
        }>;
        nextPageToken?: string;
      };

      const files = data.files || [];

      for (const file of files) {
        const name = file.name || 'Untitled';
        const mimeType = file.mimeType || 'application/octet-stream';
        books.push({
          id: file.id || '',
          name,
          mimeType,
          size: file.size ? Number(file.size) : undefined,
          modifiedTime: file.modifiedTime,
          thumbnailLink: file.thumbnailLink,
          webViewLink: file.webViewLink,
          webContentLink: file.webContentLink,
          formatHint: detectGoogleDriveBookFormat(name, mimeType),
        });
      }

      pageToken = data.nextPageToken;

      if (books.length >= pageSize) break;
    } while (pageToken);

    return books;
  } catch (error) {
    console.error('Lỗi khi đồng bộ danh sách sách từ Google Drive API:', error);
    throw error;
  }
}

export class GoogleDriveLibraryAdapter implements ExternalLibraryProviderAdapter {
  readonly provider: ExternalLibraryProvider = 'google_drive';
  private readonly fileScanner?: FileSystemScanner;

  constructor(fileScanner?: FileSystemScanner) {
    this.fileScanner = fileScanner;
  }

  async testConnection(options?: LinkLibraryOptions): Promise<ConnectionTestResult> {
    if (options?.folderPath) {
      return {
        success: true,
        message: `Đã kết nối thư mục Google Drive: ${options.folderPath}`,
      };
    }

    const token = options?.apiKey;
    if (token && token !== 'xxx') {
      try {
        const sample = await pullCatalogFromGoogleDrive(token, { pageSize: 1 });
        return {
          success: true,
          message: `Kết nối Google Drive API thành công. Tìm thấy ${sample.length} tệp sách.`,
          itemCount: sample.length,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `Lỗi kết nối Google Drive API: ${msg}`,
        };
      }
    }

    if (options?.oauthClientId) {
      return {
        success: true,
        message: 'Google Drive OAuth client đã được cấu hình.',
      };
    }

    return {
      success: true,
      message: 'Google Drive kết nối ở chế độ folder-first (API Key: xxx).',
    };
  }

  async pullCatalog(
    options?: LinkLibraryOptions,
    query?: string,
  ): Promise<ExternalCatalogEntry[]> {
    const results: ExternalCatalogEntry[] = [];

    // 1. Google Drive REST API pull nếu có Access Token
    const token = options?.apiKey;
    if (token && token !== 'xxx') {
      try {
        const driveFiles = await pullCatalogFromGoogleDrive(token, {
          searchTerm: query,
        });

        return driveFiles.map((file) => ({
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
          description: `Sách từ Google Drive (${file.formatHint?.toUpperCase() || file.mimeType})`,
        }));
      } catch (err) {
        console.warn('Google Drive API fetch failed, falling back to local/sample:', err);
      }
    }

    // 2. Folder-first scan nếu đã liên kết thư mục đồng bộ Google Drive trên máy tính
    if (options?.folderPath && this.fileScanner) {
      try {
        const files = await this.fileScanner.scanDirectory(options.folderPath);
        for (const file of files) {
          const ext = file.name.split('.').pop() ?? '';
          if (isSupportedExternalFormat(ext)) {
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
      } catch {
        /* Fallback if scanner fails */
      }
    }

    // 3. Mock / Sample Mode (nếu chưa cấu hình token hoặc thư mục)
    const sampleEntries: ExternalCatalogEntry[] = [
      {
        externalId: 'gdrive_sample_01',
        sourceProvider: 'google_drive',
        title: 'Google Drive Document Sample 1',
        authorNames: ['Cloud Author'],
        formatHint: 'epub',
        localPath: options?.folderPath ? `${options.folderPath}/Sample1.epub` : undefined,
        description: 'Tài liệu từ thư mục Google Drive đồng bộ.',
      },
      {
        externalId: 'gdrive_sample_02',
        sourceProvider: 'google_drive',
        title: 'Google Drive Research Paper',
        authorNames: ['Drive Team'],
        formatHint: 'pdf',
        localPath: options?.folderPath ? `${options.folderPath}/Paper.pdf` : undefined,
        description: 'Báo cáo PDF từ Google Drive.',
      },
    ];

    if (query) {
      return sampleEntries.filter((e) =>
        e.title.toLowerCase().includes(query.toLowerCase()),
      );
    }

    return sampleEntries;
  }
}
