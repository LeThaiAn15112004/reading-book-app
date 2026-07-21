import { registerAppIpc } from './app.ipc'
import { registerImportIpc } from './import.ipc'
import { registerLibraryIpc } from './library.ipc'
import { registerOverlayIpc } from './overlay.ipc'

/** Register all Main-process IPC channel handlers. */
export function registerAllIpcHandlers(): void {
  registerAppIpc()
  registerLibraryIpc()
  registerImportIpc()
  registerOverlayIpc()
}
