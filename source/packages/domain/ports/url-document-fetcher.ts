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
export interface UrlDocumentFetcher {
  fetch(url: string): Promise<UrlFetchResult>;
}
