# Data model: Reliable, clear book opening

No database change, no migration, no stored state. Everything below lives in memory (core types + one renderer store).

## Opening (core `app-models/book-opening.ts`, held by `readerOpeningStore`)

| Field | Type | Rule |
|---|---|---|
| `token` | string | new per attempt; answers carrying an older token are ignored (FR-008) |
| `bookId` | string | |
| `title`, `coverUrl` | string \| null | from `getBook`; null until it answers (screen shows the generated cover style + file name) |
| `format` | `epub \| pdf \| txt \| md \| audio` \| null | known once content answers |
| `step` | `content \| prepare \| position \| firstPage` | moves forward only, in this fixed order; `position` only when `usesSavedPosition` (else `prepare → firstPage`) |
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
prepareFailed(cause)                 → failed(cause)   (format engine: damaged, protected)
positionStarted(now)                 → step position (own limit POSITION_LIMIT_MS = 3 000)
positionDone(ok, now)                → step firstPage; ok=false sets positionRestored=false (renderer shows chapter start)
firstPageDrawn                       → opened
tick(nowForeground)                  → step position past 3 000 ms: positionDone(false) (fallback, never an error);
                                       any other step past STEP_LIMIT_MS (20 000): failed(took_too_long)
leave()                              → left (any time, idempotent)
```

Foreground clock: the sum of foreground intervals measured with a monotonic clock (`performance.now()` in the
renderer), from an injected foreground source (Desktop: `visibilitychange`; phone: host AppState events), never a
count of ticks, so a timer burst after the app returns is not counted.

Derived: `showIndicator = outcome==='pending' && foregroundElapsed >= 300`, `showSlowNote = foregroundElapsed >= 5000`,
`stepLine` (message key per step), `actionsFor(error)`.

## OpeningError

| `cause` | When | Actions |
|---|---|---|
| `missing_file` | file moved / deleted | Locate file (Desktop) · "import it again" text (phone) · Back |
| `unreadable` | read failed twice / not retryable | Try again · Back |
| `damaged` | format engine refused the file | Try again · Open from the beginning (if `usesSavedPosition`) · Back |
| `protected` | DRM / encrypted, detected in the renderer (both hosts): EPUB `META-INF/encryption.xml` with an entry whose algorithm is not font obfuscation (`http://www.idpf.org/2008/embedding`, `http://ns.adobe.com/pdf/enc#RC`); PDF `PasswordException` from pdf.js | Back |
| `too_large` | MD limit, Expo Go 20 MB | Back |
| `took_too_long` | step limit | Try again · Open from the beginning (if `usesSavedPosition`) · Back |
| `not_available_offline` | cloud placeholder not downloaded (Desktop) | Try again · Back |
| `file_changed` | Desktop: size or mtime differs between the `stat` before and after `readFile` (retryable: the automatic retry reads the new version); phone: not applicable (app-owned copy) | Try again · Back |

Rules: Back is always offered; Try again never for `missing_file` / `protected` / `too_large`; Open from the beginning
for `unreadable` / `damaged` / `took_too_long` / `file_changed` / `not_available_offline` whenever `usesSavedPosition`
(the table lists the common cases). `step` of the error is kept for the message ("while preparing the first page").

## Import (US4) — changes to 016 entities

- **Held pick (Desktop Main)**: `{ path }` — no `expiresAt`; removed by `takePickedFile`, `releasePicks`, or quit; at
  most 500 held.
- **Import fingerprint**: unchanged fields; the "changed" rule becomes size ≠ ⇒ changed; mtime ≠ only ⇒ rehash and
  compare SHA-256.
- **Import failure codes**: add `not_available_offline`; phone `interrupted` reason `pick_again`.
