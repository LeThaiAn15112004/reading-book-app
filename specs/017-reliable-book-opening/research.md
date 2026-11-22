# Research: Reliable, clear book opening (and import without false failures)

Findings come from reading the code on branch `017-reliable-book-opening` (based on 016). Nothing here is measured yet;
the baseline (T-first tasks) measures before anything changes.

## Opening today (where the time and the failures come from)

| Step | Desktop | Phone |
|---|---|---|
| route | `/reader/:bookId` → `ReaderRoute` → `ReaderScreen` | → `MobileReaderScreen` (full screen, no tab bar) |
| book + session | `library:getBook`, `overlay:getSessionState` (SQLite) | same, through `sql.*` host calls |
| content | `library:openBookContent` (`files/open-book-content.ts`): `resolveBookFile` → `fsp.readFile` (whole file) → SHA-256 of the whole buffer (`servedSha256`, used only by the PDF live sync) → copy into a fresh `ArrayBuffer` → IPC; renderer copies again (`toArrayBuffer`) | `content.read` (`platforms/storage.native.ts`): one `fetch` of the whole book from the local server (Expo Go: `files.readChunk`); no retry |
| prepare | EPUB `openEpubjs.ts`: `ePub(bytes)` + `book.ready` (JSZip of the whole archive, no time limit) → `renderTo` → `displayCfiSafely` (2 s per attempt, retried) → `ensureInitialPaint`; PDF: pdf.js document + page; TXT `txt:open`; MD whole text | same code in the WebView |
| after first page | 016 gate: index, word count, signature, new covers, next import wait ≤ 10 s; EPUB: hidden pagination opens the book a **second** time when the cache misses; `scanSpineCharCounts` reads every section | same; host chunk loops (copy fallback, hash fallback) do not see the gate |

Screens: `ReaderOpenStatus` (spinner, "Opening book… / Preparing the reader and loading the file…", buttons only in
the error state), then the EPUB overlay (`opening` / `rendering` → "Opening book…", "Preparing book…", bar), PDF a
plain `<p>` with `reader.pdf.renderer.loading`. `animate-spin` is not `motion-safe`. No `role="status"` / `aria-busy`.

## Decisions

### R1 — One opening state machine in core, one store in the renderer

- **Decision**: core `app-models/book-opening.ts` (pure): steps `content → prepare → position → firstPage`, outcome
  `opened | left | failed(cause)`, time limits, the retry rule, the error → actions table, the 300 ms indicator rule
  and the 5 s note. Renderer `hooks/reader/readerOpeningStore.ts` (zustand, already exists for the 016 gate) grows
  into the single source of truth: `useReaderBookOpen` and the renderers report into it; the waiting screen reads it.
- **Rationale**: the rules must be the same on both hosts and for every format, and testable in vitest without a DOM;
  the project prefers zustand stores for hook state (user memory).
- **Alternatives**: keep state spread over `useReaderBookOpen` + each renderer's `status` (today's situation: the cause
  of three screens); a React context (harder to read outside React, e.g. by the 016 gate).

### R2 — Time limits by `AbortController` per step, foreground time only

- **Decision**: each step gets an `AbortSignal` with a 20 s limit; the timer pauses on `visibilitychange: hidden`
  (phone background, minimised window) and resumes on `visible`. A timeout aborts the step and ends the opening with
  `took_too_long`. Main's `readFile` cannot be interrupted; its late answer is ignored (generation token, as today's
  `cancelled` flag). epub.js: the signal destroys the half-built book (`destroyBook` already exists).
- **Rationale**: FR-003; existing code already threads `signal` through `openEpubjs`.
- **Alternatives**: one global limit (does not say which step hung); a Main-side cancel channel (adds IPC for little:
  the bytes are dropped either way).

- **Updated after analyze**: the foreground clock is the sum of foreground intervals on a monotonic clock, fed by an
  injected source — Desktop `visibilitychange`, phone the host's `app.foregroundChanged` event (AppState), because
  `visibilitychange` may not fire inside the Android WebView; never a tick count (a timer burst after return is not
  counted). The store does not touch `document` at module load, so spikes run it in Node with fakes.

### R3 — Retry once only for passing read failures

- **Decision**: phone `READ_FAILED` from the local server (fetch threw, 5xx) and Desktop `read_failed` with
  `EBUSY | EAGAIN | EIO | EMFILE` are retried once after 400 ms. `missing_file`, `path_denied`, `not_found`,
  `too_large` are never retried. Main reports `retryable: boolean` in the failure.
- **Rationale**: FR-004; the phone's local server can be briefly unreachable right after the app returns from the
  background.

### R4 — Saved position: bounded attempt, chapter fallback, note

- **Decision**: EPUB: one `displayCfiSafely` attempt bounded at 3 s total (instead of retries with 2 s each); on
  failure `display(spineIndexFromCfi(cfi))` (start of that chapter), else spine 0; PDF: page clamped to `1…pageCount`;
  TXT / MD: offset clamped. The store records `positionRestored: false` → a non-blocking note
  (`reader.opening.positionLost`). Nothing is written until the reader moves (the session bridge already saves only
  on relocation).
- **Rationale**: FR-005; "sometimes instant, sometimes long" matches read vs. unread books.

- **Updated after analyze**: steps run in the fixed order `content → prepare → position → firstPage`; `position` has its
  own 3 s limit and past it ends in `positionDone(false)` (chapter start + note), never an error, then `firstPage`.

### R5 — One waiting screen; renderers stop drawing their own

- **Decision**: new `components/reader/ReaderOpeningScreen.tsx` used by `ReaderScreen`, `MobileReaderScreen` and
  `AudioBookScreen`: cover (`BookCover`) + title from `getBook` (already loaded first), indeterminate bar
  (`motion-safe:`), step line, 5 s note, Back. It covers the renderer host until `firstPage`; the renderer mounts
  underneath from the start (it needs its size). The EPUB overlay and the PDF loading `<p>` are removed; renderers
  call `reportOpeningStep('prepare' | 'position')` and `markFirstPageDrawn()` (exists). Errors use the same screen
  in its error state (replaces `ReaderOpenStatus`; `ReaderOpenStatus` stays only as a thin wrapper if other callers
  need it).
- **Rationale**: FR-009 – FR-013; one component keeps formats and hosts identical.
- **300 ms rule** (FR-010, wording fixed in the spec): the still frame (cover + title) shows at once; indicator and
  step text fade in after 300 ms if `firstPage` has not happened.

### R6 — Fingerprint only for PDF, one copy

- **Decision**: `openBookContent` computes `servedSha256` only when `book.format === 'pdf'` (its only reader is the
  PDF live sync, `overlay.ipc.ts`), and returns the `Buffer`'s own `ArrayBuffer` when it is not pooled
  (`byteOffset === 0 && byteLength === buffer.byteLength`, true for `readFile`), otherwise one copy. The renderer uses
  an incoming `ArrayBuffer` as is (`toArrayBuffer` copies only a view). Structured clone over IPC is the one
  unavoidable copy.
- **Rationale**: FR-015 / FR-016. For a PDF the hash is taken after the bytes are sent (same tick order changed:
  send first, hash right after, before the live sync reads it — the sync starts only after the renderer asks).

### R7 — Work after the first page waits for idle; running work pauses

- **Decision**: EPUB hidden pagination and `scanSpineCharCounts` start from `requestIdleCallback` (fallback
  `setTimeout`) once `firstPage` + 1 s without a page turn; a page turn or leaving aborts them (they already take a
  signal) and they restart on the next idle. The 016 gate gets `isOpening()` checks **inside** running work:
  `generateBookCover` between its steps (and cancels a pdf.js render task), Main's chunking / word-count loops
  (`yieldWhileOpening`, exists for import reads), and on the phone the host's chunk loops through a new host call
  `app.setReaderOpening { opening }` that the bridge sends from `setReaderOpening` (today a no-op) — `file-service`
  awaits it between chunks.
- **Rationale**: FR-017 / FR-018; the phone shares one JS thread per side.

### R8 — Picks stay while queued; released explicitly

- **Decision**: `ipc/picked-files.ts` drops the 30-minute expiry for book picks; a pick is removed by `takePickedFile`
  (job starts), by a new `import:releasePicks { pickIds }` (job cancelled / dismissed / Clear finished while waiting),
  and with the process. A cap of 500 held picks (10 × the per-pick maximum) protects memory. The phone already keeps
  picks in `import-picks.json` without expiry.
- **Rationale**: FR-020.

### R9 — "File changed" by content

- **Decision**: `fileChangedSince` → size differs ⇒ changed; size equal but mtime differs ⇒ hash the file again
  (`hashFile`, with the job's signal) and compare with the fingerprint's SHA-256; equal ⇒ not changed. A read error
  of a cloud placeholder (Windows `ERROR_CLOUD_FILE_*`, errno `EIO` on a placeholder) ⇒ new cause
  `not_available_offline`.
- **Rationale**: FR-021; the second hash happens only in the rare touched-but-same case.

### R10 — Phone messages translated in the bridge

- **Decision**: the phone bridge (`native/bridge/import.ts`, `library.ts`) returns `errorMessage` from `getT()` keys
  (`main.messages.import.*`, the same keys Main's `tMain` uses) instead of English literals; lost access after a
  relaunch → `interrupted` with `import.queue.pickAgain`.
- **Rationale**: FR-022 / FR-023; one catalogue, both hosts. Check that `native/bridge` may import `@app/i18n`
  (boundaries R7/R8 allow `@app/*` non-host modules; verify with `check:boundaries`).

### R11 — Timing

- **Decision**: reuse 016's step timer with flow `open` and steps `open-content`, `open-prepare`, `open-position`,
  `open-first-page`, plus one `open-outcome` line (`opened | left | failed:<cause>`). Format + size only (016 FR-001).
- **Rationale**: FR-019; SC-005 baseline.

## Open risks

- epub.js may keep internal timers after `destroy()` on an aborted `book.ready`; the spike must check that a timed-out
  opening leaves no work running (SC-002 / FR-002).
- Removing the EPUB overlay must keep `data-epub-status` (E2E selectors rely on it) — keep the attribute.
