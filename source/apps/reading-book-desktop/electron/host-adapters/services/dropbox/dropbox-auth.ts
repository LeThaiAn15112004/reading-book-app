import {
  DROPBOX_AUTH_URL,
  DROPBOX_DEFAULT_APP_KEY,
  DROPBOX_DEFAULT_APP_SECRET,
  DROPBOX_TOKEN_URL,
  type DropboxAppCredentials,
  type DropboxStoredTokens,
  type DropboxTokenResponse,
  type OAuthAuthUrlOptions,
  type TokenExchangeOptions,
} from './types.js';
import {
  createDefaultDropboxTokenStore,
  type DropboxTokenStore,
} from './dropbox-token-store.js';

export interface DropboxAuthServiceOptions {
  credentials?: Partial<DropboxAppCredentials>;
  tokenStore?: DropboxTokenStore;
}

/**
 * Generates a PKCE code verifier and code challenge pair for secure OAuth 2.0 PKCE flow.
 * Works seamlessly in both browser (Web Crypto API) and Node.js / Electron environments.
 */
export async function generatePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(48);

  // Use crypto / globalThis.crypto
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }

  let codeVerifier = '';
  for (let i = 0; i < array.length; i++) {
    const val = array[i] ?? 0;
    codeVerifier += chars[val % chars.length];
  }

  // Calculate SHA-256 of codeVerifier
  let codeChallenge = '';
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hash);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    // Base64URL encode
    codeChallenge = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } else {
    // Fallback simple base64url for environments without subtle crypto
    codeChallenge = btoa(codeVerifier)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  return { codeVerifier, codeChallenge };
}

/**
 * Service managing Dropbox OAuth 2.0 lifecycle:
 * - Authorization URL generation (standard code flow & PKCE)
 * - Code-to-token exchange
 * - Token refreshing
 * - Automatic token validity verification
 * - Token revocation
 */
export class DropboxAuthService {
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly tokenStore: DropboxTokenStore;

  constructor(options?: DropboxAuthServiceOptions) {
    this.appKey = options?.credentials?.appKey
      || (typeof process !== 'undefined' ? process.env['DROPBOX_APP_KEY'] : undefined)
      || DROPBOX_DEFAULT_APP_KEY;
    this.appSecret = options?.credentials?.appSecret
      || (typeof process !== 'undefined' ? process.env['DROPBOX_APP_SECRET'] : undefined)
      || DROPBOX_DEFAULT_APP_SECRET;
    this.tokenStore = options?.tokenStore ?? createDefaultDropboxTokenStore();
  }

  /**
   * Get configured App Key
   */
  getAppKey(): string {
    return this.appKey;
  }

  /**
   * Get configured Token Store
   */
  getTokenStore(): DropboxTokenStore {
    return this.tokenStore;
  }

  /**
   * Step 1: Generate the Dropbox OAuth 2.0 Authorization URL.
   *
   * @param options Configuration options including redirectUri, state, PKCE codeChallenge, etc.
   * @returns Complete URL string to redirect user to Dropbox login / permission page.
   */
  getAuthorizationUrl(options?: OAuthAuthUrlOptions): string {
    const url = new URL(DROPBOX_AUTH_URL);
    const appKey = options?.appKey || this.appKey;

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', appKey);

    // Request offline access to receive a refresh token
    url.searchParams.set('token_access_type', options?.tokenAccessType || 'offline');

    if (options?.redirectUri) {
      url.searchParams.set('redirect_uri', options.redirectUri);
    }

    if (options?.state) {
      url.searchParams.set('state', options.state);
    }

    if (options?.forceReapprove) {
      url.searchParams.set('force_reapprove', 'true');
    }

    if (options?.codeChallenge) {
      url.searchParams.set('code_challenge', options.codeChallenge);
      url.searchParams.set(
        'code_challenge_method',
        options.codeChallengeMethod || 'S256',
      );
    }

    if (options?.scope) {
      url.searchParams.set('scope', options.scope);
    }

    return url.toString();
  }

  /**
   * Step 2: Exchange authorization code received from callback for access and refresh tokens.
   *
   * @param options Details containing the authorization code, optional redirectUri, PKCE verifier, etc.
   * @returns Stored tokens object containing accessToken, refreshToken, and expiresAt.
   */
  async exchangeCodeForTokens(
    options: TokenExchangeOptions,
  ): Promise<DropboxStoredTokens> {
    const { code, redirectUri, codeVerifier } = options;
    const appKey = options.appKey || this.appKey;
    const appSecret = options.appSecret || this.appSecret;

    if (!code || !code.trim()) {
      throw new Error('Dropbox OAuth Error: Authorization code is missing.');
    }

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      client_id: appKey,
    });

    if (appSecret) {
      bodyParams.set('client_secret', appSecret);
    }

    if (redirectUri) {
      bodyParams.set('redirect_uri', redirectUri);
    }

    if (codeVerifier) {
      bodyParams.set('code_verifier', codeVerifier);
    }

    const response = await fetch(DROPBOX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDescription = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText) as {
          error_description?: string;
          error?: string;
        };
        errorDescription = errorJson.error_description || errorJson.error || errorDescription;
      } catch {
        /* use errorDescription */
      }
      throw new Error(`Dropbox Token Exchange Failed: ${errorDescription}`);
    }

    const data = (await response.json()) as DropboxTokenResponse;
    const expiresInMs = (data.expires_in ?? 14400) * 1000; // Default 4 hours if not provided
    const expiresAt = Date.now() + expiresInMs;

    const storedTokens: DropboxStoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      tokenType: data.token_type || 'bearer',
      scope: data.scope,
      accountId: data.account_id,
      uid: data.uid,
    };

    // Save tokens securely in store
    await this.tokenStore.saveTokens(storedTokens);

    return storedTokens;
  }

  /**
   * Refresh an expired access token using the stored refresh token.
   *
   * @param refreshToken Optional explicit refresh token; if omitted, reads from token store.
   * @returns Updated DropboxStoredTokens.
   */
  async refreshAccessToken(refreshToken?: string): Promise<DropboxStoredTokens> {
    const currentTokens = await this.tokenStore.getTokens();
    const tokenToUse = refreshToken || currentTokens?.refreshToken;

    if (!tokenToUse) {
      throw new Error(
        'Dropbox Refresh Error: No refresh token available. User must re-authenticate.',
      );
    }

    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenToUse,
      client_id: this.appKey,
    });

    if (this.appSecret) {
      bodyParams.set('client_secret', this.appSecret);
    }

    const response = await fetch(DROPBOX_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Dropbox Token Refresh Failed (HTTP ${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as DropboxTokenResponse;
    const expiresInMs = (data.expires_in ?? 14400) * 1000;
    const expiresAt = Date.now() + expiresInMs;

    const updatedTokens: DropboxStoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokenToUse,
      expiresAt,
      tokenType: data.token_type || currentTokens?.tokenType || 'bearer',
      scope: data.scope || currentTokens?.scope,
      accountId: data.account_id || currentTokens?.accountId,
      uid: data.uid || currentTokens?.uid,
    };

    await this.tokenStore.saveTokens(updatedTokens);
    return updatedTokens;
  }

  /**
   * Helper to retrieve a valid access token.
   * Automatically refreshes if expired or within 2 minutes of expiration.
   */
  async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.tokenStore.getTokens();
    if (!tokens) return null;

    const now = Date.now();
    const isExpiringSoon = tokens.expiresAt <= now + 120_000; // 2 min buffer

    if (isExpiringSoon && tokens.refreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(tokens.refreshToken);
        return refreshed.accessToken;
      } catch (err) {
        console.warn('Auto refresh failed for Dropbox token:', err);
        return tokens.accessToken;
      }
    }

    return tokens.accessToken;
  }

  /**
   * Revoke current token and clear local token store.
   */
  async revokeToken(accessToken?: string): Promise<void> {
    const token = accessToken || (await this.getValidAccessToken());
    if (token) {
      try {
        await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        console.warn('Dropbox token revoke network notice:', err);
      }
    }
    await this.tokenStore.clearTokens();
  }
}
