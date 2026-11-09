# Data model: Translate in every text format

No migration, no new table. One new key in an existing JSON column, one renderer-side value shape.

## Remembered source language (per book, persisted)

| Where | `books.reading_state_json` → key `translationSourceLang` |
|---|---|
| Type | string — a code from the core `TRANSLATION_LANGUAGES` catalog (`findTranslationLanguage(code)` is truthy), e.g. `vi`, `en`, `zh-TW` |
| Absent | the user never chose a source by hand for this book (or cleared it) |
| Written | `translation:setSourceLanguage` → `json_patch` merge (other keys untouched); `null` removes the key |
| Kept by | `overwriteSessionState` (reading-position autosave) copies the stored value into the new JSON |
| Removed | with the `books` row (book removed from the library); never by Reset App Settings (it is not an app preference) |
| Formats | EPUB, PDF, TXT, Markdown. Audiobooks: refused (`invalid_request`) — they have no text to translate |

Validation (Main, on every write): `bookId` non-empty and an existing non-audio book; `code` is `null` or a catalog
code. Anything else → refused, row untouched.

Lifecycle:

```text
(absent) --user picks source / swaps--> code
code     --user picks another source--> code'
code     --book removed--> (row gone)
any      --reading-position autosave--> unchanged
```

## Translation selection (renderer, existing type, unchanged shape)

`TranslationSelection = { text: string; lang: string }` — `text` is the visible selected text in reading order,
`lang` the language hint of the selection (`''` = unknown).

| Format | `lang` source |
|---|---|
| EPUB | nearest `lang` / `xml:lang` attribute of the selection (unchanged) |
| PDF | document catalog `/Lang` (pdf.js `getMetadata().info.Language`), read once per opened document; `''` if absent |
| TXT, Markdown | always `''` |

## Starting source language (derived, core)

`resolveTranslationSource({ remembered, selectionLang, fallback })` → the first of, in order:

1. `remembered` if it is a catalog code;
2. `normalizeTranslationLanguage(selectionLang)` if it maps to a catalog code;
3. `fallback` (today `en`).

Store state (`useTranslationStore`, existing fields): `sourceLang`, `sourceLocked`. After this feature
`sourceLocked === (remembered value present for the current book)`; it is loaded on book change and set by
`setSourceLang` / `swapLanguages`, which also persist it.
