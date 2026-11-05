export type GoogleOAuthClientType = 'installed' | 'web';

export interface GoogleOAuthClientConfig {
  readonly clientType: GoogleOAuthClientType;
  readonly clientId: string;
  readonly projectId?: string;
  readonly authUri?: string;
  readonly tokenUri?: string;
  readonly authProviderCertUrl?: string;
  readonly redirectUris: readonly string[];
  readonly scopes: readonly string[];
  /**
   * The local Google client_secret file contains this value, but it must stay
   * in the main process and must not be exposed to the renderer or committed.
   */
  readonly hasClientSecret: boolean;
}

export const GOOGLE_BOOK_SYNC_SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function parseGoogleOAuthClientConfig(
  raw: unknown,
): GoogleOAuthClientConfig | null {
  const root = asRecord(raw);
  if (!root) {
    return null;
  }

  const installed = asRecord(root.installed);
  const web = asRecord(root.web);
  const clientType: GoogleOAuthClientType | null = installed ? 'installed' : web ? 'web' : null;
  const source = installed ?? web;
  if (!source || !clientType) {
    return null;
  }

  const clientId = asString(source.client_id);
  if (!clientId) {
    return null;
  }

  return {
    clientType,
    clientId,
    projectId: asString(source.project_id),
    authUri: asString(source.auth_uri),
    tokenUri: asString(source.token_uri),
    authProviderCertUrl: asString(source.auth_provider_x509_cert_url),
    redirectUris: asStringArray(source.redirect_uris),
    scopes: GOOGLE_BOOK_SYNC_SCOPES,
    hasClientSecret: Boolean(asString(source.client_secret)),
  };
}
