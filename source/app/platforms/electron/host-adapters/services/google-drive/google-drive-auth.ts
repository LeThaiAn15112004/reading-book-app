import {
  GOOGLE_DRIVE_DEFAULT_SCOPES,
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  type GoogleDriveAppCredentials,
  type GoogleDriveStoredTokens,
  type GoogleDriveTokenResponse,
  type GoogleOAuthUrlOptions,
  type GoogleTokenExchangeOptions,
} from './types.js';
import {
  createDefaultGoogleDriveTokenStore,
  type GoogleDriveTokenStore,
} from './google-drive-token-store.js';

export interface GoogleDriveAuthServiceOptions {
  credentials?: Partial<GoogleDriveAppCredentials>;
  tokenStore?: GoogleDriveTokenStore;
}

/**
 * Generates a cryptographically secure PKCE (Proof Key for Code Exchange) pair.
 * Works in both browser (Web Crypto API) and Node.js / Electron environments.
 *
 * @returns { codeVerifier, codeChallenge } pair for use in OAuth2 PKCE flow
 */
export async function generateGoogleDrivePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  // Generate 48 random bytes → produces a 64-character verifier string
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomBytes = new Uint8Array(48);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    // Fallback for environments without Crypto API
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let codeVerifier = '';
  for (let i = 0; i < randomBytes.length; i++) {
    codeVerifier += chars[(randomBytes[i] ?? 0) % chars.length];
  }

  // SHA-256 hash of verifier, then Base64URL-encode to form the code challenge
  let codeChallenge = '';
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(codeVerifier);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = new Uint8Array(hashBuffer);
    let binary = '';
    for (let i = 0; i < hashArray.length; i++) {
      binary += String.fromCharCode(hashArray[i] ?? 0);
    }
    // Base64URL: replace + → -, / → _, strip trailing =
    codeChallenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else {
    // Fallback: simple base64url encoding of the verifier itself
    codeChallenge = btoa(codeVerifier).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  return { codeVerifier, codeChallenge };
}

/**
 * Service managing the full Google OAuth 2.0 lifecycle for Drive access:
 *  1. Build authorization URL (standard code flow + optional PKCE)
 *  2. Exchange authorization code → access_token + refresh_token
 *  3. Proactively refresh expired access tokens
 *  4. Retrieve a valid token, auto-refreshing when needed
 *  5. Revoke token and clear stored credentials on unlink
 */
export class GoogleDriveAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenStore: GoogleDriveTokenStore;

  constructor(options?: GoogleDriveAuthServiceOptions) {
    // Fall back to environment variables so credentials are never hardcoded in source
    this.clientId = options?.credentials?.clientId
      ?? (typeof process !== 'undefined' ? (process.env['GOOGLE_CLIENT_ID'] ?? '') : '');
    this.clientSecret = options?.credentials?.clientSecret
      ?? (typeof process !== 'undefined' ? (process.env['GOOGLE_CLIENT_SECRET'] ?? '') : '');
    this.tokenStore = options?.tokenStore ?? createDefaultGoogleDriveTokenStore();
  }

  /** Expose the configured clientId for external use (e.g. URL building) */
  getClientId(): string { return this.clientId; }

  /** Expose the token store (e.g. for status checks) */
  getTokenStore(): GoogleDriveTokenStore { return this.tokenStore; }

  /**
   * Step 1: Build the Google OAuth2 authorization URL.
   * The user's browser must be redirected here to begin the OAuth flow.
   *
   * Key parameters:
   *  - response_type=code  (Authorization Code flow)
   *  - access_type=offline  (requests a refresh_token — critical for background sync)
   *  - prompt=consent  (forces Google to return a fresh refresh_token on each consent)
   *  - code_challenge / code_challenge_method=S256 (PKCE protection)
   */
  getAuthorizationUrl(options?: GoogleOAuthUrlOptions): string {
    const url = new URL(GOOGLE_OAUTH_AUTH_URL);
    const clientId = options?.clientId || this.clientId;

    if (!clientId) {
      throw new Error(
        'GoogleDriveAuthService: clientId is required. Set GOOGLE_CLIENT_ID env var or pass credentials.',
      );
    }

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', options?.accessType ?? 'offline');
    url.searchParams.set('prompt', options?.prompt ?? 'consent');

    // Scopes — default to drive.readonly for listing and downloading files
    const scopes = options?.scopes ?? GOOGLE_DRIVE_DEFAULT_SCOPES;
    url.searchParams.set('scope', [...scopes].join(' '));

    if (options?.redirectUri) {
      url.searchParams.set('redirect_uri', options.redirectUri);
    }

    if (options?.state) {
      url.searchParams.set('state', options.state);
    }

    // PKCE support: attach code challenge if provided
    if (options?.codeChallenge) {
      url.searchParams.set('code_challenge', options.codeChallenge);
      url.searchParams.set('code_challenge_method', options.codeChallengeMethod ?? 'S256');
    }

    if (options?.includeGrantedScopes) {
      url.searchParams.set('include_granted_scopes', 'true');
    }

    return url.toString();
  }

  /**
   * Step 2: Exchange the authorization code for access + refresh tokens.
   * Called after the user is redirected back from Google with ?code=...
   *
   * Persists the tokens in the token store for future use.
   */
  async exchangeCodeForTokens(
    options: GoogleTokenExchangeOptions,
  ): Promise<GoogleDriveStoredTokens> {
    const { code, redirectUri, codeVerifier } = options;
    const clientId = options.clientId || this.clientId;
    const clientSecret = options.clientSecret || this.clientSecret;

    if (!code?.trim()) {
      throw new Error('Google OAuth Error: Authorization code is missing.');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      client_id: clientId,
    });

    if (clientSecret) body.set('client_secret', clientSecret);
    if (redirectUri) body.set('redirect_uri', redirectUri);
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let description = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const parsed = JSON.parse(errorText) as { error_description?: string; error?: string };
        description = parsed.error_description ?? parsed.error ?? description;
      } catch { /* keep HTTP description */ }
      throw new Error(`Google Token Exchange Failed: ${description}`);
    }

    const data = (await response.json()) as GoogleDriveTokenResponse;
    const expiresInMs = (data.expires_in ?? 3600) * 1000;

    const stored: GoogleDriveStoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + expiresInMs,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
    };

    await this.tokenStore.saveTokens(stored);
    return stored;
  }

  /**
   * Refresh an access token using a stored or provided refresh token.
   * Automatically persists the updated tokens in the store.
   */
  async refreshAccessToken(refreshToken?: string): Promise<GoogleDriveStoredTokens> {
    const current = await this.tokenStore.getTokens();
    const tokenToUse = refreshToken ?? current?.refreshToken;

    if (!tokenToUse) {
      throw new Error(
        'Google Refresh Error: No refresh_token available. User must re-authenticate.',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenToUse,
      client_id: this.clientId,
    });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Token Refresh Failed (HTTP ${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as GoogleDriveTokenResponse;
    const expiresInMs = (data.expires_in ?? 3600) * 1000;

    // Google does not re-issue refresh tokens; carry the original one forward
    const updated: GoogleDriveStoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokenToUse,
      expiresAt: Date.now() + expiresInMs,
      tokenType: data.token_type ?? current?.tokenType ?? 'Bearer',
      scope: data.scope ?? current?.scope,
    };

    await this.tokenStore.saveTokens(updated);
    return updated;
  }

  /**
   * Returns a guaranteed-valid access token.
   * If the stored token expires within 2 minutes, it is proactively refreshed.
   * Returns null if no credentials are stored.
   */
  async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.tokenStore.getTokens();
    if (!tokens) return null;

    const TWO_MINUTES_MS = 120_000;
    const isExpiringSoon = tokens.expiresAt <= Date.now() + TWO_MINUTES_MS;

    if (isExpiringSoon && tokens.refreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(tokens.refreshToken);
        return refreshed.accessToken;
      } catch (err) {
        console.warn('[GoogleDriveAuth] Proactive token refresh failed:', err);
        // Return stale token as fallback — the calling service will handle 401
        return tokens.accessToken;
      }
    }

    return tokens.accessToken;
  }

  /**
   * Revoke the current access token at Google's endpoint,
   * then clear all locally stored tokens.
   * Should be called when the user unlinks Google Drive.
   */
  async revokeToken(accessToken?: string): Promise<void> {
    const token = accessToken ?? (await this.getValidAccessToken());
    if (token) {
      try {
        await fetch(`${GOOGLE_OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
          method: 'POST',
        });
      } catch (err) {
        // Revocation failure is non-fatal; tokens expire naturally
        console.warn('[GoogleDriveAuth] Token revocation network error:', err);
      }
    }
    await this.tokenStore.clearTokens();
  }
}
