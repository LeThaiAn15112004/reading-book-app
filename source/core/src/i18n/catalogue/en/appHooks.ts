/** English texts of area `appHooks` (spec 012): app-wide hooks and stores in `source/app/hooks/app`. */
export const en = {
  cloud: {
    notConfigured: 'Not configured',
    comingSoon: 'Coming soon',
    connection: {
      connected: { one: 'Connected to {provider}. Found {count} book file.', other: 'Connected to {provider}. Found {count} book files.' },
      failed: '{provider} connection failed: {error}',
      folderLinked: 'Connected to the synced {provider} folder: {path}',
      notConnected: '{provider} is not connected. Sign in, or choose a synced folder on this computer.',
      clientConfigured: '{provider} is set up. Sign in to connect.',
      defaultMode: '{provider} is ready. Sign in to sync from the cloud.',
      syncFailed: '{provider} sync failed: {error}',
      unsupported: '{provider} is not a supported cloud source.',
      untitledFolder: 'Untitled folder',
      unknownFile: 'Unknown file',
    },
  },
} as const
