import { translate, type AnyMessageKey } from '../../../../../core/src/i18n/translate.js'
import type { Params, UiLanguage } from '../../../../../core/src/i18n/types.js'

/**
 * Language of the cloud-linking messages (spec 012). The connector runs in the renderer, so it cannot use Main's
 * `tMain`; `useLinkedLibraries` sets the interface language here before each link / test / sync.
 */
let language: UiLanguage = 'en'

export function setConnectorLanguage(next: UiLanguage): void {
  language = next
}

export function tConnector(key: AnyMessageKey, params?: Params): string {
  return translate(language, key, params)
}
