/** Typed wrappers for cloud:* IPC via window.api. */

export const cloudApi = {
  connect: (provider: Parameters<typeof window.api.cloud.connect>[0]) =>
    window.api.cloud.connect(provider),
  disconnect: (provider: Parameters<typeof window.api.cloud.disconnect>[0]) =>
    window.api.cloud.disconnect(provider),
  getAccessToken: (provider: Parameters<typeof window.api.cloud.getAccessToken>[0]) =>
    window.api.cloud.getAccessToken(provider),
  downloadAndImport: (
    provider: Parameters<typeof window.api.cloud.downloadAndImport>[0],
    entry: Parameters<typeof window.api.cloud.downloadAndImport>[1],
  ) => window.api.cloud.downloadAndImport(provider, entry),
  onDownloadProgress: (
    handler: Parameters<typeof window.api.cloud.onDownloadProgress>[0],
  ) => window.api.cloud.onDownloadProgress(handler),
}
