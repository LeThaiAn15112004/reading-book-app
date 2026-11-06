/** Typed wrappers for zipImport:* IPC via window.api. */

export const zipImportApi = {
  pick: () => window.api.zipImport.pick(),
  inspectPicked: () => window.api.zipImport.inspectPicked(),
  coverPreview: (input: Parameters<typeof window.api.zipImport.coverPreview>[0]) =>
    window.api.zipImport.coverPreview(input),
  confirm: (input: Parameters<typeof window.api.zipImport.confirm>[0]) => window.api.zipImport.confirm(input),
  discard: (sessionId: string) => window.api.zipImport.discard(sessionId),
  cancelInspect: () => window.api.zipImport.cancelInspect(),
  cancelImport: () => window.api.zipImport.cancelImport(),
  onProgress: (handler: Parameters<typeof window.api.zipImport.onProgress>[0]) =>
    window.api.zipImport.onProgress(handler),
  onInspecting: (handler: Parameters<typeof window.api.zipImport.onInspecting>[0]) =>
    window.api.zipImport.onInspecting(handler),
}
