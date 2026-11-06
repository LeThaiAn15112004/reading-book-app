import { ipcMain } from 'electron'
import { cancelTranslation, cancelTranslationsFor, translate } from '../translation/translation-service'
import type { TranslateRequestDto, TranslateResultDto } from './api-types'
import { TranslationChannels } from './channels'

const MAX_ID_LENGTH = 128
const MAX_LANG_LENGTH = 16

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function parseRequest(raw: unknown): TranslateRequestDto | null {
  if (!raw || typeof raw !== 'object') return null
  const { requestId, text, sourceLang, targetLang } = raw as Record<string, unknown>
  if (!isShortString(requestId, MAX_ID_LENGTH) || typeof text !== 'string') return null
  if (!isShortString(sourceLang, MAX_LANG_LENGTH) || !isShortString(targetLang, MAX_LANG_LENGTH)) return null
  return { requestId, text, sourceLang, targetLang }
}

export function registerTranslationIpc(): void {
  const watchedSenders = new WeakSet<Electron.WebContents>()

  ipcMain.handle(
    TranslationChannels.translate,
    async (event, raw: unknown): Promise<TranslateResultDto> => {
      const request = parseRequest(raw)
      if (!request) return { state: 'error', code: 'INVALID_ARGUMENT', message: 'Malformed translate request.' }
      if (!watchedSenders.has(event.sender)) {
        watchedSenders.add(event.sender)
        event.sender.once('destroyed', () => cancelTranslationsFor(event.sender))
      }
      return translate(request, event.sender)
    },
  )

  ipcMain.handle(TranslationChannels.cancel, (_event, requestId: unknown) => {
    if (isShortString(requestId, MAX_ID_LENGTH)) cancelTranslation(requestId)
  })
}
