---

description: "Task list for 017 — reliable, clear book opening (and import without false failures)"
---

# Tasks: Reliable, clear book opening (and import without false failures)

**Input**: Design documents from `specs/017-reliable-book-opening/` (plan.md, spec.md, research.md R1–R11,
data-model.md, contracts/opening-ui.md, contracts/opening-ipc.md, quickstart.md)

**Prerequisites**: plan.md, spec.md (US1–US4), research.md, data-model.md, contracts/

**Tests**: included where plan.md names them — core vitest `source/core/tests/app-models/book-opening.test.ts`, Mobile
vitest in `source/app/platforms/native/tests/`, and the new Desktop spikes `spike:open:limits` / `spike:open:content`.
Desktop UI / Main have no test runner (their checks are spikes). E2E stays manual-only: do NOT run `npm run e2e`.

**Organization**: grouped by user story; every story is independently testable after Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 … US4 from spec.md
- Paths are from the repository root

## Project rules that apply to every task

- Core (`source/core/src`) stays pure: no Node / DOM globals, clock injected (R1–R3 of spec 009).
- Four-place IPC rule: a new / changed channel is updated in `ipc/channels.ts`, its `ipc/*.ipc.ts`, `preload.ts` +
  `ipc/api-types.ts`, and `source/app/bridge/*.ts`; the phone implements the same `Window['api']` member.
- Every changed Main file (`source/app/platforms/electron/**` outside the renderer) gets an approval line in
  `source/scripts/desktop-main-changes.json`.
- Every new interface text lives in `source/core/src/i18n/catalogue/{en,vi}/*.ts` (same shape; vi follows
  `specs/012-app-ui-i18n/contracts/glossary.md`, no "bạn"); no literal UI text in `.tsx` (`readmate/no-ui-literals`).
- Renderer state for hooks goes in zustand stores (user preference).

---

## Phase 1: Setup (baseline before any change)

**Purpose**: measure today's opening so SC-005 can be checked later, and prepare the spike folder.

- [ ] T001 Add the 017 opening steps to the developer timing (flow `open`, steps `open-content`, `open-prepare`, `open-position`, `open-first-page`, and one `open-outcome` line `opened | left | failed:<cause>`; format + size only, never a title or path — 016 FR-001) in `source/app/hooks/app/stepTimer.ts`, and record them from the current `source/app/hooks/reader/useReaderBookOpen.ts` / `source/app/hooks/reader/firstPageSignal.ts` without changing behaviour (R11, FR-019)
- [ ] T002 Extend `source/app/platforms/electron/spikes/import/run-import-timing.mjs` so the per-step table also prints the `open` flow (tap → first page per format / size bucket) and keeps failing on any field that could name a book
- [ ] T003 Measure the baseline (quickstart §1: `READMATE_TIMING=1`, each sample opened 5×, `npm run spike:import:timing -- --label open-baseline`; phone via `localStorage['readmate.devTiming']='1'` + logcat) and write tap → first page per sample (format + size only) into `specs/017-reliable-book-opening/timing-baseline.md`
- [ ] T004 [P] Create `source/app/platforms/electron/spikes/open/` with a `README.md` and add `spike:open:limits` and `spike:open:content` scripts to `package.json` (same `cd source/app/platforms/electron && node --experimental-transform-types --import ./spikes/pdf-annotations/register-alias.mjs …` pattern as `spike:import:*`)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the opening state machine (R1) and the store / i18n keys every story reads.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

- [ ] T005 Create the pure opening state machine in `source/core/src/app-models/book-opening.ts` (R1, data-model "Opening"): type `Opening` with `token: string` (new per attempt; older tokens ignored — FR-008), `bookId`, `title` / `coverUrl: string | null`, `format: 'epub' | 'pdf' | 'txt' | 'md' | 'audio' | null`, `step: 'content' | 'prepare' | 'position' | 'firstPage'` (fixed order, forward only; `position` only when `usesSavedPosition`, else `prepare → firstPage`), `stepStartedAt` (foreground ms clock), `usesSavedPosition: boolean`, `positionRestored: boolean | null`, `retried: boolean`, `outcome: 'pending' | 'opened' | 'left' | 'failed'`, `error: OpeningError | null`; transitions `start`, `contentReady`, `contentFailed(code, retryable)` (retry once only if `retryable && !retried`), `prepareFailed(cause)` (format engine: `damaged` / `protected`), `positionStarted`, `positionDone(ok)` (→ `firstPage`; `ok=false` ⇒ `positionRestored=false`), `firstPageDrawn`, `tick(nowForeground)` (step `position` past `POSITION_LIMIT_MS` = 3 000 ⇒ `positionDone(false)`, a fallback, never an error; any other step past `STEP_LIMIT_MS` = 20 000 ⇒ `failed(took_too_long)`), `leave()` (any time, idempotent); constants `STEP_LIMIT_MS = 20000`, `INDICATOR_DELAY_MS = 300`, `SLOW_NOTE_MS = 5000`, `POSITION_LIMIT_MS = 3000`, `RETRY_DELAY_MS = 400`; derived `showIndicator` (`outcome==='pending' && foregroundElapsed >= 300`), `showSlowNote` (`>= 5000`), `stepLineKey(step)`
- [ ] T006 In the same `source/core/src/app-models/book-opening.ts` add `OpeningError { cause, step }` with `cause: 'missing_file' | 'unreadable' | 'damaged' | 'protected' | 'too_large' | 'took_too_long' | 'not_available_offline' | 'file_changed'`, a mapping from `OpenBookErrorCode` (`missing_file`, `path_denied`, `not_found`, `too_large`, `read_failed`, `not_available_offline`, `file_changed`) and from engine failures (`damaged`, `protected`) to a cause, and `actionsFor(error, { host, usesSavedPosition })` exactly per the data-model rules: Back to Library always; Try again for `unreadable` / `damaged` / `took_too_long` / `not_available_offline` / `file_changed`, NEVER for `missing_file` / `protected` / `too_large`; Open from the beginning for `unreadable` / `damaged` / `took_too_long` / `not_available_offline` / `file_changed` only when `usesSavedPosition`; `missing_file` → Locate file (Desktop) / import-again text (phone)
- [ ] T007 Export the new module from `source/core/src/app-models/index.ts` (and `source/core/src/index.ts` if app-models are re-exported there)
- [ ] T008 [P] Write `source/core/tests/app-models/book-opening.test.ts`: forward-only steps, stale token ignored, one retry only for retryable codes (never for `missing_file` / `path_denied` / `not_found` / `too_large`), timeout per step at 20 000 ms of foreground time (a paused clock does not count), `leave()` idempotent from every step, 300 ms indicator and 5 s note, `positionDone(false)`, `actionsFor` per cause and host
- [ ] T009 [P] Add the `reader.opening.*` keys to `source/core/src/i18n/catalogue/en/reader-chrome.ts` and `source/core/src/i18n/catalogue/vi/reader-chrome.ts` (contracts/opening-ui.md): `step.content` "Opening the book…", `step.prepare` "Preparing the first page…", `step.position` "Going back to where you left off…", `slow` "Large books can take a little longer.", `positionLost` "Couldn't return to where you left off. Opened at the start of the chapter.", `announce` "Opening {title}", `error.title` "Couldn't open this book", `error.<cause>` for all eight causes (incl. `file_changed` "The file changed while it was being opened.") (with the step in the message, e.g. "while preparing the first page"), `action.tryAgain`, `action.fromBeginning`, `action.locateFile`, `action.back` "Back to Library", `importAgain` (phone, missing file); no wording that suggests a download ("loading the file" / "tải tệp")
- [ ] T010 Grow `source/app/hooks/reader/readerOpeningStore.ts` (zustand, keeps the 016 gate API `isOpening()` / `setReaderOpening` callers working) into the single opening store: holds the core `Opening`, a foreground clock = sum of foreground intervals on a monotonic clock (never a tick count, so a timer burst after the app returns is not counted — R2) fed by an INJECTED foreground source and clock (`setForegroundSource`, `setClock`); no `document` / `window` access at module load — the DOM source (`visibilitychange`) is attached by `installOpeningStoreDomSources()` called from the app, so spikes can run the real store in Node with fakes; a per-step `AbortController` with the 20 s limit driven by `tick`, and actions `begin(bookId, meta)`, `reportStep(step)`, `contentReady`, `contentFailed`, `positionDone(ok)`, `markFirstPageDrawn()` (reuse / forward from `firstPageSignal.ts`), `leave()`, `retry()`, `openFromBeginning()`, `stepSignal()`; `isOpening()` stays true from `begin` until `opened | left | failed`

**Checkpoint**: core rules tested, store and strings ready — stories can start.

---

## Phase 3: User Story 1 — A book either opens or says clearly why not, and the reader can always leave (P1) 🎯 MVP

**Goal**: never stuck: Back at any moment, a hanging step ends in a message within 20 s, passing read failures retried
once, a stale saved position falls back to its chapter, errors name the cause and offer only helpful actions.

**Independent Test**: quickstart §2 — Back / Esc / system Back at every step (Library ≤ 1 s, position unchanged);
`npm run spike:open:limits` (hanging step → "took too long" after 20 s with the right actions); stale saved position →
chapter start + note; one failed read → opens; moved file → error ≤ 2 s.

### Tests for User Story 1

- [ ] T011 [P] [US1] Write `source/app/platforms/electron/spikes/open/run-open-limits.mjs` (`spike:open:limits`): drives the real renderer `readerOpeningStore` with an injected fake clock + fake foreground source (no DOM) and a step that never resolves → `failed(took_too_long)` at 20 s with Try again / Open from the beginning / Back; a hidden period does not count, and a 60 s background followed by a burst of ticks does not time out; a `position` step that hangs → fallback to `firstPage` at 3 s, no error; `leave()` mid-step aborts the step signal and leaves no timer running; a late answer with an old token is ignored; a retryable failure followed by success → `opened` with no error shown
- [ ] T012 [P] [US1] Add a Mobile vitest `source/app/platforms/native/tests/book-content-retry.test.ts`: `content.read` fetch throws / 5xx once → `retryable: true`; missing book (local server 404 / `files.stat` absent) → `missing_file`, `retryable: false`, answered without a retry delay; Expo Go > 20 MB → `too_large`, not retryable

### Implementation for User Story 1

- [ ] T013 [US1] Change `library:openBookContent` failures in `source/app/platforms/electron/files/open-book-content.ts` to carry `retryable: true` for `EBUSY | EAGAIN | EIO | EMFILE` read errors (R3), keep the instant checks (`resolveBookFile`: missing / denied / too large) before any read so their error comes within 2 s (FR-007); add `not_available_offline` (cloud placeholder read error) and `file_changed` (`stat` before and after `readFile`: size or mtime differs ⇒ `file_changed`, `retryable: true`, so the automatic retry reads the new version; the same buffer is sent and, for PDF, hashed — one consistent version); protected books are NOT detected here (Main does not parse the file — see T021); approval line in `source/scripts/desktop-main-changes.json`
- [ ] T014 [US1] Update `OpenBookContentResult` / `OpenBookErrorCode` in `source/app/platforms/electron/ipc/api-types.ts` (`{ ok: false; bookId; errorCode; errorMessage; retryable?: boolean }`, codes gain `'not_available_offline' | 'file_changed'`) and the wrapper in `source/app/bridge/library.ts`; approval line for `api-types.ts`
- [ ] T015 [P] [US1] Make the phone content read report the same shape in `source/app/platforms/storage.native.ts` (check the book exists first — local server 404 or `files.stat` absent ⇒ `missing_file`, `retryable: false`, so the error comes within 2 s (FR-007 / SC-004); `retryable: true` when the local-server fetch threw or answered 5xx; Expo Go `files.readChunk` failure the same; `file_changed` is not applicable on the phone — app-owned copy) and `source/app/platforms/native/bridge/book-content.ts` if it builds the result
- [ ] T016 [P] [US1] Phone foreground source: make `source/app/platforms/native/host/lifecycle.ts` send the AppState `active` / `background` changes down to the WebView (existing host → WebView event channel) and connect them in `source/app/platforms/native/bridge/app.ts` as the phone foreground source of `readerOpeningStore` (`setForegroundSource`, T010), so background time never counts against a step limit (FR-003, edge case "app sent to the background"; do not rely on `visibilitychange` firing inside the WebView); add a case to `source/app/platforms/native/tests/book-content-retry.test.ts`: 60 s in the background, then back ⇒ no timeout
- [ ] T017 [US1] Rewrite the flow in `source/app/hooks/reader/useReaderBookOpen.ts` to report into `readerOpeningStore`: `begin` with a new token (a second tap / another book replaces the running opening — FR-008), `reportStep('content')`, one automatic retry after 400 ms when `retryable` (via the store's `contentFailed`), drop every answer whose token is no longer current, pass `stepSignal()` to the content and prepare calls, and `leave()` on unmount
- [ ] T018 [US1] Open only complete entries (spec edge case "opening while an import of the same book is still saving"): in `source/app/hooks/reader/useReaderBookOpen.ts`, before the `content` step, if `source/app/hooks/library/importQueueStore.ts` has a job in its saving stage for this `bookId` (or the same fingerprint), wait for that job to end inside the `content` step (its 20 s limit still applies; the screen shows the normal step line); a job that ends failed / cancelled ⇒ `missing_file` error; expose a small selector `whenSaved(bookId, signal)` from `importQueueStore` for this
- [ ] T019 [US1] Bound the saved-position restore in `source/app/components/reader/renderers/epub/epubjs/display.ts` and `source/app/components/reader/renderers/epub/openEpubjs.ts`: one `displayCfiSafely` attempt bounded at 3 s total (no 2 s retries); on failure `display(spineIndexFromCfi(cfi))`, else spine 0; report `reportStep('position')` / `positionDone(ok)`; abort with the step signal destroys the half-built book (`destroyBook`) (R4, FR-005); nothing is written until the reader moves
- [ ] T020 [P] [US1] Clamp the saved position in `source/app/components/reader/renderers/pdf/PdfRenderer.tsx` (page to `1…pageCount`) and in the TXT / Markdown renderers under `source/app/components/reader/renderers/txt/` and `source/app/components/reader/renderers/md/` (offset to the text length), reporting `positionDone(false)` when clamped
- [ ] T021 [US1] Detect protected books in the renderer (both hosts — FR-006, edge case "DRM-protected or encrypted book"): PDF — a pdf.js `PasswordException` while loading ⇒ `prepareFailed('protected')` in `source/app/components/reader/renderers/pdf/PdfRenderer.tsx` (or its document loader); EPUB — after the archive is opened in `source/app/components/reader/renderers/epub/openEpubjs.ts`, `META-INF/encryption.xml` with any entry whose algorithm is not font obfuscation (`http://www.idpf.org/2008/embedding`, `http://ns.adobe.com/pdf/enc#RC`) ⇒ `prepareFailed('protected')`; font obfuscation only ⇒ opens normally; every other engine refusal ⇒ `prepareFailed('damaged')`; extend T008 with these mappings
- [ ] T022 [US1] Show the non-blocking `reader.opening.positionLost` note (6 s, dismissible) when `positionRestored === false` after `opened`, in `source/app/screens/Reader/ReaderScreen.tsx` and `source/app/screens/Reader/phone/MobileReaderScreen.tsx` (reuse the existing toast / note component)
- [ ] T023 [US1] Wire Back while opening: on-screen Back, Esc (Desktop) and system Back (phone, `useBackClose`-style handler from `source/app/hooks/app/`) call `readerOpeningStore.leave()` → abort step signals → navigate like today's `leaveToLibrary` within 1 s, without saving position / status / settings (FR-001, FR-002), in `source/app/screens/Reader/ReaderScreen.tsx`, `source/app/screens/Reader/phone/MobileReaderScreen.tsx` and `source/app/screens/AudioBook/AudioBookScreen.tsx`
- [ ] T024 [US1] Error state with cause + actions from `actionsFor` in `source/app/screens/Reader/components/chrome/ReaderOpenStatus.tsx` (temporary home until US2's screen replaces it — SKIP this task and build the error state directly in T027 when US2 is done right after US1): Try again → `retry()`, Open from the beginning → `openFromBeginning()` (opens at the start without the saved position, does not overwrite it until the reader moves), Locate file → existing `library:relinkBook` flow (Desktop), import-again text (phone), Back to Library; first action focused, cause line `role="alert"`
- [ ] T025 [US1] Make sure an opening that is left / timed out leaves nothing running: epub.js destroyed on abort (check internal timers after `destroy()` on an aborted `book.ready` — research open risk), pdf.js loading task destroyed, TXT `txt:open` answer dropped; extend `run-open-limits.mjs` (T011) with this check
- [ ] T026 [US1] Run `npm run spike:open:limits`, `npm run sdk:test`, `npm run mobile:test`, `npm run typecheck`, `npm run lint`; then quickstart §2 manually on Desktop and phone

**Checkpoint**: US1 alone fixes "stuck" and false failures, with today's screens.

---

## Phase 4: User Story 2 — One clear waiting screen that shows which book is opening (P1)

**Goal**: one screen for every format and both hosts: cover + title at once, indicator + step line after 300 ms, slow
note after 5 s, Back, fade-out to the page, accessible.

**Independent Test**: quickstart §3 — every format, both hosts, light + dark, reduced motion on / off, Narrator /
TalkBack.

### Implementation for User Story 2

- [ ] T027 [US2] Create `source/app/components/reader/ReaderOpeningScreen.tsx` (contracts/opening-ui.md), driven only by `readerOpeningStore`: `position: absolute; inset: 0`, opaque `--lib-bg-deep`; Back control (44 × 44 px on the phone, keyboard-focusable on Desktop); `BookCover` (generated cover style when none) + title (2 lines max; file name when no title); indeterminate bar `motion-safe:` (static under reduced motion) + step line from `stepLineKey` only when `showIndicator`; `slow` note when `showSlowNote`; error state (icon, `error.title`, cause line `role="alert"`, actions, first action focused); container `role="status"` `aria-busy="true"` `aria-label` = `announce` once, step line `aria-live="off"`; fades out 150 ms on `firstPage` (none under reduced motion) then focus to the reading surface; contrast ≥ 4.5 : 1 with `--lib-*` tokens in both themes
- [ ] T028 [US2] Fill `title` / `coverUrl` into the store from the already-loaded `library:getBook` before content is read, so the still frame appears ≤ 100 ms after the tap, in `source/app/hooks/reader/useReaderBookOpen.ts`
- [ ] T029 [US2] Use `ReaderOpeningScreen` over the renderer host in `source/app/screens/Reader/ReaderScreen.tsx` (renderer mounts underneath from the start; replaces the loading and error states of `ReaderOpenStatus`, moving T024's error UI into the screen)
- [ ] T030 [P] [US2] Use `ReaderOpeningScreen` in `source/app/screens/Reader/phone/MobileReaderScreen.tsx` (phone styles in `source/app/styles/phone.css` under `[data-mobile-host]`)
- [ ] T031 [P] [US2] Use `ReaderOpeningScreen` for the preflight wait and error of `source/app/screens/AudioBook/AudioBookScreen.tsx` (player unchanged)
- [ ] T032 [US2] Remove the EPUB `opening` / `rendering` overlay from `source/app/components/reader/renderers/epub/EpubRenderer.tsx` (KEEP the `data-epub-status` attribute — E2E selectors rely on it) and report `reportStep('prepare')` / `markFirstPageDrawn()` instead
- [ ] T033 [P] [US2] Remove the PDF loading `<p>` (`reader.pdf.renderer.loading`) from `source/app/components/reader/renderers/pdf/PdfRenderer.tsx` and report `reportStep('prepare')` / `markFirstPageDrawn()`; make TXT and Markdown renderers report the same steps
- [ ] T034 [US2] Reduce `source/app/screens/Reader/components/chrome/ReaderOpenStatus.tsx` to a thin wrapper around `ReaderOpeningScreen` or delete it if no caller is left; remove now-unused i18n keys (old "Opening book… / Preparing the reader and loading the file…", EPUB overlay texts, `reader.pdf.renderer.loading`) from both `en` and `vi` catalogues
- [ ] T035 [US2] Run `npm run typecheck`, `npm run lint` (incl. `readmate/no-ui-literals`), `npm run build`, `npm run build:web`; then quickstart §3 manually

**Checkpoint**: US1 + US2 = the full P1 scope.

---

## Phase 5: User Story 3 — Books open faster and the first pages turn smoothly (P2)

**Goal**: no whole-file fingerprint except PDF, one copy of the bytes, post-first-page work on idle, running background
work paused while a book opens (both hosts).

**Independent Test**: quickstart §4 — `npm run spike:import:timing -- --label open-after` vs the T003 baseline (≥ 30 %
faster for books > 50 MB, none slower); 10 page turns in the first 10 s of a large EPUB, none > 300 ms; PDF live sync
still picks up an edit from another reader.

### Tests for User Story 3

- [ ] T036 [P] [US3] Write `source/app/platforms/electron/spikes/open/run-open-content.mjs` (`spike:open:content`): the real `openBookContent` on temp files — EPUB / TXT / MD return no `servedSha256` and do not hash; PDF still records the fingerprint used by the live sync; the returned `ArrayBuffer` is the `readFile` buffer's own (no copy) when not pooled; missing file answers without reading
- [ ] T037 [P] [US3] Add a Mobile vitest `source/app/platforms/native/tests/reader-opening-gate.test.ts`: `bridge/app.ts` `setReaderOpening` sends `app.setReaderOpening { opening }`; `file-service` chunk loops wait between chunks while opening, bounded at 10 s

### Implementation for User Story 3

- [ ] T038 [US3] In `source/app/platforms/electron/files/open-book-content.ts` compute `servedSha256` only when the book is a PDF (taken right after the bytes are sent, before the live sync reads it) and send the `Buffer`'s own `ArrayBuffer` when `byteOffset === 0 && byteLength === buffer.byteLength`, else one copy (R6, FR-015, FR-016); check the reader in `source/app/platforms/electron/ipc/overlay.ipc.ts` still finds the PDF fingerprint; approval lines in `source/scripts/desktop-main-changes.json`
- [ ] T039 [US3] Use an incoming `ArrayBuffer` as is in the renderer — `toArrayBuffer` returns the input when it already is an `ArrayBuffer` and copies only a view (FR-016) — in every place it is used: `source/app/hooks/reader/useReaderBookOpen.ts`, `source/app/components/reader/renderers/epub/openEpubjs.ts`, `source/app/components/reader/renderers/epub/index.ts`, `source/app/components/reader/renderers/epub/progress/hidden-epub-pagination.ts`; extend T036 to check the renderer receives the original buffer
- [ ] T040 [US3] Start EPUB hidden pagination and `scanSpineCharCounts` only from `requestIdleCallback` (fallback `setTimeout`) once `firstPage` + 1 s without a page turn; abort on page turn or leave and restart on the next idle (R7, FR-017), in `source/app/components/reader/renderers/epub/EpubRenderer.tsx` and the pagination module under `source/app/components/reader/renderers/epub/progress/`
- [ ] T041 [P] [US3] Pause running cover drawing in `source/app/screens/Library/logic/generateBookCover.ts`: check `isOpening()` between steps, await the gate, cancel a running pdf.js render task and redo it after (FR-018)
- [ ] T042 [P] [US3] Call `yieldWhileOpening` inside the loops of `source/app/platforms/electron/chunking/book-chunk-job.ts` (and `book-chunk-service.ts` if the loop lives there) and `source/app/platforms/electron/wordcount/word-count-service.ts`, using `source/app/platforms/electron/perf/reader-opening-gate.ts`; approval lines in `source/scripts/desktop-main-changes.json`
- [ ] T043 [US3] Phone host gate: add `app.setReaderOpening { opening: boolean } → { ok: true }` in `source/app/platforms/native/host/app-service.ts` + `source/app/platforms/native/host/rpc.ts` / `protocol.ts`, send it from `source/app/platforms/native/bridge/app.ts` `setReaderOpening` (today a no-op), and make `source/app/platforms/native/host/file-service.ts` chunk loops (`stage` fallback, `hashStaged` fallback) await `whenNotOpening()` between chunks, bounded at 10 s (contracts/opening-ipc.md)
- [ ] T044 [US3] Run `npm run spike:open:content`, `npm run mobile:test`, `npm run check:desktop-baseline`; measure `npm run spike:import:timing -- --label open-after` and add the after figures + SC-005 / SC-006 result to `specs/017-reliable-book-opening/timing-baseline.md`

**Checkpoint**: US3 measurable against the baseline; US1 / US2 unaffected.

---

## Phase 6: User Story 4 — A valid book imports every time (P2)

**Goal**: picks held while queued, "file changed" by content only, phone lost access → Interrupted, translated messages
on both hosts.

**Independent Test**: quickstart §5 — 50 books (10 in a cloud-synced folder), queue > 30 min → 50 / 50; touch mtime →
added; change content → "changed while it was being imported"; phone force-stop → readable continue, others
"Interrupted — pick the file again", in Vietnamese.

### Tests for User Story 4

- [ ] T045 [P] [US4] Extend `source/app/platforms/electron/spikes/import/run-import-queue.mjs` (`spike:import:queue`): a pick still taken after > 30 min (fake clock); cancel / dismiss / Clear finished of a waiting pick job calls `releasePicks`; more than 500 held picks releases the oldest and its job fails as `missing_file` ("pick the file again")
- [ ] T046 [P] [US4] Extend `source/app/platforms/native/tests/import.test.ts` / `import-queue.test.ts`: lost read access after relaunch → `interrupted` with `pick_again` (not damaged, not a save failure); every `errorMessage` comes from `getT()` keys (Vietnamese with the UI in Vietnamese)

### Implementation for User Story 4

- [ ] T047 [US4] Drop the 30-minute expiry for book picks in `source/app/platforms/electron/ipc/picked-files.ts` (held pick = `{ path }`, no `expiresAt`); removed by `takePickedFile`, by a new `releasePicks(pickIds)`, or with the process; cap 500 held (oldest released beyond it) (R8, FR-020); approval line
- [ ] T048 [US4] Add `import:releasePicks { pickIds: string[] } → { ok: true; released: number }` (unknown ids ignored) through the four places: `source/app/platforms/electron/ipc/channels.ts` (`ImportChannels`), `source/app/platforms/electron/ipc/import.ipc.ts`, `source/app/platforms/electron/preload.ts` + `source/app/platforms/electron/ipc/api-types.ts`, `source/app/bridge/import.ts`; phone member in `source/app/platforms/native/bridge/import.ts` (host call `files.releasePicks` in `source/app/platforms/native/host/file-service.ts` removing entries from `import-picks.json`); approval lines
- [ ] T049 [US4] Call `releasePicks` from `source/app/hooks/library/importQueueStore.ts` when a waiting `pick` job is cancelled, dismissed, or removed by Clear finished (hook points in core `source/core/src/app-models/import-queue.ts` if the rule lives there)
- [ ] T050 [US4] Change `fileChangedSince` in `source/app/platforms/electron/ipc/import.ipc.ts` (R9, FR-021): size differs ⇒ `file_changed`; size equal but mtime differs ⇒ re-hash with the job's signal (`hashFile`) and compare with the fingerprint's SHA-256, equal ⇒ continue; a read error of a cloud placeholder (Windows `ERROR_CLOUD_FILE_*`, `EIO` on a placeholder) ⇒ new `ImportErrorCode` `not_available_offline`; approval line
- [ ] T051 [P] [US4] Add `not_available_offline` to `ImportErrorCode` in BOTH definitions — `source/core/src/app-models/import-client.ts` (shared by the queue and the phone bridge) and `source/app/platforms/electron/ipc/api-types.ts` (Desktop DTO) — keeping them identical, and the message `main.messages.import.notOffline` ("The file is not available offline yet") to `source/core/src/i18n/catalogue/{en,vi}/main-messages.ts`, and its card / summary text in `source/core/src/i18n/catalogue/{en,vi}/import.ts`
- [ ] T052 [US4] Phone: a waiting job whose file can no longer be read after a relaunch ends as `interrupted` with reason `pick_again` (Try again opens the picker) in `source/app/platforms/native/bridge/import-queue.ts` / `source/app/platforms/native/bridge/import.ts`, shown with `import.queue.pickAgain` (FR-022)
- [ ] T053 [US4] Replace the English literal `errorMessage`s in `source/app/platforms/native/bridge/import.ts` and `source/app/platforms/native/bridge/library.ts` with `getT()` and the `main.messages.import.*` / `main.messages.common.*` keys Main already uses (R10, FR-023); confirm with `npm run check:boundaries` that `native/bridge` may import the i18n module (add an `exceptions.json` entry with a reason only if needed)
- [ ] T054 [US4] Run `npm run spike:import:queue`, `npm run spike:import:parity`, `npm run spike:import:cleanup`, `npm run mobile:test`; then quickstart §5 manually

**Checkpoint**: all four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T055 [P] Write `docs/implementation_plan/reliable_book_opening.md` (map of the feature: state machine, store, screen, IPC changes, gate, import fixes, checks) and add a short 017 paragraph to `CLAUDE.md` (Persistence / Architecture section, next to "Background import (spec 016)")
- [ ] T056 [P] Add the new spikes `spike:open:limits` / `spike:open:content` to the spike list in `CLAUDE.md`
- [ ] T057 Check the edge cases of spec.md by hand: Back then reopen the same book, A → Back → B quickly (B never shows A), phone background during opening (background time not counted), file replaced while opening, no cover / no title (generated cover + file name), MD over the limit (immediate size error), DRM / password book ("protected", not "damaged"), opening while its import is still saving, double tap (one opening)
- [ ] T058 Run `npm run i18n:inventory` and `sdk:test` (release gate `source/core/tests/i18n/i18n-release-gate.test.ts`, glossary anchors) — no pending literals left from 017
- [ ] T059 Run the full gate `npm run check` (typecheck, lint, core + mobile tests, boundaries, platform-adapters, builds, build-split, `check:desktop-baseline` with every new approval line) and fix anything red
- [ ] T060 Run the full quickstart (`specs/017-reliable-book-opening/quickstart.md` §2–§5) on both hosts and record SC-001 … SC-008 results in `specs/017-reliable-book-opening/timing-baseline.md` (format + size only)

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 Setup**: no dependency; T003 (baseline) MUST be done before any Phase 5 change to `open-book-content.ts`.
- **Phase 2 Foundational**: after T001; blocks every story (T005 → T006 → T007; T008, T009 in parallel; T010 after T005–T007).
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2; T029 moves T024's error UI, so do US2 after US1 when one developer works on both
  (or skip T024 and build the error state directly in T027).
- **US3 (Phase 5)**: after Phase 2 and T003; T038 and T013 both edit `open-book-content.ts` — do them in sequence.
- **US4 (Phase 6)**: after Phase 2 only (independent of US1–US3; touches import files only, plus the shared
  `api-types.ts`, `main-messages.ts`).
- **Polish (Phase 7)**: after the stories you ship.

### Within each story

- Tests / spikes first (they fail before the change), then Main / bridge, then renderer, then the story's check task.
- Shared files edited by more than one task (`useReaderBookOpen.ts`: T017, T018, T028, T039; `openEpubjs.ts`: T019, T021, T039; `PdfRenderer.tsx`: T020, T021, T033; `open-book-content.ts`: T013, T038; `ReaderScreen.tsx`: T022, T023, T029;
  `EpubRenderer.tsx`: T032, T040; `api-types.ts`: T014, T048, T051) are done in task order, never in parallel.

### Parallel opportunities

- Phase 2: T008 (tests) and T009 (i18n) while T010 is written.
- US1: T011, T012, T016 together; T015, T020 and T021 beside T013 / T017.
- US2: T030, T031, T033 once T027 exists.
- US3: T036, T037 together; T041, T042 together.
- US4: T045, T046, T051 together; US4 as a whole can run beside US1–US3 (different files).

---

## Parallel Example: User Story 1

```text
Task: "T011 spike:open:limits in source/app/platforms/electron/spikes/open/run-open-limits.mjs"
Task: "T012 Mobile vitest in source/app/platforms/native/tests/book-content-retry.test.ts"
Task: "T015 retryable phone content read in source/app/platforms/storage.native.ts"
Task: "T020 position clamp in PdfRenderer.tsx and the TXT / Markdown renderers"
```

## Parallel Example: User Story 4

```text
Task: "T045 extend spikes/import/run-import-queue.mjs"
Task: "T046 extend native/tests/import.test.ts + import-queue.test.ts"
Task: "T051 not_available_offline code + messages in api-types.ts and the en/vi catalogues"
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 (incl. the baseline T003) → Phase 2.
2. Phase 3 (US1) → **stop and validate** with quickstart §2: no valid book fails, nothing hangs, Back always works.

### Incremental delivery

1. US1 → never stuck (MVP).
2. US2 → one waiting screen (completes the P1 scope; ship together with US1 if possible).
3. US3 → faster opening, measured against the baseline.
4. US4 → imports without false failures (can be delivered at any point after Phase 2).
5. Each step: `npm run check` green, commit + push to `017-reliable-book-opening`.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- No migration, no new table, no stored opening state.
- The book file is only read; nothing in this feature writes annotations or book files.
- Do not run E2E; keep `data-epub-status` for its selectors.
