/** Typed wrappers for cloud:* IPC via api. */

import { api } from '../platforms/api'
export const cloudApi = {
  connect: (provider: Parameters<typeof api.cloud.connect>[0]) =>
    api.cloud.connect(provider),
  disconnect: (provider: Parameters<typeof api.cloud.disconnect>[0]) =>
    api.cloud.disconnect(provider),
  getAccessToken: (provider: Parameters<typeof api.cloud.getAccessToken>[0]) =>
    api.cloud.getAccessToken(provider),
  downloadAndImport: (
    provider: Parameters<typeof api.cloud.downloadAndImport>[0],
    entry: Parameters<typeof api.cloud.downloadAndImport>[1],
  ) => api.cloud.downloadAndImport(provider, entry),
  cancelDownload: (externalId: string) => api.cloud.cancelDownload(externalId),
  onDownloadProgress: (
    handler: Parameters<typeof api.cloud.onDownloadProgress>[0],
  ) => api.cloud.onDownloadProgress(handler),
}
