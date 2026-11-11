/** Vietnamese catalogue: one module per area (spec 012). Generated layout — add an area here AND in the other language. */
import type { AreaShape, PendingArea } from '../../types.js'
import type { EnCatalogue } from '../en/index.js'
import { vi as common } from './common.js'
import { vi as chrome } from './chrome.js'
import { vi as library } from './library.js'
import { vi as importArea } from './import.js'
import { vi as settings } from './settings.js'
import { vi as readerChrome } from './reader-chrome.js'
import { vi as readerSidebar } from './reader-sidebar.js'
import { vi as readerAnnotations } from './reader-annotations.js'
import { vi as readerTools } from './reader-tools.js'
import { vi as readerPdf } from './reader-pdf.js'
import { vi as readerText } from './reader-text.js'
import { vi as readerPhone } from './reader-phone.js'
import { vi as readerLogic } from './reader-logic.js'
import { vi as audiobookPlayer } from './audiobook-player.js'
import { vi as audiobookTranscription } from './audiobook-transcription.js'
import { vi as appHooks } from './appHooks.js'
import { vi as mainMessages } from './main-messages.js'
import { vi as mainShell } from './main-shell.js'
import { vi as exportsArea } from './exports.js'

export const VI_CATALOGUE = {
  common: common,
  chrome: chrome,
  library: library,
  'import': importArea,
  settings: settings,
  'reader.chrome': readerChrome,
  'reader.sidebar': readerSidebar,
  'reader.annotations': readerAnnotations,
  'reader.tools': readerTools,
  'reader.pdf': readerPdf,
  'reader.text': readerText,
  'reader.phone': readerPhone,
  'reader.logic': readerLogic,
  'audiobook.player': audiobookPlayer,
  'audiobook.transcription': audiobookTranscription,
  appHooks: appHooks,
  'main.messages': mainMessages,
  'main.shell': mainShell,
  exports: exportsArea,
} as const satisfies { readonly [A in keyof EnCatalogue]: AreaShape<EnCatalogue[A]> | PendingArea }
