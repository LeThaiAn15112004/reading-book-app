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
 * Spec 010 KL-1: the PUBLIC client IDs a packaged build carries in `app.asar/package.json` (`readmateCloudOAuth`,
 * written by electron-builder.store.cjs — Store build only; the NSIS build has none). Never a secret: Dropbox and
 * OneDrive use authorization code + PKCE as public clients. `{}` in development and when absent.
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
 * Which Cloud Sources this build offers (KL-1): Google Drive never in a packaged build ("Coming soon"), and in
 * development only with both its client ID and secret (local file or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 */
export function getCloudProviderAvailability(): CloudProviderAvailabilityDto {
  const file = loadGoogleOAuthCredentials()
  return cloudProviderAvailability({
    isPackaged: app.isPackaged,
    google: {
      clientId: file?.clientId || process.env['GOOGLE_CLIENT_ID'],
      clientSecret: file?.clientSecret || process.env['GOOGLE_CLIENT_SECRET'],
    },
  })
}
