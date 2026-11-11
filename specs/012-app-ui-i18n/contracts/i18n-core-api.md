# Contract: core i18n API (`source/core/src/i18n/`, exported from `@core`)

Pure TypeScript, no import outside `src` (R1–R3). Used by the renderer, Electron Main and core itself.

```ts
export type UiLanguage = 'vi' | 'en'
export type UiLanguagePreference = 'system' | UiLanguage

export function resolveUiLanguage(pref: UiLanguagePreference, deviceLocales: readonly string[]): UiLanguage
export function localeTag(lang: UiLanguage): 'vi-VN' | 'en-US'

export type MessageKey = /* every leaf path of the English catalogue */
export type Params = Readonly<Record<string, string | number>>

/** Translate one key. Missing in `lang` → the English text. Keys are typed, so an unknown key is a compile error;
 *  if one still arrives at runtime (e.g. a MessageRef from an older build), it logs once and returns '' — never the
 *  raw key. */
export function translate(lang: UiLanguage, key: MessageKey, params?: Params): string
/** Bound form: `const t = createTranslator('vi'); t('library.title')`. */
export function createTranslator(lang: UiLanguage): Translator
export type Translator = (key: MessageKey, params?: Params) => string

// Plurals: a PluralMessage is chosen with Intl.PluralRules(localeTag(lang)).select(Number(params.count)).
// `count` is REQUIRED for a plural key (type error otherwise).

// Formatters (cached Intl instances per language)
export function formatDate(lang: UiLanguage, value: Date | number, style?: 'short' | 'medium' | 'long'): string
export function formatDateTime(lang: UiLanguage, value: Date | number): string
export function formatNumber(lang: UiLanguage, value: number, maxFractionDigits?: number): string
export function formatPercent(lang: UiLanguage, ratio0to1: number): string
export function formatBytes(lang: UiLanguage, bytes: number): string          // '1.5 MB' / '1,5 MB'
export function formatDuration(lang: UiLanguage, seconds: number, style: 'clock' | 'long'): string

// Catalogue registry (for tests and tools)
export const EN_CATALOGUE: Catalogue
export const VI_CATALOGUE: Partial<Catalogue>   // areas present are complete by type
export const PENDING_VI_AREAS: readonly { area: AreaId; reason: string }[]   // derived from pendingArea() markers
export function pendingArea(reason: string): PendingArea
```

Guarantees

- `translate` never throws and never returns an unfilled placeholder: a missing param is a type error; if one is
  still missing at runtime it is replaced by `''` and logged once.
- Output is plain text. Escaping is the caller's renderer's job (React escapes by default).
- Same inputs → same output in renderer and Main (same module).

Rule for NEW IPC results (from this feature on): carry a machine code + params; the renderer translates. Existing
`errorMessage` strings are produced by Main in its current language (research R6).
