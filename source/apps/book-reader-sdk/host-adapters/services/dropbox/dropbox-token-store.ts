import type { DropboxStoredTokens } from './types.js';

const DROPBOX_STORAGE_KEY = 'reading_book:dropbox_tokens';

/**
 * Storage interface for securely persisting and retrieving Dropbox OAuth tokens.
 */
export interface DropboxTokenStore {
  /** Save tokens to storage */
  saveTokens(tokens: DropboxStoredTokens): Promise<void>;
  /** Retrieve stored tokens */
  getTokens(): Promise<DropboxStoredTokens | null>;
  /** Clear/remove stored tokens (e.g. on unlink or logout) */
  clearTokens(): Promise<void>;
  /** Quick check if a valid (non-expired) access token or refresh token exists */
  hasValidToken(): Promise<boolean>;
}

/**
 * Browser / Electron Renderer implementation of DropboxTokenStore using LocalStorage.
 */
export class LocalStorageDropboxTokenStore implements DropboxTokenStore {
  private readonly storageKey: string;

  constructor(storageKey = DROPBOX_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  async saveTokens(tokens: DropboxStoredTokens): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(tokens));
    }
  }

  async getTokens(): Promise<DropboxStoredTokens | null> {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as DropboxStoredTokens;
      } catch {
        return null;
      }
    }
    return null;
  }

  async clearTokens(): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(this.storageKey);
    }
  }

  async hasValidToken(): Promise<boolean> {
    const tokens = await this.getTokens();
    if (!tokens) return false;
    // Valid if we have a refresh token or an access token that isn't expired
    if (tokens.refreshToken) return true;
    const now = Date.now();
    return tokens.expiresAt > now + 60_000; // 1 min buffer
  }
}

/**
 * In-memory implementation of DropboxTokenStore for testing or headless runtimes.
 */
export class MemoryDropboxTokenStore implements DropboxTokenStore {
  private storedTokens: DropboxStoredTokens | null = null;

  async saveTokens(tokens: DropboxStoredTokens): Promise<void> {
    this.storedTokens = { ...tokens };
  }

  async getTokens(): Promise<DropboxStoredTokens | null> {
    return this.storedTokens ? { ...this.storedTokens } : null;
  }

  async clearTokens(): Promise<void> {
    this.storedTokens = null;
  }

  async hasValidToken(): Promise<boolean> {
    if (!this.storedTokens) return false;
    if (this.storedTokens.refreshToken) return true;
    return this.storedTokens.expiresAt > Date.now() + 60_000;
  }
}

/**
 * Factory function to create the default Token Store based on current runtime environment.
 */
export function createDefaultDropboxTokenStore(): DropboxTokenStore {
  if (typeof window !== 'undefined' && window.localStorage) {
    return new LocalStorageDropboxTokenStore();
  }
  return new MemoryDropboxTokenStore();
}
