/** English catalogue: one module per area (spec 012). Generated layout — add an area here AND in the other language. */
import { en as common } from './common.js'
import { en as chrome } from './chrome.js'
import { en as library } from './library.js'
import { en as importArea } from './import.js'
import { en as settings } from './settings.js'
import { en as readerChrome } from './reader-chrome.js'
import { en as readerSidebar } from './reader-sidebar.js'
import { en as readerAnnotations } from './reader-annotations.js'
import { en as readerTools } from './reader-tools.js'
import { en as readerPdf } from './reader-pdf.js'
import { en as readerText } from './reader-text.js'
import { en as readerPhone } from './reader-phone.js'
import { en as readerLogic } from './reader-logic.js'
import { en as audiobookPlayer } from './audiobook-player.js'
import { en as audiobookTranscription } from './audiobook-transcription.js'
import { en as appHooks } from './appHooks.js'
import { en as mainMessages } from './main-messages.js'
import { en as mainShell } from './main-shell.js'
import { en as exportsArea } from './exports.js'

export const EN_CATALOGUE = {
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
} as const

export type EnCatalogue = typeof EN_CATALOGUE
export type AreaId = keyof EnCatalogue
