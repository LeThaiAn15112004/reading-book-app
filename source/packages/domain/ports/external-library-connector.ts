/**
 * External library catalog connector (Phase 3 — SDS §2.9 / SRS FR-30).
 *
 * Pulls document lists from Google Drive, Google Books, or Apple Books into
 * the local Library. No app account: no email/password, no OAuth2 identity login.
 * Prefer folder / library path links already present on the device.
 */
export type ExternalLibraryProvider =
  | 'google_drive'
  | 'google_books'
  | 'apple_books';

export type ExternalLibraryStatus =
  | 'unlinked'
  | 'linked'
  | 'syncing'
  | 'error'
  | 'disabled';

export interface ExternalCatalogEntry {
  readonly externalId: string;
  readonly title: string;
  readonly authorNames?: string[];
  readonly formatHint?: string;
  /** Absolute path when the source is a local synced folder. */
  readonly localPath?: string;
}

export interface LinkLibraryOptions {
  /** Folder or library path chosen by the user (preferred over remote OAuth). */
  readonly folderPath?: string;
}

/**
 * Port for linking super-app libraries and syncing their document catalogs.
 * MVP uses NoOpExternalLibraryConnector.
 */
export interface ExternalLibraryConnector {
  listProviders(): ExternalLibraryProvider[];
  status(provider: ExternalLibraryProvider): ExternalLibraryStatus;
  link(
    provider: ExternalLibraryProvider,
    options?: LinkLibraryOptions,
  ): Promise<void>;
  unlink(provider: ExternalLibraryProvider): Promise<void>;
  pullCatalog(provider: ExternalLibraryProvider): Promise<ExternalCatalogEntry[]>;
}

/** MVP stub — no network / no folder link; always disabled. */
export class NoOpExternalLibraryConnector implements ExternalLibraryConnector {
  listProviders(): ExternalLibraryProvider[] {
    return ['google_drive', 'google_books', 'apple_books'];
  }

  status(_provider: ExternalLibraryProvider): ExternalLibraryStatus {
    return 'disabled';
  }

  async link(
    _provider: ExternalLibraryProvider,
    _options?: LinkLibraryOptions,
  ): Promise<void> {
    /* no-op */
  }

  async unlink(_provider: ExternalLibraryProvider): Promise<void> {
    /* no-op */
  }

  async pullCatalog(
    _provider: ExternalLibraryProvider,
  ): Promise<ExternalCatalogEntry[]> {
    return [];
  }
}
