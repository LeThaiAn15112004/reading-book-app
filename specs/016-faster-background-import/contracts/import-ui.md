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

## Placement

- **Desktop**: bottom-right, 16 px from the window edges, above the reader's bottom chrome, `z-index` below dialogs;
  width 360 px; does not cover the Reader page-turn zone (the pill sits in the bottom-right corner).
- **Phone**: full width minus 16 px gutters, above `PhoneNav` and `env(safe-area-inset-bottom)`; targets ≥ 44 × 44;
  system Back closes the expanded card (`useBackClose`) and never cancels an import (US3 AS10).

## Behaviour

- Starting: `ImportMenu` → Add file → `pickFiles` → jobs queued → menu closes at once (SC-003: usable < 1 s).
  `notAdded > 0` → toast "{n} files were not added. Pick at most 50 files at a time."; a ZIP in a multi-pick →
  toast "Pick an audiobook ZIP on its own to see its preview."
- Finishing: success → toast "{title} was added" + Open; duplicate → toast + "Open existing"; failure → toast with
  the cause. Toasts and step changes are announced in an `aria-live="polite"` region; focus never moves (FR-012).
- Placeholders appear on the "All books" view only and disappear on done (replaced by the real book via
  `libraryBooksStore.upsertBook`), failure or cancel.
- Theme tokens only (`--lib-*`), text ≥ 4.5 : 1, `motion-safe` for the bar animation (reduced motion: static bar with
  the number), keyboard: Tab reaches pill → card actions; Esc collapses the card.

## i18n (`source/core/src/i18n/catalogue/{en,vi}/import.ts`, new keys under `queue.*`)

`queue.step.{downloading,copying,checking,reading,saving}`, `queue.waiting` ({count}), `queue.cancel`,
`queue.finishing`, `queue.open`, `queue.openExisting`, `queue.tryAgain`, `queue.dismiss`, `queue.clearFinished`,
`queue.summary.{added,already,failed,cancelled,interrupted}` (plurals), `queue.tooMany` ({count}), `queue.zipAlone`,
`queue.placeholder.{importing,waiting}`, `queue.pill` ({current},{total},{percent}), `queue.interrupted`,
`main.messages.import.{fileChanged,quitConfirm.*}` (Main, `tMain`). File names / titles are params, never translated.
Vietnamese per `specs/012-app-ui-i18n/contracts/glossary.md`.
