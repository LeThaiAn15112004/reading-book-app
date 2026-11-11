# Data Model: App interface in Vietnamese and English (i18n)

No SQLite change, no migration. All entities are either an existing preference, a Main-owned JSON mirror, or
compile-time data (catalogues) bundled with the app.

## AppLanguage (preference) — existing, unchanged

| Field | Type | Notes |
|---|---|---|
| `language` | `'system' \| 'vi' \| 'en'` | in `reading-book.app-appearance.v1` (renderer localStorage), default `'system'` |

- Parsed by `loadAppAppearance` (unknown value → default). Reset App Settings → `'system'`.
- Every change goes through `useAppAppearanceStore.setLanguage` (also used by `reset()`), which now also updates
  the i18n store and sends `app:setUiLanguage`.

## UiLanguage (effective language) — new, derived

`'vi' | 'en'` = `resolveUiLanguage(preference, deviceLocales)`:

| preference | deviceLocales | result |
|---|---|---|
| `vi` | any | `vi` |
| `en` | any | `en` |
| `system` | first entry starts with `vi` (case-insensitive: `vi`, `vi-VN`) | `vi` |
| `system` | anything else, empty, or unreadable | `en` |

Locale tag used for `Intl`: `vi` → `vi-VN`, `en` → `en-US`. Re-evaluated at start and on every preference change,
not on OS language change while running.

## Main UI-language mirror — new

File `{userData}/ui-language.json`, written atomically by `json-prefs-file.ts`:

```json
{ "version": 1, "preference": "system" }
```

- Missing / unreadable / invalid → `{ preference: 'system' }`. Main resolves it with
  `app.getPreferredSystemLanguages()`.
- Written only by the `app:setUiLanguage` handler. It is a mirror: the renderer's localStorage stays the source of
  truth and re-sends at every boot, so a stale mirror self-heals.

## Catalogue — new, compile-time

```
Catalogue<L>      = { [area: AreaId]: AreaMessages }
AreaMessages      = { [key: string]: Message | AreaMessages }     // nested groups allowed
Message           = string | PluralMessage
PluralMessage     = { one?: string; other: string; zero?: string } // forms per Intl.PluralRules
MessageKey        = dotted path, e.g. 'library.empty.title'        // typed from the English catalogue
Params            = Record<string, string | number>
```

Rules (enforced by types + `tests/i18n/*`):

- English is complete and is the type source (`MessageKey` = all leaf paths of `en`).
- A Vietnamese area, when present, has **exactly** the English keys (`satisfies`), same placeholder set per key, no
  empty string. Vietnamese plural messages give `other` (Vietnamese has only `other`); English gives `one` + `other`.
- Placeholders are `{name}` (ASCII identifier). A message never contains HTML; rich segments use `<tag>…</tag>` slot
  markers resolved by `<TransText>` (see contract).
- Values inserted into a message are never re-parsed (a title containing `{x}` or `<b>` is shown literally).

## PendingViAreas — new

`PENDING_VI_AREAS: readonly AreaId[]` with a one-line reason per entry. Invariant: every English area is in exactly
one of `vi` or `PENDING_VI_AREAS`. Release condition: empty (release-gate test).

## MessageRef — new (renderer state)

`{ key: MessageKey; params?: Params }` — for state that is rendered later than it is produced (store errors, toasts,
job results), so it is shown in the language current at render time.

## Glossary — new, documentation + anchor test

Term list in [contracts/glossary.md](contracts/glossary.md); a few anchor keys tested against it.

## ReadableMarkdownLabels — new (core parameter)

Typed object of the fixed headings `buildReadableMarkdown` writes (chapter / page / section / notes / attachment
labels, date line). Built from the catalogue for Main's current language at export time.
