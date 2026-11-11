/** App interface language (spec 012). Contract: specs/012-app-ui-i18n/contracts/i18n-core-api.md */
export * from './types.js'
export { isUiLanguagePreference, localeTag, resolveUiLanguage } from './language.js'
export { isPendingArea, pendingArea } from './pending.js'
export {
  AREA_IDS,
  CATALOGUES,
  EN_CATALOGUE,
  PENDING_VI_AREAS,
  VI_CATALOGUE,
  type AreaId,
  type CatalogueSet,
  type EnCatalogue,
} from './registry.js'
export {
  createTranslator,
  isPluralMessage,
  setI18nWarningHandler,
  translate,
  type AnyMessageKey,
  type I18nWarning,
  type MessageKey,
  type MessageRef,
  type PluralKey,
  type Translator,
} from './translate.js'
export {
  formatBytes,
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
} from './format.js'
