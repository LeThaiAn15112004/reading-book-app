import type { GoogleDriveStoredTokens } from './types.js';

const GDRIVE_STORAGE_KEY = 'reading_book:google_drive_tokens';

/**
 * Storage interface for securely persisting and retrieving Google Drive OAuth tokens.
 */
export interface GoogleDriveTokenStore {
  saveTokens(tokens: GoogleDriveStoredTokens): Promise<void>;
  getTokens(): Promise<GoogleDriveStoredTokens | null>;
  clearTokens(): Promise<void>;
  /**
   * Returns true if we have either a valid (non-expired) access token
   * or a refresh token that can be used to get a new access token.
   */
  hasValidToken(): Promise<boolean>;
}

/**
 * Browser / Electron Renderer implementation using localStorage for persistence
 * across page reloads and application restarts.
 */
export class LocalStorageGoogleDriveTokenStore implements GoogleDriveTokenStore {
  private readonly storageKey: string;

  constructor(storageKey = GDRIVE_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  async saveTokens(tokens: GoogleDriveStoredTokens): Promise<void> {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(tokens));
    }
  }

  async getTokens(): Promise<GoogleDriveStoredTokens | null> {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as GoogleDriveStoredTokens;
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
    // A refresh token means we can always get a new access token
    if (tokens.refreshToken) return true;
    // Otherwise, check the access token hasn't expired (with 1 min buffer)
    return tokens.expiresAt > Date.now() + 60_000;
  }
}

/**
 * In-memory implementation for testing and server-side / headless environments.
 */
export class MemoryGoogleDriveTokenStore implements GoogleDriveTokenStore {
  private storedTokens: GoogleDriveStoredTokens | null = null;

  async saveTokens(tokens: GoogleDriveStoredTokens): Promise<void> {
    this.storedTokens = { ...tokens };
  }

  async getTokens(): Promise<GoogleDriveStoredTokens | null> {
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
 * Factory: selects LocalStorage implementation in browser/Electron renderer,
 * falls back to in-memory store in other runtimes (Node.js, headless).
 */
export function createDefaultGoogleDriveTokenStore(): GoogleDriveTokenStore {
  if (typeof window !== 'undefined' && window.localStorage) {
    return new LocalStorageGoogleDriveTokenStore();
  }
  return new MemoryGoogleDriveTokenStore();
}
