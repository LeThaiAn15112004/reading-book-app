import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseGoogleOAuthClientConfig,
  type GoogleOAuthClientConfig,
} from '@reading-book/config'

const CLIENT_SECRET_FILE_PATTERN = /^client_secret_.*\.json$/
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveConfigDirectory(): string {
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '..')
  return path.resolve(appRoot, '../../packages/config')
}

function findClientSecretPath(): string | null {
  const configDirectory = resolveConfigDirectory()
  if (!existsSync(configDirectory)) {
    return null
  }

  const match = readdirSync(configDirectory)
    .filter((name) => CLIENT_SECRET_FILE_PATTERN.test(name))
    .sort()[0]

  return match ? path.join(configDirectory, match) : null
}

export function loadGoogleOAuthClientConfig(): GoogleOAuthClientConfig | null {
  const secretPath = findClientSecretPath()
  if (!secretPath) {
    return null
  }

  try {
    const raw = JSON.parse(readFileSync(secretPath, 'utf8')) as unknown
    return parseGoogleOAuthClientConfig(raw)
  } catch {
    return null
  }
}

/**
 * Main-process-only credentials for the Cloud Sources OAuth code exchange.
 * Unlike `loadGoogleOAuthClientConfig`, this retains the client secret — it
 * must never be sent to the renderer or logged.
 */
export function loadGoogleOAuthCredentials(): {
  clientId: string
  clientSecret?: string
  redirectUris: readonly string[]
} | null {
  const secretPath = findClientSecretPath()
  if (!secretPath) return null

  try {
    const raw = JSON.parse(readFileSync(secretPath, 'utf8')) as {
      installed?: { client_id?: string; client_secret?: string; redirect_uris?: string[] }
      web?: { client_id?: string; client_secret?: string; redirect_uris?: string[] }
    }
    const source = raw.installed ?? raw.web
    if (!source?.client_id) return null
    return {
      clientId: source.client_id,
      clientSecret: source.client_secret,
      redirectUris: source.redirect_uris ?? [],
    }
  } catch {
    return null
  }
}
