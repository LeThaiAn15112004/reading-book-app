/** Typed wrappers for import:* IPC via window.api. */

export const importApi = {
  fromFile: () => window.api.import.fromFile(),
  fromUrl: (url: string) => window.api.import.fromUrl(url),
  cancel: () => window.api.import.cancel(),
  onProgress: (handler: Parameters<typeof window.api.import.onProgress>[0]) =>
    window.api.import.onProgress(handler),
}
