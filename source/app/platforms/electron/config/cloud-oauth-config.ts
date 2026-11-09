import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CloudProviderAvailabilityDto } from '../ipc/api-types'
import {
  cloudProviderAvailability,
  embeddedPublicIdsFrom,
  type EmbeddedCloudPublicIds,
} from './cloud-availability-core.mjs'
import { loadGoogleOAuthCredentials } from './google-oauth-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface CloudOAuthSecrets {
  dropbox?: { appKey?: string; appSecret?: string }
  onedrive?: { clientId?: string }
}

function resolveConfigDirectory(): string {
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '..')
  return path.resolve(appRoot, '../../../core/src/config')
}

/**
 * Reads `source/core/src/config/cloud-oauth-secrets.json` — gitignored, local-only file holding the
 * Dropbox app key/secret and OneDrive client ID (see `cloud-oauth-secrets.example.json` for the
 * expected shape). Returns `null` when the file is absent so callers can fall back to the
 * `DROPBOX_APP_KEY`/`DROPBOX_APP_SECRET`/`AZURE_CLIENT_ID` env vars already handled inside
 * `DropboxAuthService`/`OneDriveAuthService`.
 */
function loadCloudOAuthSecrets(): CloudOAuthSecrets | null {
  const secretsPath = path.join(resolveConfigDirectory(), 'cloud-oauth-secrets.json')
  if (!existsSync(secretsPath)) return null

  try {
    return JSON.parse(readFileSync(secretsPath, 'utf8')) as CloudOAuthSecrets
  } catch {
    return null
  }
}

let embeddedIds: EmbeddedCloudPublicIds | null = null

/**
 * Spec 010 KL-1: the OAuth client values a packaged build carries in `app.asar/package.json` (`readmateCloudOAuth`,
 * written by electron-builder.store.cjs — Store build only; the NSIS build has none): the Dropbox app key and Entra ID
 * client ID (public clients, PKCE) and Google's "Desktop app" client ID + client secret (public by Google's
 * installed-app policy). Never the Dropbox app secret. `{}` in development and when absent. Main-only: none of these
 * values is sent to the renderer.
 */
function loadEmbeddedPublicIds(): EmbeddedCloudPublicIds {
  if (embeddedIds) return embeddedIds
  embeddedIds = {}
  if (!app.isPackaged) return embeddedIds
  try {
    embeddedIds = embeddedPublicIdsFrom(JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')))
  } catch {
    // No readable package.json: the env-var fallback inside the auth services still applies.
  }
  return embeddedIds
}

/** Development: the local secrets file. Packaged: the embedded public app key (no secret). */
export function loadDropboxOAuthCredentials(): { appKey?: string; appSecret?: string } | null {
  const secrets = loadCloudOAuthSecrets()
  const dropbox = secrets?.dropbox
  if (dropbox?.appKey || dropbox?.appSecret) return dropbox
  const appKey = loadEmbeddedPublicIds().dropboxAppKey
  return appKey ? { appKey } : null
}

/** Development: the local secrets file. Packaged: the embedded public client ID. */
export function loadOneDriveOAuthCredentials(): { clientId?: string } | null {
  const secrets = loadCloudOAuthSecrets()
  const onedrive = secrets?.onedrive
  if (onedrive?.clientId) return onedrive
  const clientId = loadEmbeddedPublicIds().onedriveClientId
  return clientId ? { clientId } : null
}

/**
 * Google Drive's Desktop-app client. Development: the local client_secret_*.json. Packaged: the embedded client ID +
 * secret (KL-1, decision 2026-11-09), taken together. `null` → GoogleDriveAuthService falls back to GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET.
 */
export function loadGoogleDriveOAuthCredentials(): { clientId: string; clientSecret?: string } | null {
  const file = loadGoogleOAuthCredentials()
  if (file?.clientId) return { clientId: file.clientId, clientSecret: file.clientSecret }
  const { googleClientId, googleClientSecret } = loadEmbeddedPublicIds()
  return googleClientId && googleClientSecret ? { clientId: googleClientId, clientSecret: googleClientSecret } : null
}

/**
 * Which Cloud Sources this build offers (KL-1): Google Drive when its client ID and secret are known (embedded in the
 * Store package, the local file, or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET), else "Not configured".
 */
export function getCloudProviderAvailability(): CloudProviderAvailabilityDto {
  const google = loadGoogleDriveOAuthCredentials()
  return cloudProviderAvailability({
    google: {
      clientId: google?.clientId || process.env['GOOGLE_CLIENT_ID'],
      clientSecret: google?.clientSecret || process.env['GOOGLE_CLIENT_SECRET'],
    },
  })
}