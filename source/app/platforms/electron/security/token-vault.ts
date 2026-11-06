import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { CloudProviderDto } from '../ipc/api-types'

/** Common shape shared by GoogleDriveStoredTokens / DropboxStoredTokens / OneDriveStoredTokens. */
export interface VaultStoredTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
}

function vaultDir(): string {
  return path.join(app.getPath('userData'), 'cloud-tokens')
}

function vaultFile(provider: CloudProviderDto): string {
  return path.join(vaultDir(), `${provider}.json`)
}

/**
 * Per-provider OAuth token store backed by Electron's OS-level `safeStorage`
 * (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
 *
 * Falls back to a plaintext file (with a console warning) only when the OS
 * has no available encryption backend — never silently drops tokens.
 */
export class SafeStorageTokenStore<T extends VaultStoredTokens> {
  constructor(private readonly provider: CloudProviderDto) {}

  async saveTokens(tokens: T): Promise<void> {
    await fsp.mkdir(vaultDir(), { recursive: true })
    const json = JSON.stringify(tokens)
    const file = vaultFile(this.provider)
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json)
      await fsp.writeFile(file, encrypted)
    } else {
      console.warn(
        `[cloud-sources] OS secure storage unavailable; storing ${this.provider} tokens as plaintext.`,
      )
      await fsp.writeFile(file, `plain:${json}`, 'utf8')
    }
  }

  async getTokens(): Promise<T | null> {
    const file = vaultFile(this.provider)
    if (!fs.existsSync(file)) return null
    try {
      const raw = await fsp.readFile(file)
      const text = raw.toString('utf8')
      if (text.startsWith('plain:')) {
        return JSON.parse(text.slice('plain:'.length)) as T
      }
      if (!safeStorage.isEncryptionAvailable()) return null
      const decrypted = safeStorage.decryptString(raw)
      return JSON.parse(decrypted) as T
    } catch {
      return null
    }
  }

  async clearTokens(): Promise<void> {
    await fsp.rm(vaultFile(this.provider), { force: true })
  }

  async hasValidToken(): Promise<boolean> {
    const tokens = await this.getTokens()
    if (!tokens) return false
    if (tokens.refreshToken) return true
    return tokens.expiresAt > Date.now() + 60_000
  }
}
