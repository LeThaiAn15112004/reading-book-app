/** Typed wrappers for import:* IPC via window.api. */

export const importApi = {
  fromFile: () => window.api.import.fromFile(),
  fromUrl: (url: string) => window.api.import.fromUrl(url),
}
