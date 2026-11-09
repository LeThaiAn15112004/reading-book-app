# Contract: remembered source language (IPC, Desktop)

Two new channels in the existing `TranslationChannels` group
(`source/app/platforms/electron/ipc/channels.ts`), wired in the four usual places: `channels.ts`,
`ipc/translation.ipc.ts` (Main handler), `preload.ts` + `DesktopApi` in `ipc/api-types.ts`, `bridge/translation.ts`.

## `translation:getSourceLanguage`

```ts
getSourceLanguage(bookId: string): Promise<TranslationSourceResultDto>

type TranslationSourceResultDto =
  | { ok: true; code: string | null }          // null = nothing remembered
  | { ok: false; code: 'invalid_request' | 'not_found' }
```

- `invalid_request`: empty `bookId`, or an audiobook.
- `not_found`: no such book.
- A stored value that is not (or no longer) a catalog code is returned as `null`.

## `translation:setSourceLanguage`

```ts
setSourceLanguage(input: { bookId: string; code: string | null }): Promise<OkResultDto>
// OkResultDto = { ok: true } | { ok: false; code: 'invalid_request' | 'not_found' }
```

- `code` must be `null` (forget) or a catalog code (`findTranslationLanguage`); anything else → `invalid_request`,
  nothing written.
- One `json_patch` statement; no other key of `reading_state_json` changes; `books.updated_at` is NOT bumped
  (it is not a library edit).

## Changed statement: `overwriteSessionState`

Same guard and parameters; the new state additionally keeps the row's current `translationSourceLang`
(absent stays absent). Shared by Desktop and Mobile (`source/core/src/db/overlay/statements.ts`).

## Mobile

The `translation` group already answers `NOT_AVAILABLE_ON_PLATFORM`; the two methods are added to
`platforms/native/bridge/unavailable.ts` the same way so `create-api.ts` still type-checks against `Window['api']`.

## Never

- No path, no book text crosses these channels.
- The renderer never writes `reading_state_json` through any other channel for this value.
