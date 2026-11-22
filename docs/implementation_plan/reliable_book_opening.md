# Reliable, clear book opening (spec 017)

Map of the feature in `specs/017-reliable-book-opening/` (spec, plan, research R1–R11, data-model, contracts). Four
stories: a book opens or says why and the reader can always leave (US1), one waiting screen (US2), less work while a
book opens (US3), imports without false failures (US4). No migration, no new table, nothing about an opening is stored.

## The opening state machine (core)

`source/core/src/app-models/book-opening.ts` (`bookOpening.*`, tests `tests/app-models/book-opening.test.ts`). Pure, the
clock is passed in.

- Steps run in order and only move forward: `content` (the bytes) → `prepare` (format engine, first layout) →
  `position` (only when a saved position is used) → `firstPage`.
- Each step has 20 s of **foreground** time (`STEP_LIMIT_MS`), after which it fails as `took_too_long`. The saved
  position has its own 3 s limit (`POSITION_LIMIT_MS`); when it runs out the book opens at the chapter start with a
  note. That is never an error.
- Timing for the screen: the indicator appears after 300 ms and the slow note after 5 s.
- One automatic retry for a failure that may pass (`RETRY_DELAY_MS` 400).
- The causes are `missing_file`, `unreadable`, `damaged`, `protected`, `too_large`, `took_too_long`,
  `not_available_offline` and `file_changed`.
- `actionsFor(error, { host, usesSavedPosition })` decides the buttons:
  - Back to Library is always there.
  - Try again is never offered for `missing_file`, `protected` or `too_large`.
  - Open from the beginning is offered only when a saved position was used.
  - Locate file is the Desktop action for a missing file; the phone shows "import again" text instead.
- Protected EPUB detection (`isProtectedEpubEncryption`): the book is protected when `META-INF/encryption.xml` uses
  any algorithm other than font obfuscation.

## The store (renderer)

`source/app/hooks/reader/readerOpeningStore.ts`, a zustand store.

- **Spec 016 gate.** Keeps `opening`, `waitUntilOpened` and the mirror to Main.
- **Current opening.** Holds `current` and `elapsedMs`.
  - A new opening gets a token, and answers that carry an older token are ignored.
  - A 100 ms ticker applies the limits.
  - Ending without a first page aborts the opening's signal and releases the gate at once (`firstPageSignal.endOpening`).
- **Foreground clock.** It is the sum of the foreground intervals on an injected monotonic clock.
  - Desktop source: `visibilitychange`.
  - Phone source: the host's `lifecycle` event, which `bridge/app.ts` re-dispatches as `readmate:foreground`.
- **Who reports.** `useReaderBookOpen` reports the content step, waits for an import that is still saving, retries
  once, and handles "Open from the beginning". The renderers report `prepareFailed`, `positionStarted` /
  `positionDone` and the first page (`markFirstPageDrawn`).
- **Timing lines** (`READMATE_TIMING=1`): `open-content`, `open-prepare`, `open-position`, `open-first-page`,
  `open-left`, `open-failed-<cause>`. They carry format and size only.

## The screen

`source/app/components/reader/ReaderOpeningScreen.tsx` (contracts/opening-ui.md).

- **Placement.** It sits over the renderer host (`absolute inset-0`, opaque) while the renderer mounts underneath.
  `ReaderScreen`, `MobileReaderScreen` and the audiobook preflight all use it.
- **What it shows.** Cover and title at once, then the bar and step line, then the slow note. When the opening fails it
  shows the error with its actions.
- **Back.** A Back button and Esc on Desktop. On the phone, system Back unmounts the route.
- **Finish.** It fades out over 150 ms (no fade under reduced motion).
- **Phone styles.** `.reader-opening-screen` in `phone.css`: z-index above the tap zones, safe areas, 44 px Back.
- **Removed.** `ReaderOpenStatus`, the EPUB `opening` / `rendering` overlay (`data-epub-status` is kept for E2E) and the
  PDF loading line.

## Main and the phone host

- **`library:openBookContent`.** The path check comes first, then `files/read-book-bytes.ts`.
  - Error checks:
    - `EBUSY`, `EAGAIN`, `EIO`, `EMFILE` and `ENFILE` are retryable.
    - A cloud placeholder gives `not_available_offline`.
    - `file_changed` is reported only when the size differs between the `stat` and the read.
  - What is sent:
    - A SHA-256 is computed for PDF only, for the live sync (`servedBookSha256`).
    - The `Buffer`'s own `ArrayBuffer` is sent.
- **Renderer bytes.** `toArrayBuffer` (in `useReaderBookOpen` and `epubjs/host-layout.ts`) keeps an `ArrayBuffer` as
  it is. PdfRenderer keeps its own slice because pdf.js transfers the buffer to its worker.
- **EPUB work after the first page.** Hidden pagination and the section character counts wait until the first page is
  drawn and 1 s passes without a page turn. They then start from `requestIdleCallback`. A page turn aborts them and
  queues them again (`openEpubjs.ts`).
- **Background work waits while a book opens.**
  - Cover drawing waits between steps; a render cancelled by an opening is redone (`generateBookCover.ts`).
  - The chunk worker pauses between paragraphs. Main passes the gate on through `onReaderOpeningChange` and
    `BookChunkControlMessage`.
  - Word count waits before it starts. Its loop is a synchronous SQLite iterator, so it cannot yield in the middle.
- **Phone gate.** `app.setReaderOpening { opening }` goes to `host/reader-opening-gate.ts`. The file service's copy and
  hash fallback loops wait on it between chunks, at most 10 s per wait.

## Import (US4)

- **Picks are held until used.** A pick in `ipc/picked-files.ts` no longer expires (it used to after 30 minutes).
  - It is removed when it is taken, released (`import:releasePicks`), or when the process ends.
  - At most 500 are held; beyond that the oldest is released.
  - `importQueueStore` releases the picks of jobs that are cancelled while waiting, dismissed or cleared.
  - On the phone, `files.releasePicks` removes the entry from `import-picks.json`.
- **"File changed" is judged by content.** In `import.ipc.ts` `fileChangedSince`:
  - A different size means the file changed.
  - The same size with a different mtime triggers a re-hash.
  - A cloud placeholder gives `not_available_offline` (new `ImportErrorCode` in core `import-client.ts` and
    `api-types.ts`; message `main.messages.import.notOffline`).
- **Phone after a relaunch.** A restored job whose pick can no longer be read becomes "Interrupted — pick the file
  again" (`import.queue.pickAgain`), and Try again opens the picker.
- **Phone messages.** `native/bridge/import.ts` and `library.ts` messages now come from `getT()` with the
  `main.messages.*` keys Main uses, so they follow the interface language.

## Checks

| Check | What it covers |
|---|---|
| `npm run spike:open:limits` | The real opening store with a fake clock: 20 s limit, background time, 3 s position fallback, leaving, tokens, retry, timing lines. |
| `npm run spike:open:content` | The real Main read on temp files. |
| `npm run spike:import:queue` | Release of picks, and Main's held picks (no time limit, 500 cap). |
| Core `tests/app-models/book-opening.test.ts` | The state machine. |
| Mobile `book-content-retry`, `reader-foreground`, `reader-opening-gate`, `import` tests | The phone host and bridge. |
| Manual | quickstart §2–§5 and the timing baseline / after (`specs/017-reliable-book-opening/timing-baseline.md`). E2E stays manual-only. |
