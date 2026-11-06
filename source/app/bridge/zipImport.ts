/** Typed wrappers for zipImport:* IPC via api. */

import { api } from '../platforms/api'
export const zipImportApi = {
  pick: () => api.zipImport.pick(),
  inspectPicked: () => api.zipImport.inspectPicked(),
  coverPreview: (input: Parameters<typeof api.zipImport.coverPreview>[0]) =>
    api.zipImport.coverPreview(input),
  confirm: (input: Parameters<typeof api.zipImport.confirm>[0]) => api.zipImport.confirm(input),
  discard: (sessionId: string) => api.zipImport.discard(sessionId),
  cancelInspect: () => api.zipImport.cancelInspect(),
  cancelImport: () => api.zipImport.cancelImport(),
  onProgress: (handler: Parameters<typeof api.zipImport.onProgress>[0]) =>
    api.zipImport.onProgress(handler),
  onInspecting: (handler: Parameters<typeof api.zipImport.onInspecting>[0]) =>
    api.zipImport.onInspecting(handler),
}
