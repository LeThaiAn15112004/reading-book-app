/**
 * Result of downloading a direct file URL to a temp path (SDS §2.6).
 * Caller then runs the same DocumentImporter pipeline on `tempPath`.
 */
export interface UrlFetchResult {
  /** Local temp path of the downloaded file. */
  tempPath: string;
  suggestedFileName?: string;
  contentType?: string;
}

/**
 * Download a direct document URL via Main process (SDS §2.6).
 * Adapter MVP: HttpUrlFetcher (timeout, size limit, scheme allowlist).
 */
/** Optional controls for one download: user cancel and byte progress. */
export interface UrlFetchOptions {
  /** Aborting it cancels the download (the fetcher reports a `cancelled` failure). */
  signal?: AbortSignal;
  /** Cumulative bytes written; `totalBytes` is null when the server sent no Content-Length. */
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

export interface UrlDocumentFetcher {
  fetch(url: string, options?: UrlFetchOptions): Promise<UrlFetchResult>;
}
