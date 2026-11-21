# Data model: Reliable, clear book opening

No database change, no migration, no stored state. Everything below lives in memory (core types + one renderer store).

## Opening (core `app-models/book-opening.ts`, held by `readerOpeningStore`)

| Field | Type | Rule |
|---|---|---|
| `token` | string | new per attempt; answers carrying an older token are ignored (FR-008) |
| `bookId` | string | |
| `title`, `coverUrl` | string \| null | from `getBook`; null until it answers (screen shows the generated cover style + file name) |
| `format` | `epub \| pdf \| txt \| md \| audio` \| null | known once content answers |
| `step` | `content \| prepare \| position \| firstPage` | moves forward only |
| `stepStartedAt` | number | foreground ms clock (paused while hidden) |
| `usesSavedPosition` | boolean | a saved position was found and is being restored |
| `positionRestored` | boolean \| null | false ⇒ the "couldn't return to where you left off" note |
| `retried` | boolean | the one automatic retry of R3 was used |
| `outcome` | `pending \| opened \| left \| failed` | |
| `error` | OpeningError \| null | set with `failed` |

Transitions (pure functions, vitest):

```
start(bookId, now)                   → step content
contentReady(format, now)            → step prepare
contentFailed(code, retryable)       → retry once (if retryable && !retried) | failed(cause)
positionStarted / positionDone(ok)   → step position / back to prepare-complete; ok=false sets positionRestored=false
firstPageDrawn                       → opened
tick(nowForeground)                  → failed(took_too_long) when now - stepStartedAt > STEP_LIMIT_MS (20 000)
leave()                              → left (any time, idempotent)
```

Derived: `showIndicator = outcome==='pending' && foregroundElapsed >= 300`, `showSlowNote = foregroundElapsed >= 5000`,
`stepLine` (message key per step), `actionsFor(error)`.

## OpeningError

| `cause` | When | Actions |
|---|---|---|
| `missing_file` | file moved / deleted | Locate file (Desktop) · "import it again" text (phone) · Back |
| `unreadable` | read failed twice / not retryable | Try again · Back |
| `damaged` | format engine refused the file | Try again · Back |
| `protected` | DRM / encrypted (EPUB `encryption.xml` with font-obfuscation excluded, PDF password) | Back |
| `too_large` | MD limit, Expo Go 20 MB | Back |
| `took_too_long` | step limit | Try again · Open from the beginning (if `usesSavedPosition`) · Back |
| `not_available_offline` | cloud placeholder not downloaded (Desktop) | Try again · Back |

`step` of the error is kept for the message ("while preparing the first page").

## Import (US4) — changes to 016 entities

- **Held pick (Desktop Main)**: `{ path }` — no `expiresAt`; removed by `takePickedFile`, `releasePicks`, or quit; at
  most 500 held.
- **Import fingerprint**: unchanged fields; the "changed" rule becomes size ≠ ⇒ changed; mtime ≠ only ⇒ rehash and
  compare SHA-256.
- **Import failure codes**: add `not_available_offline`; phone `interrupted` reason `pick_again`.
