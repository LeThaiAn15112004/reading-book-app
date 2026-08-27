import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface CloudOAuthSecrets {
  dropbox?: { appKey?: string; appSecret?: string }
  onedrive?: { clientId?: string }
}

function resolveConfigDirectory(): string {
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '..')
  return path.resolve(appRoot, '../../packages/config')
}

/**
 * Reads `packages/config/cloud-oauth-secrets.json` — gitignored, local-only file holding the
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

export function loadDropboxOAuthCredentials(): { appKey?: string; appSecret?: string } | null {
  const secrets = loadCloudOAuthSecrets()
  const dropbox = secrets?.dropbox
  return dropbox?.appKey || dropbox?.appSecret ? dropbox : null
}

export function loadOneDriveOAuthCredentials(): { clientId?: string } | null {
  const secrets = loadCloudOAuthSecrets()
  const onedrive = secrets?.onedrive
  return onedrive?.clientId ? onedrive : null
}
