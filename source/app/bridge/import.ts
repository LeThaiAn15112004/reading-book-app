/** Typed wrappers for import:* IPC via api. */

import { api } from '../platforms/api'
export const importApi = {
  fromFile: () => api.import.fromFile(),
  fromUrl: (url: string) => api.import.fromUrl(url),
  cancel: () => api.import.cancel(),
  onProgress: (handler: Parameters<typeof api.import.onProgress>[0]) =>
    api.import.onProgress(handler),
}
