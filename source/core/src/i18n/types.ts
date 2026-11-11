/**
 * App interface language (spec 012). Types for the typed message catalogues.
 *
 * A catalogue is flat by AREA (`common`, `library`, `reader.chrome`, …); inside an area messages may be grouped in
 * nested objects. A leaf is a `string` or a {@link PluralMessage}. Do not use `zero` / `one` / `other` as group keys:
 * an object whose keys are only those (with `other`) is a plural message.
 */

export type UiLanguage = 'vi' | 'en'
export type UiLanguagePreference = 'system' | UiLanguage

export const UI_LANGUAGES: readonly UiLanguage[] = ['vi', 'en']

/** Forms chosen with `Intl.PluralRules`; `other` is always required (Vietnamese only has `other`). */
export type PluralMessage = {
  readonly zero?: string
  readonly one?: string
  readonly other: string
}

export type Message = string | PluralMessage

export interface AreaMessages {
  readonly [key: string]: Message | AreaMessages
}

/** Values inserted into `{name}` placeholders. They are inserted as text and never re-parsed. */
export type Params = Readonly<Record<string, string | number>>

type IsPlural<T> = T extends { readonly other: string }
  ? Exclude<keyof T, 'zero' | 'one' | 'other'> extends never
    ? true
    : false
  : false

/**
 * The shape another language must give an area: exactly the same keys (use with `satisfies`, which also rejects extra
 * keys), a `string` for each text, a {@link PluralMessage} for each plural.
 */
export type AreaShape<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : IsPlural<T[K]> extends true
      ? PluralMessage
      : AreaShape<T[K]>
}

/** Marker in `catalogue/vi/<area>.ts` for an area not translated yet (the written pending list, FR-015). */
export type PendingArea = { readonly __pendingArea: true; readonly reason: string }

type Join<P extends string, K> = K extends string ? (P extends '' ? K : `${P}.${K}`) : never

/** Dotted paths of every leaf under `T`; `Plural` selects plural leaves only (true) or text leaves only (false). */
export type LeafPaths<T, Plural extends boolean, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? Plural extends false
      ? Join<P, K>
      : never
    : IsPlural<T[K]> extends true
      ? Plural extends true
        ? Join<P, K>
        : never
      : LeafPaths<T[K], Plural, Join<P, K>>
}[keyof T & string]
