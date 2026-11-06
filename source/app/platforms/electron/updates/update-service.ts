import { app } from 'electron'
import type { UpdateChannelDto, UpdateCheckResultDto } from '../ipc/api-types'

/**
 * Settings → Advanced → Updates.
 *
 * An `UpdateProvider` is a real source of truth for "is there a newer version?" for one
 * distribution channel. None is implemented yet:
 *
 * - Mac App Store: updates are installed by the App Store; macOS exposes no public API for an app
 *   to query its own pending Store update.
 * - Microsoft Store: possible via `Windows.Services.Store.StoreContext`
 *   (`GetAppAndOptionalStorePackageUpdatesAsync`), but that needs a native WinRT bridge this
 *   project does not have.
 * - Direct builds (dmg / nsis / AppImage — what `electron-builder.json5` produces today): no update
 *   server or updater is configured.
 *
 * So `checkForUpdates` honestly reports `unavailable`. It never invents a result.
 */
export interface UpdateProvider {
  readonly id: string
  check(currentVersion: string): Promise<
    { status: 'up-to-date' } | { status: 'update-available'; latestVersion?: string }
  >
}

/** How this running copy was distributed, from Electron's runtime flags. */
export function detectUpdateChannel(): UpdateChannelDto {
  if (process.mas) return 'mac-app-store'
  if (process.windowsStore) return 'microsoft-store'
  return 'direct'
}

/** The provider for a channel, or null when none is implemented (currently: every channel). */
function providerFor(channel: UpdateChannelDto): UpdateProvider | null {
  switch (channel) {
    case 'mac-app-store':
    case 'microsoft-store':
    case 'direct':
      return null
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResultDto> {
  const currentVersion = app.getVersion()
  const channel = detectUpdateChannel()
  const provider = providerFor(channel)
  if (!provider) {
    return { status: 'unavailable', reason: 'no-provider', currentVersion, channel }
  }
  try {
    const result = await provider.check(currentVersion)
    return { ...result, currentVersion, channel }
  } catch (err) {
    console.warn(`[updates] ${provider.id} check failed`, err)
    return { status: 'failed', currentVersion, channel }
  }
}
