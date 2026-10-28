import { registerAnnotationTransferIpc } from './annotation-transfer.ipc'
import { registerAppIpc } from './app.ipc'
import { registerAttachmentsIpc } from './attachments.ipc'
import { registerAudioIpc } from './audio.ipc'
import { registerBackgroundIpc } from './background.ipc'
import { registerBookIndexIpc } from './book-index.ipc'
import { registerCloudIpc } from './cloud.ipc'
import { registerGraphicsIpc } from './graphics.ipc'
import { registerImportIpc } from './import.ipc'
import { registerLibraryIpc } from './library.ipc'
import { registerNotificationsIpc } from './notifications.ipc'
import { registerOverlayIpc } from './overlay.ipc'
import { registerSearchIpc } from './search.ipc'
import { registerStorageIpc } from './storage.ipc'
import { registerTranscriptionIpc } from './transcription.ipc'
import { registerTranslationIpc } from './translation.ipc'
import { registerTxtIpc } from './txt.ipc'
import { registerUpdatesIpc } from './updates.ipc'
import { registerWordCountIpc } from './word-count.ipc'
import { registerZipImportIpc } from './zip-import.ipc'

/** Register all Main-process IPC channel handlers. */
export function registerAllIpcHandlers(): void {
  registerAppIpc()
  registerLibraryIpc()
  registerImportIpc()
  registerOverlayIpc()
  registerAnnotationTransferIpc()
  registerAudioIpc()
  registerZipImportIpc()
  registerAttachmentsIpc()
  registerGraphicsIpc()
  registerTxtIpc()
  registerCloudIpc()
  registerBookIndexIpc()
  registerSearchIpc()
  registerWordCountIpc()
  registerTranslationIpc()
  registerTranscriptionIpc()
  registerStorageIpc()
  registerUpdatesIpc()
  registerNotificationsIpc()
  registerBackgroundIpc()
}
