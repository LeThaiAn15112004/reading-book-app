/** Typed wrappers for import:* IPC via api. */

import { api } from '../platforms/api'
export const importApi = {
  fromFile: () => api.import.fromFile(),
  fromUrl: (url: string) => api.import.fromUrl(url),
  cancel: () => api.import.cancel(),
  onProgress: (handler: Parameters<typeof api.import.onProgress>[0]) =>
    api.import.onProgress(handler),
  /** Spec 016: multi-file pick (≤ 50); pick ids only, never paths. */
  pickFiles: () => api.import.pickFiles(),
  /** Spec 016: import one picked file as queue job `jobId`. */
  runJob: (jobId: string, pickId: string) => api.import.runJob({ jobId, pickId }),
  /** Spec 016: cancel the running queue job (refused while saving). */
  cancelJob: (jobId: string) => api.import.cancelJob({ jobId }),
  /** Spec 016: queue size for the Desktop quit confirmation; never throws. */
  reportActivity: async (running: number, waiting: number) => {
    try {
      await api.import.reportActivity({ running, waiting })
    } catch {
      // best effort
    }
  },
  /** Spec 016: Main asks to cancel every import before a confirmed quit. */
  onCancelAll: (handler: () => void) => api.import.onCancelAll(handler),
}
