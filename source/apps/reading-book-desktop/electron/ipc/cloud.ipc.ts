import { ipcMain, shell, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DropboxAuthService,
  DropboxDownloadService,
  generatePkcePair as generateDropboxPkcePair,
  type DropboxStoredTokens,
} from '../../../book-reader-sdk/host-adapters/services/dropbox/index.js'
import {
  GoogleDriveAuthService,
  GoogleDriveDownloadService,
  generateGoogleDrivePkcePair,
  type GoogleDriveStoredTokens,
} from '../../../book-reader-sdk/host-adapters/services/google-drive/index.js'
import {
  OneDriveAuthService,
  OneDriveDownloadService,
  generateOneDrivePkcePair,
  type OneDriveStoredTokens,
} from '../../../book-reader-sdk/host-adapters/services/onedrive/index.js'
import type { DownloadProgressListener } from '../../../book-reader-sdk/host-adapters/services/download-progress.js'
import { GOOGLE_OAUTH_LOOPBACK_REDIRECT_URI, OAUTH_REDIRECT_URI } from '@reading-book/config'
import { loadDropboxOAuthCredentials, loadOneDriveOAuthCredentials } from '../config/cloud-oauth-config'
import { loadGoogleOAuthCredentials } from '../config/google-oauth-config'
import { assertSupportedExtension, UnsupportedFormatError } from '../files/format-guard'
import { sanitizeFilename } from '../files/metadata-filename'
import { copyIntoBooksSandbox } from '../files/sandbox'
import { openGoogleOAuthViaLoopback } from '../oauth/google-loopback-server'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { SafeStorageTokenStore } from '../security/token-vault'
import { finishImportAfterCopy, rejectIfDuplicate } from './import.ipc'
import type {
  CloudCatalogEntryDto,
  CloudConnectResult,
  CloudDownloadProgressDto,
  CloudDownloadResult,
  CloudProviderDto,
  OkResult,
} from './api-types'
import { CloudChannels } from './channels'

/**
 * Fixed custom-scheme redirect URI, shared with the mobile app (see
 * `packages/config/oauth-redirect.ts`). Register this exact URI in the Dropbox/OneDrive OAuth app
 * consoles. The consent flow runs in the system browser (`shell.openExternal`); the OS hands
 * control back to this app via the `readmate-reader://` scheme registered in
 * `electron-builder.json5`, and `main.ts` forwards the callback URL to `handleOAuthCallbackUrl`
 * below.
 *
 * Google Drive does NOT use this — its "Desktop app" OAuth client type rejects custom URI scheme
 * redirects (`Error 400: invalid_request`). It uses the loopback flow in
 * `../oauth/google-loopback-server.ts` instead, via `GOOGLE_OAUTH_LOOPBACK_REDIRECT_URI`.
 */
const REDIRECT_URI = OAUTH_REDIRECT_URI

/** Resolvers for connect() calls awaiting their OAuth deep-link callback, keyed by `state`. */
const pendingAuths = new Map<
  string,
  (value: { code: string; state?: string } | { error: string }) => void
>()

const OAUTH_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000

function isCloudProvider(value: unknown): value is CloudProviderDto {
  return value === 'google_drive' || value === 'dropbox' || value === 'onedrive'
}

interface CloudKit {
  getAuthorizationUrl(state: string, codeChallenge: string): string
  exchangeCode(code: string, codeVerifier: string): Promise<void>
  getValidAccessToken(): Promise<string | null>
  revoke(): Promise<void>
  downloadToFile(
    accessToken: string,
    remoteId: string,
    localPath: string,
    onProgress?: DownloadProgressListener,
  ): Promise<void>
}

function buildGoogleDriveKit(): CloudKit {
  const creds = loadGoogleOAuthCredentials()
  const authService = new GoogleDriveAuthService({
    credentials: creds ? { clientId: creds.clientId, clientSecret: creds.clientSecret } : undefined,
    tokenStore: new SafeStorageTokenStore<GoogleDriveStoredTokens>('google_drive'),
  })
  const downloadService = new GoogleDriveDownloadService()
  return {
    // Google's Desktop-app OAuth client policy rejects custom URI scheme redirects — this must be
    // the loopback URI caught by `openGoogleOAuthViaLoopback` below, not the shared `REDIRECT_URI`.
    getAuthorizationUrl: (state, codeChallenge) =>
      authService.getAuthorizationUrl({
        redirectUri: GOOGLE_OAUTH_LOOPBACK_REDIRECT_URI,
        state,
        codeChallenge,
        accessType: 'offline',
        prompt: 'consent',
      }),
    exchangeCode: async (code, codeVerifier) => {
      await authService.exchangeCodeForTokens({
        code,
        redirectUri: GOOGLE_OAUTH_LOOPBACK_REDIRECT_URI,
        codeVerifier,
      })
    },
    getValidAccessToken: () => authService.getValidAccessToken(),
    revoke: () => authService.revokeToken(),
    downloadToFile: async (accessToken, remoteId, localPath, onProgress) => {
      await downloadService.downloadToFile(accessToken, remoteId, localPath, onProgress)
    },
  }
}

function buildDropboxKit(): CloudKit {
  const creds = loadDropboxOAuthCredentials()
  const authService = new DropboxAuthService({
    credentials: creds ?? undefined,
    tokenStore: new SafeStorageTokenStore<DropboxStoredTokens>('dropbox'),
  })
  const downloadService = new DropboxDownloadService()
  return {
    getAuthorizationUrl: (state, codeChallenge) =>
      authService.getAuthorizationUrl({
        redirectUri: REDIRECT_URI,
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        tokenAccessType: 'offline',
      }),
    exchangeCode: async (code, codeVerifier) => {
      await authService.exchangeCodeForTokens({ code, redirectUri: REDIRECT_URI, codeVerifier })
    },
    getValidAccessToken: () => authService.getValidAccessToken(),
    revoke: () => authService.revokeToken(),
    downloadToFile: async (accessToken, remoteId, localPath, onProgress) => {
      await downloadService.downloadToFile(accessToken, remoteId, localPath, onProgress)
    },
  }
}

function buildOneDriveKit(): CloudKit {
  // No `tenantId` is passed here: `OneDriveAuthService` defaults to the `common` OAuth endpoint,
  // which accepts personal Microsoft accounts (@outlook.com, @hotmail.com, @live.com) as well as
  // work/school accounts, instead of forcing sign-in through one fixed organization tenant. This
  // requires the app registration in Entra ID to allow "Accounts in any organizational directory
  // and personal Microsoft accounts" (see `docs/software/SDS.md` for the OneDrive setup notes).
  const creds = loadOneDriveOAuthCredentials()
  const authService = new OneDriveAuthService({
    credentials: { redirectUri: REDIRECT_URI, ...creds },
    tokenStore: new SafeStorageTokenStore<OneDriveStoredTokens>('onedrive'),
  })
  const downloadService = new OneDriveDownloadService()
  return {
    getAuthorizationUrl: (state, codeChallenge) =>
      authService.getAuthorizationUrl({ redirectUri: REDIRECT_URI, state, codeChallenge, codeChallengeMethod: 'S256' }),
    exchangeCode: async (code, codeVerifier) => {
      await authService.exchangeCodeForTokens({ code, redirectUri: REDIRECT_URI, codeVerifier })
    },
    getValidAccessToken: () => authService.getValidAccessToken(),
    revoke: () => authService.logout(),
    downloadToFile: async (accessToken, remoteId, localPath, onProgress) => {
      await downloadService.downloadToFile(accessToken, remoteId, localPath, onProgress)
    },
  }
}

let kits: Record<CloudProviderDto, CloudKit> | null = null

/** Lazily built so `app.getPath('userData')` (used by the token vault) is only touched after `app.whenReady()`. */
function getKits(): Record<CloudProviderDto, CloudKit> {
  if (!kits) {
    kits = {
      google_drive: buildGoogleDriveKit(),
      dropbox: buildDropboxKit(),
      onedrive: buildOneDriveKit(),
    }
  }
  return kits
}

const pkceGenerators: Record<CloudProviderDto, () => Promise<{ codeVerifier: string; codeChallenge: string }>> = {
  google_drive: generateGoogleDrivePkcePair,
  dropbox: generateDropboxPkcePair,
  onedrive: generateOneDrivePkcePair,
}

/**
 * Opens the provider's consent screen in the system browser and waits for the OS to hand the
 * `readmate-reader://` callback back to `handleOAuthCallbackUrl` (routed there from `main.ts`'s
 * `open-url` / `second-instance` handlers). Times out so a closed/abandoned browser tab can't leak
 * a pending promise forever.
 */
function openOAuthExternal(
  authUrl: string,
  state: string,
): Promise<{ code: string; state?: string } | { error: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAuths.delete(state)
      resolve({ error: 'Sign-in timed out. Please try connecting again.' })
    }, OAUTH_CALLBACK_TIMEOUT_MS)

    pendingAuths.set(state, (value) => {
      clearTimeout(timer)
      resolve(value)
    })

    shell.openExternal(authUrl).catch(() => {
      clearTimeout(timer)
      pendingAuths.delete(state)
      resolve({ error: 'Could not open the system browser to sign in.' })
    })
  })
}

/**
 * Routes a `readmate-reader://oauth/callback` URL delivered via `open-url` (macOS) or
 * `second-instance` (Windows/Linux) back to the `connect()` call awaiting it. Returns whether the
 * URL was a recognized, still-pending OAuth callback, so `main.ts` can decide whether to also treat
 * it as some other kind of deep link in the future.
 */
export function handleOAuthCallbackUrl(url: string): boolean {
  if (!url.startsWith(REDIRECT_URI)) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const state = parsed.searchParams.get('state')
  const resolve = state ? pendingAuths.get(state) : undefined
  if (!state || !resolve) return false
  pendingAuths.delete(state)

  const error = parsed.searchParams.get('error')
  if (error) {
    resolve({ error: parsed.searchParams.get('error_description') ?? error })
    return true
  }

  const code = parsed.searchParams.get('code')
  if (!code) {
    resolve({ error: 'No authorization code returned.' })
    return true
  }

  resolve({ code, state })
  return true
}

async function connect(provider: CloudProviderDto): Promise<CloudConnectResult> {
  const kit = getKits()[provider]
  const state = randomUUID()
  const { codeVerifier, codeChallenge } = await pkceGenerators[provider]()
  const authUrl = kit.getAuthorizationUrl(state, codeChallenge)

  // Google Drive: loopback HTTP server (RFC 8252) — required by its Desktop-app OAuth policy.
  // Dropbox / OneDrive: OS deep link back through the `readmate-reader://` custom scheme.
  const result =
    provider === 'google_drive'
      ? await openGoogleOAuthViaLoopback(authUrl, state, OAUTH_CALLBACK_TIMEOUT_MS)
      : await openOAuthExternal(authUrl, state)
  if ('error' in result) {
    return { ok: false, errorMessage: result.error }
  }

  try {
    await kit.exchangeCode(result.code, codeVerifier)
    return { ok: true }
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) }
  }
}

async function disconnect(provider: CloudProviderDto): Promise<OkResult> {
  await getKits()[provider].revoke()
  return { ok: true }
}

async function getAccessToken(provider: CloudProviderDto): Promise<string | null> {
  return getKits()[provider].getValidAccessToken()
}

/** The raw id/path each provider's download API expects, recovered from the catalog entry. */
function remoteIdFor(provider: CloudProviderDto, entry: CloudCatalogEntryDto): string {
  if (provider === 'dropbox' && entry.downloadUrl) {
    return entry.downloadUrl
  }
  if (provider === 'google_drive') {
    if (entry.externalId.startsWith('google_drive_')) {
      return entry.externalId.slice('google_drive_'.length)
    }
    if (entry.externalId.startsWith('gdrive_')) {
      return entry.externalId.slice('gdrive_'.length)
    }
    return entry.externalId
  }

  const prefix = `${provider}_`
  return entry.externalId.startsWith(prefix)
    ? entry.externalId.slice(prefix.length)
    : entry.externalId
}

/**
 * Sends progress ticks back to the requesting window; a no-op once it's gone.
 * Falls back to the catalog entry's `fileSizeBytes` (already fetched from the
 * provider's metadata during sync) when the download response has no
 * `Content-Length`, so the ring can stay determinate even then.
 */
function progressSenderFor(
  sender: WebContents,
  provider: CloudProviderDto,
  entry: CloudCatalogEntryDto,
): DownloadProgressListener {
  const fallbackTotal =
    entry.fileSizeBytes != null && entry.fileSizeBytes > 0 ? entry.fileSizeBytes : null
  return (receivedBytes, totalBytes) => {
    if (sender.isDestroyed()) return
    const payload: CloudDownloadProgressDto = {
      externalId: entry.externalId,
      sourceProvider: provider,
      receivedBytes,
      totalBytes: totalBytes ?? fallbackTotal,
    }
    sender.send(CloudChannels.downloadProgress, payload)
  }
}

async function downloadAndImport(
  provider: CloudProviderDto,
  entry: CloudCatalogEntryDto,
  sender: WebContents,
): Promise<CloudDownloadResult> {
  const store = getLibraryStore()
  const existing = await store.findByProviderAndExternalId(provider, entry.externalId)
  if (existing) {
    return { ok: true, bookId: existing.id }
  }

  // Folder-scan / sample-mode entries already point at a real file on disk.
  if (entry.localPath) {
    try {
      assertSupportedExtension(entry.localPath)
      const conflict = await rejectIfDuplicate(entry.localPath)
      if (conflict) return conflict
      const destPath = await copyIntoBooksSandbox(entry.localPath)
      return await finishImportAfterCopy(destPath, {
        sourceProvider: provider,
        externalId: entry.externalId,
      })
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        return { ok: false, bookId: null, errorCode: err.code, errorMessage: err.message }
      }
      return {
        ok: false,
        bookId: null,
        errorCode: 'copy_failed',
        errorMessage: 'Could not read the linked local file. It may not exist on disk.',
      }
    }
  }

  const kit = getKits()[provider]
  const accessToken = await kit.getValidAccessToken()
  if (!accessToken) {
    return {
      ok: false,
      bookId: null,
      errorMessage: 'Not connected to this cloud source. Connect it first.',
    }
  }

  const ext = entry.formatHint?.replace(/^\./, '')
  if (!ext) {
    return {
      ok: false,
      bookId: null,
      errorCode: 'unsupported_format',
      errorMessage: 'Unknown file format.',
    }
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reading-book-cloud-'))
  const safeName = sanitizeFilename(entry.title)
  const tempPath = path.join(tempDir, `${safeName}.${ext}`)
  try {
    await kit.downloadToFile(
      accessToken,
      remoteIdFor(provider, entry),
      tempPath,
      progressSenderFor(sender, provider, entry),
    )
    assertSupportedExtension(tempPath)
    const conflict = await rejectIfDuplicate(tempPath)
    if (conflict) return conflict
    const destPath = await copyIntoBooksSandbox(tempPath)
    return await finishImportAfterCopy(destPath, {
      sourceProvider: provider,
      externalId: entry.externalId,
    })
  } catch (err) {
    if (err instanceof UnsupportedFormatError) {
      return { ok: false, bookId: null, errorCode: err.code, errorMessage: err.message }
    }
    return {
      ok: false,
      bookId: null,
      errorCode: 'network',
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Handlers for cloud:* — OAuth connect/disconnect + lazy download-to-import. */
export function registerCloudIpc(): void {
  ipcMain.removeHandler(CloudChannels.connect)
  ipcMain.handle(
    CloudChannels.connect,
    (_event, provider: unknown): Promise<CloudConnectResult> =>
      isCloudProvider(provider)
        ? connect(provider)
        : Promise.resolve({ ok: false, errorMessage: 'Unknown cloud provider.' }),
  )

  ipcMain.removeHandler(CloudChannels.disconnect)
  ipcMain.handle(
    CloudChannels.disconnect,
    (_event, provider: unknown): Promise<OkResult> =>
      isCloudProvider(provider) ? disconnect(provider) : Promise.resolve({ ok: false }),
  )

  ipcMain.removeHandler(CloudChannels.getAccessToken)
  ipcMain.handle(
    CloudChannels.getAccessToken,
    (_event, provider: unknown): Promise<string | null> =>
      isCloudProvider(provider) ? getAccessToken(provider) : Promise.resolve(null),
  )

  ipcMain.removeHandler(CloudChannels.downloadAndImport)
  ipcMain.handle(
    CloudChannels.downloadAndImport,
    (event, provider: unknown, entry: unknown): Promise<CloudDownloadResult> => {
      if (!isCloudProvider(provider) || !entry || typeof entry !== 'object') {
        return Promise.resolve({ ok: false, bookId: null, errorMessage: 'Invalid request.' })
      }
      return downloadAndImport(provider, entry as CloudCatalogEntryDto, event.sender)
    },
  )
}
