import { registerAppIpc } from './app.ipc'
import { registerBookIndexIpc } from './book-index.ipc'
import { registerCloudIpc } from './cloud.ipc'
import { registerImportIpc } from './import.ipc'
import { registerLibraryIpc } from './library.ipc'
import { registerNotificationsIpc } from './notifications.ipc'
import { registerOverlayIpc } from './overlay.ipc'
import { registerSearchIpc } from './search.ipc'
import { registerStorageIpc } from './storage.ipc'
import { registerTranslationIpc } from './translation.ipc'
import { registerUpdatesIpc } from './updates.ipc'
import { registerWordCountIpc } from './word-count.ipc'

/** Register all Main-process IPC channel handlers. */
export function registerAllIpcHandlers(): void {
  registerAppIpc()
  registerLibraryIpc()
  registerImportIpc()
  registerOverlayIpc()
  registerCloudIpc()
  registerBookIndexIpc()
  registerSearchIpc()
  registerWordCountIpc()
  registerTranslationIpc()
  registerStorageIpc()
  registerUpdatesIpc()
  registerNotificationsIpc()
}
