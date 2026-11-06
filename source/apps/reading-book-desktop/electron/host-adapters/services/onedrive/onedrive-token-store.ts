import type { OneDriveStoredTokens } from './types.js';

const ONEDRIVE_STORAGE_KEY = 'reading_book:onedrive_tokens';

/**
 * Storage interface for securely persisting and retrieving Microsoft OneDrive OAuth tokens.
 */
export interface OneDriveTokenStore {
  saveTokens(tokens: OneDriveStoredTokens): Promise<void>;
  getTokens(): Promise<OneDriveStoredTokens | null>;
  clearTokens(): Promise<void>;
  /**
   * Returns true if we have either a valid (non-expired) access token
   * or a refresh token that can be used to acquire a new access token.
   */
  hasValidToken(): Promise<boolean>;
}

/**
 * Browser / Electron Renderer implementation using localStorage for persistence
 * across page reloads and application restarts.
 */
export class LocalStorageOneDriveTokenStore implements OneDriveTokenStore {
  private readonly storageKey: string;

  constructor(storageKey = ONEDRIVE_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  async saveTokens(tokens: OneDriveStoredTokens): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(tokens));
    }
  }

  async getTokens(): Promise<OneDriveStoredTokens | null> {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as OneDriveStoredTokens;
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
    // Having a refresh token means we can acquire a fresh token silently
    if (tokens.refreshToken) return true;
    // Otherwise check that the access token hasn't expired (with 1-min safety buffer)
    return tokens.expiresAt > Date.now() + 60_000;
  }
}

/**
 * In-memory implementation for testing and headless / Node.js / server environments.
 */
export class MemoryOneDriveTokenStore implements OneDriveTokenStore {
  private storedTokens: OneDriveStoredTokens | null = null;

  async saveTokens(tokens: OneDriveStoredTokens): Promise<void> {
    this.storedTokens = { ...tokens };
  }

  async getTokens(): Promise<OneDriveStoredTokens | null> {
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
 * Factory: selects LocalStorage implementation in browser / Electron renderer,
 * falls back to in-memory store in other runtimes (Node.js, tests, mobile bridge).
 */
export function createDefaultOneDriveTokenStore(): OneDriveTokenStore {
  if (typeof window !== 'undefined' && window.localStorage) {
    return new LocalStorageOneDriveTokenStore();
  }
  return new MemoryOneDriveTokenStore();
}
