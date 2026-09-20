import {
  MICROSOFT_AUTH_AUTHORITY,
  MICROSOFT_OAUTH_AUTH_URL,
  MICROSOFT_OAUTH_TOKEN_URL,
  ONEDRIVE_DEFAULT_CLIENT_ID,
  ONEDRIVE_DEFAULT_REDIRECT_URI,
  ONEDRIVE_DEFAULT_SCOPES,
  ONEDRIVE_DEFAULT_TENANT_ID,
  type MicrosoftOAuthTokenResponse,
  type OneDriveAppCredentials,
  type OneDriveOAuthUrlOptions,
  type OneDriveStoredTokens,
  type OneDriveTokenExchangeOptions,
} from './types.js';
import {
  createDefaultOneDriveTokenStore,
  type OneDriveTokenStore,
} from './onedrive-token-store.js';

export interface OneDriveAuthServiceOptions {
  credentials?: Partial<OneDriveAppCredentials>;
  tokenStore?: OneDriveTokenStore;
}

/**
 * Generates a cryptographically secure PKCE pair (code_verifier and code_challenge).
 * Uses Web Crypto API when available; compatible across Browser, Electron, React Native, and Node.js.
 */
export async function generateOneDrivePkcePair(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomBytes = new Uint8Array(48);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let codeVerifier = '';
  for (let i = 0; i < randomBytes.length; i++) {
    codeVerifier += chars[(randomBytes[i] ?? 0) % chars.length];
  }

  let codeChallenge = '';
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(codeVerifier);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    const hashArray = new Uint8Array(hashBuffer);
    let binary = '';
    for (let i = 0; i < hashArray.length; i++) {
      binary += String.fromCharCode(hashArray[i] ?? 0);
    }
    codeChallenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } else {
    codeChallenge = btoa(codeVerifier).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  return { codeVerifier, codeChallenge };
}

/**
 * Configuration helper compatible with `@azure/msal-browser` if MSAL is loaded.
 */
export function createMsalConfig(options?: Partial<OneDriveAppCredentials>) {
  const clientId = options?.clientId || ONEDRIVE_DEFAULT_CLIENT_ID;
  const authority = options?.authority || (options?.tenantId
    ? `https://login.microsoftonline.com/${options.tenantId}`
    : MICROSOFT_AUTH_AUTHORITY);
  const redirectUri = options?.redirectUri || (typeof window !== 'undefined' ? window.location.origin : ONEDRIVE_DEFAULT_REDIRECT_URI);

  return {
    auth: {
      clientId,
      authority,
      redirectUri,
      postLogoutRedirectUri: redirectUri,
      navigateToLoginRequestUrl: true,
    },
    cache: {
      cacheLocation: 'localStorage',
      storeAuthStateInCookie: false,
    },
  };
}

/**
 * Service managing Microsoft OAuth 2.0 PKCE authentication flow for OneDrive & Microsoft Graph API.
 * Supports Public Client / Native Applications without a client secret.
 */
export class OneDriveAuthService {
  private readonly clientId: string;
  private readonly tenantId: string;
  private readonly redirectUri: string;
  private readonly authority: string;
  private readonly tokenStore: OneDriveTokenStore;

  constructor(options?: OneDriveAuthServiceOptions) {
    this.clientId = options?.credentials?.clientId
      || (typeof process !== 'undefined' ? process.env['AZURE_CLIENT_ID'] : undefined)
      || ONEDRIVE_DEFAULT_CLIENT_ID;

    // Defaults to '' (no pinned tenant), which routes through the `common` endpoint below and
    // accepts both personal Microsoft accounts (MSA) and work/school (AAD) accounts. Only set
    // via explicit credentials or `AZURE_TENANT_ID` when a deployment truly needs to restrict
    // sign-in to one organization tenant.
    this.tenantId = options?.credentials?.tenantId
      || (typeof process !== 'undefined' ? process.env['AZURE_TENANT_ID'] : undefined)
      || ONEDRIVE_DEFAULT_TENANT_ID;

    this.redirectUri = options?.credentials?.redirectUri
      || ONEDRIVE_DEFAULT_REDIRECT_URI;

    this.authority = options?.credentials?.authority
      || `https://login.microsoftonline.com/${this.tenantId || 'common'}`;

    this.tokenStore = options?.tokenStore ?? createDefaultOneDriveTokenStore();
  }

  getClientId(): string { return this.clientId; }
  getTenantId(): string { return this.tenantId; }
  getRedirectUri(): string { return this.redirectUri; }
  getAuthority(): string { return this.authority; }
  getTokenStore(): OneDriveTokenStore { return this.tokenStore; }

  /**
   * Builds the Microsoft OAuth2 authorization URL for interactive login with PKCE.
   *
   * @param options - Custom url options (scopes, state, PKCE code challenge)
   * @returns Complete authorization URL string
   */
  getAuthorizationUrl(options?: OneDriveOAuthUrlOptions): string {
    const authEndpoint = this.tenantId
      ? `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/authorize`
      : MICROSOFT_OAUTH_AUTH_URL;

    const url = new URL(authEndpoint);
    const clientId = options?.clientId || this.clientId;

    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('redirect_uri', options?.redirectUri || this.redirectUri);

    const scopes = options?.scopes ?? ONEDRIVE_DEFAULT_SCOPES;
    url.searchParams.set('scope', [...scopes].join(' '));

    if (options?.prompt) {
      url.searchParams.set('prompt', options.prompt);
    } else {
      url.searchParams.set('prompt', 'select_account');
    }

    if (options?.state) {
      url.searchParams.set('state', options.state);
    }

    if (options?.codeChallenge) {
      url.searchParams.set('code_challenge', options.codeChallenge);
      url.searchParams.set('code_challenge_method', options.codeChallengeMethod ?? 'S256');
    }

    if (options?.loginHint) {
      url.searchParams.set('login_hint', options.loginHint);
    }

    if (options?.domainHint) {
      url.searchParams.set('domain_hint', options.domainHint);
    }

    return url.toString();
  }

  /**
   * Exchanges an authorization code (returned from the login redirect) for access & refresh tokens.
   * Uses PKCE code_verifier (no client_secret needed for public client).
   *
   * @param options - Exchange options containing authorization code and code verifier
   * @returns Stored tokens object
   */
  async exchangeCodeForTokens(
    options: OneDriveTokenExchangeOptions,
  ): Promise<OneDriveStoredTokens> {
    const { code, codeVerifier } = options;
    const clientId = options.clientId || this.clientId;
    const redirectUri = options.redirectUri || this.redirectUri;
    const scopes = options.scopes ?? ONEDRIVE_DEFAULT_SCOPES;

    if (!code?.trim()) {
      throw new Error('OneDrive OAuth Error: Authorization code is missing.');
    }

    const tokenEndpoint = this.tenantId
      ? `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`
      : MICROSOFT_OAUTH_TOKEN_URL;

    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: code.trim(),
      redirect_uri: redirectUri,
      scope: [...scopes].join(' '),
    });

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }

    const response = await fetch(tokenEndpoint, {
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
      } catch { /* use HTTP description */ }
      throw new Error(`OneDrive Token Exchange Failed: ${description}`);
    }

    const data = (await response.json()) as MicrosoftOAuthTokenResponse;
    const expiresInMs = (data.expires_in ?? 3600) * 1000;

    const stored: OneDriveStoredTokens = {
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
   * Refreshes an expired access token using the stored or provided refresh token.
   *
   * @param refreshToken - Optional explicit refresh token to use
   * @returns Updated stored tokens
   */
  async refreshAccessToken(refreshToken?: string): Promise<OneDriveStoredTokens> {
    const current = await this.tokenStore.getTokens();
    const tokenToUse = refreshToken ?? current?.refreshToken;

    if (!tokenToUse) {
      throw new Error('OneDrive Refresh Error: No refresh_token available. User must re-authenticate.');
    }

    const tokenEndpoint = this.tenantId
      ? `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`
      : MICROSOFT_OAUTH_TOKEN_URL;

    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: tokenToUse,
      scope: [...ONEDRIVE_DEFAULT_SCOPES].join(' '),
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OneDrive Token Refresh Failed (HTTP ${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as MicrosoftOAuthTokenResponse;
    const expiresInMs = (data.expires_in ?? 3600) * 1000;

    const updated: OneDriveStoredTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokenToUse,
      expiresAt: Date.now() + expiresInMs,
      tokenType: data.token_type ?? current?.tokenType ?? 'Bearer',
      scope: data.scope ?? current?.scope,
      accountId: current?.accountId,
      userPrincipalName: current?.userPrincipalName,
    };

    await this.tokenStore.saveTokens(updated);
    return updated;
  }

  /**
   * Acquires a token silently from store, refreshing it automatically if expired or expiring soon.
   *
   * @returns Valid access token or null if not logged in
   */
  async acquireTokenSilent(): Promise<string | null> {
    return this.getValidAccessToken();
  }

  /**
   * Returns a guaranteed-valid access token.
   * Proactively refreshes the token if it expires within 2 minutes.
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
        console.warn('[OneDriveAuth] Proactive token refresh failed:', err);
        return tokens.accessToken;
      }
    }

    return tokens.accessToken;
  }

  /**
   * Logs out the user by clearing locally stored tokens.
   */
  async logout(): Promise<void> {
    await this.tokenStore.clearTokens();
  }
}
