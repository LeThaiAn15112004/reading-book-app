# Contract: import UI (016) — shared by Desktop and the phone

## Components (`source/app/components/import/`)

| Component | Replaces / role |
|---|---|
| `ImportQueueCard.tsx` | replaces `ImportProgressDialog` (no modal, no backdrop). Shows the running job: name, step label, bar (percentage when `total` known, else indeterminate), "{n} waiting", Cancel (→ "Finishing…", disabled, during `saving`). Expand → `ImportQueueList` |
| `ImportQueueList.tsx` | every job of the session: waiting (Cancel), running, done (Open), duplicate (Open existing), failed (cause + Try again when `retryable` + Dismiss), cancelled, interrupted (Try again); "Clear finished" |
| `ImportBatchSummary.tsx` | inside the card when a batch ends: five groups (hidden at 0), failure causes, Open when exactly one added |
| `ImportPlaceholderTile.tsx` / `ImportPlaceholderRow.tsx` | Library Grid / List placeholder: neutral cover tile with spinner, name, "Importing… 42 %" / "Waiting"; `aria-disabled`, no menu, not a book link |
| `AudiobookZipJobPanel.tsx` | kept for the ZIP result (track list + Open audiobook); opened from the ZIP job's row |

Collapsed state: a 44 px pill ("Importing 2 of 5 · 42 %") — one click / tap opens the card (FR-009 "reachable in one
action"). It stays mounted in `App.tsx` above every route (Library, Reader, Collections, Settings).

Pill visibility:

- A job `running` or `waiting` → the pill is always shown.
- Everything finished → the pill shows the result (`queue.pillDone`, e.g. "4 added · 1 failed", groups at 0 left out);
  click / tap opens the batch summary. With no `failed` / `interrupted` job it hides by itself after 10 s; with one it
  stays until the reader opens the summary or presses Dismiss (so "Try again" is never missed).
- No job in the queue → nothing floats on screen.
- The 10 s auto-hide counts only while the window is shown and focused: an import that ends while the window is
  hidden (Run in Background) keeps its result pill until the window is shown again, then the 10 s start. The count
  pauses while the pill has keyboard focus or the pointer is over it, and starts again when they leave.
- A new import started while a result pill is shown turns the pill back into the importing state; the earlier results
  stay in the list (and an earlier batch summary there) until Dismiss / "Clear finished".
- The phone keeps at most 200 unfinished jobs: files that would go beyond are not added and the reader gets the toast
  `queue.queueFull` ("The import queue is full. Add more when some imports have finished."). Desktop has no limit.

## Placement

- **Desktop**: bottom-right, 16 px from the window edges, above the reader's bottom chrome, `z-index` below dialogs;
  width 360 px; does not cover the Reader page-turn zone (the pill sits in the bottom-right corner).
- **Phone**: full width minus 16 px gutters, above `PhoneNav` and `env(safe-area-inset-bottom)`; targets ≥ 44 × 44;
  system Back closes the expanded card (`useBackClose`) and never cancels an import (US3 AS10).

## Behaviour

- Starting: `ImportMenu` → Add file → `pickFiles` → jobs queued → menu closes at once (SC-003: usable ≤ 2 s).
  `notAdded > 0` → toast "{n} files were not added. Pick at most 50 files at a time."; a ZIP in a multi-pick →
  toast "Pick an audiobook ZIP on its own to see its preview."
- Finishing: success → toast "{title} was added" + Open; duplicate → toast + "Open existing"; failure → toast with
  the cause. Toasts and step changes are announced in an `aria-live="polite"` region; focus never moves (FR-012).
- Toast vs result pill: a toast is shown **only for a single-file import** (a job without `batchId`: one picked file,
  URL, cloud, ZIP). A batch (multi-file pick) shows **no per-file toast**: its results reach the reader only through the
  result pill and the batch summary (FR-011a), so the same result is never shown twice.
- Elapsed counter (step without a percentage, spec SC-004): computed from `job.stepStartedAt`, shown from the 2nd second
  of the step, reset on every step change, `font-variant-numeric: tabular-nums` (also for the percentage), its 1 s timer
  runs only while the step has no percentage and the card or pill is shown; it is OUTSIDE the live region and never
  announced.
- Screen-reader announcements (one `aria-live="polite"` region, full sentences, keys `queue.announce.*`): step change
  "{step}: {name}"; success "{title} was added"; duplicate "{name} is already in the library"; failure "{name} could
  not be imported: {cause}"; batch end = the result pill's sentence. Nothing else is announced.
- "Open existing" on a `duplicate` job re-checks that the book still exists; if it was removed meanwhile, the action
  becomes "Import again" (`queue.importAgain`), which queues a new job with the same source.
- Placeholders appear on the "All books" view only and disappear on done (replaced by the real book via
  `libraryBooksStore.upsertBook`), failure or cancel. They sit in the SAME grid / list as the books (one keyed list,
  so no card is re-created when they go away): with the "Recently added" sort, the books this run imported come
  first (newest first, already their final order), then the running and waiting placeholders, then the rest
  (core `importedBookIdsOf` / `importedLeadCount`); with any other sort the placeholders come first and the imported
  books are in their sorted place, with a line "{count} books added to the Library" (`queue.placeholder.added`)
  above the list. A book that just arrived fades in (opacity only, 200 ms, none under reduced motion).
- Theme tokens only (`--lib-*`), text ≥ 4.5 : 1, `motion-safe` for the bar animation (reduced motion: static bar with
  the number), keyboard: Tab reaches pill → card actions; Esc collapses the card.

## i18n (`source/core/src/i18n/catalogue/{en,vi}/import.ts`, new keys under `queue.*`)

`queue.step.{downloading,copying,checking,reading,saving}`, `queue.waiting` ({count}), `queue.cancel`,
`queue.finishing`, `queue.open`, `queue.openExisting`, `queue.tryAgain`, `queue.dismiss`, `queue.clearFinished`,
`queue.summary.{added,already,failed,cancelled,interrupted}` (plurals), `queue.tooMany` ({count}), `queue.zipAlone`,
`queue.placeholder.{importing,waiting}`, `queue.pill` ({current},{total},{percent}), `queue.pillElapsed` ({current},{total},{elapsed}), `queue.pillDone` ({added},{failed},…), `queue.elapsed` ({seconds}), `queue.interrupted`,
`main.messages.import.{fileChanged,quitConfirm.*}` (Main, `tMain`). File names / titles are params, never translated.
Vietnamese per `specs/012-app-ui-i18n/contracts/glossary.md`.
