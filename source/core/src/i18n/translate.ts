import type { AreaId, EnCatalogue } from './catalogue/en/index.js'
import { localeTag } from './language.js'
import { isPendingArea } from './pending.js'
import { CATALOGUES, type CatalogueSet } from './registry.js'
import type { LeafPaths, Params, PluralMessage, UiLanguage } from './types.js'

/** Every text key (`area.group.key`) of the English catalogue. */
export type MessageKey = { [A in AreaId]: `${A}.${LeafPaths<EnCatalogue[A], false>}` }[AreaId]
/** Every plural key; these need a numeric `count` param. */
export type PluralKey = { [A in AreaId]: `${A}.${LeafPaths<EnCatalogue[A], true>}` }[AreaId]
export type AnyMessageKey = MessageKey | PluralKey

export type Translator = {
  (key: MessageKey, params?: Params): string
  (key: PluralKey, params: Params & { readonly count: number }): string
}

/** A message produced now but shown later (store errors, toasts): translated at render time. */
export type MessageRef = { readonly key: AnyMessageKey; readonly params?: Params }

export type I18nWarning = { readonly kind: 'missing-key' | 'missing-param'; readonly key: string; readonly param?: string }

// Core has no `console` (R1): the host plugs its logger in. Each warning is reported once.
let warningHandler: ((warning: I18nWarning) => void) | null = null
const reported = new Set<string>()

export function setI18nWarningHandler(handler: ((warning: I18nWarning) => void) | null): void {
  warningHandler = handler
  reported.clear()
}

function warn(warning: I18nWarning): void {
  const id = `${warning.kind}|${warning.key}|${warning.param ?? ''}`
  if (reported.has(id)) return
  reported.add(id)
  warningHandler?.(warning)
}

const pluralRules = new Map<UiLanguage, Intl.PluralRules>()
function pluralRulesFor(lang: UiLanguage): Intl.PluralRules {
  let rules = pluralRules.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(localeTag(lang))
    pluralRules.set(lang, rules)
  }
  return rules
}

export function isPluralMessage(value: unknown): value is PluralMessage {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value)
  return (
    typeof (value as { other?: unknown }).other === 'string' &&
    keys.every((k) => k === 'zero' || k === 'one' || k === 'other')
  )
}

function areaOf(catalogue: Readonly<Record<string, unknown>>, key: string): [string, string] | null {
  // Area ids have one or two segments (`library`, `reader.chrome`); the longest match wins.
  const dot1 = key.indexOf('.')
  if (dot1 <= 0) return null
  const dot2 = key.indexOf('.', dot1 + 1)
  if (dot2 > 0) {
    const two = key.slice(0, dot2)
    if (two in catalogue) return [two, key.slice(dot2 + 1)]
  }
  const one = key.slice(0, dot1)
  return one in catalogue ? [one, key.slice(dot1 + 1)] : null
}

function lookup(catalogue: Readonly<Record<string, unknown>> | undefined, key: string): unknown {
  if (!catalogue) return undefined
  const found = areaOf(catalogue, key)
  if (!found) return undefined
  let node: unknown = catalogue[found[0]]
  if (isPendingArea(node)) return undefined
  for (const part of found[1].split('.')) {
    if (typeof node !== 'object' || node === null || isPluralMessage(node)) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' || isPluralMessage(node) ? node : undefined
}

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

function interpolate(message: string, key: string, params: Params | undefined): string {
  // One pass over the MESSAGE: inserted values are never re-parsed (a title with "{x}" stays literal).
  return message.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params?.[name]
    if (value === undefined) {
      warn({ kind: 'missing-param', key, param: name })
      return ''
    }
    return String(value)
  })
}

function choosePlural(lang: UiLanguage, message: PluralMessage, params: Params | undefined): string {
  const count = Number(params?.count)
  if (!Number.isFinite(count)) return message.other
  if (count === 0 && message.zero !== undefined) return message.zero
  const form = pluralRulesFor(lang).select(count)
  return (form === 'one' ? message.one : form === 'zero' ? message.zero : undefined) ?? message.other
}

/** Lookup against any catalogue set (tests use small hand-made ones). Missing in `lang` → English → ''. */
export function translateFrom(
  catalogues: CatalogueSet,
  lang: UiLanguage,
  key: string,
  params?: Params,
): string {
  const message = lookup(catalogues[lang], key) ?? (lang === 'en' ? undefined : lookup(catalogues.en, key))
  if (message === undefined) {
    warn({ kind: 'missing-key', key })
    return ''
  }
  const text = typeof message === 'string' ? message : choosePlural(lang, message as PluralMessage, params)
  return interpolate(text, key, params)
}

/** Translate one key in `lang` (spec 012 contract `i18n-core-api.md`). Never throws, never returns the raw key. */
export function translate(lang: UiLanguage, key: AnyMessageKey, params?: Params): string {
  return translateFrom(CATALOGUES, lang, key, params)
}

export function createTranslator(lang: UiLanguage): Translator {
  return ((key: AnyMessageKey, params?: Params) => translate(lang, key, params)) as Translator
}
