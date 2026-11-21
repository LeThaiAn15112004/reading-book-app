# Quickstart: validating 016

Run everything from the repository root. E2E is not part of this (manual-only, CLAUDE.md).

## 0. Sample set (once)

Put in a folder outside the repo and outside `{userData}`: one PDF > 100 MB, one EPUB > 100 MB (with and without a
cover image), one small PDF, one TXT, one MD. Name them only by format + size in any report (FR-001).

## 1. Baseline and timing (story 1 — before changing anything else)

```bash
READMATE_TIMING=1 npm run dev            # Desktop: import + open each sample
npm run spike:import:timing -- --label baseline   # reads {userData}/logs/timing.jsonl → table
```

Phone (development build): `localStorage['readmate.devTiming'] = '1'` in the WebView devtools, import + open each
sample, read `adb logcat | grep '\[timing\]'`. Write both tables into `specs/016-faster-background-import/timing-baseline.md`.
Expected: every step of FR-002 has a duration; no line contains a title, file name or path (US1 AS4). Timing off →
no `timing.jsonl` is created.

## 2. Same result, less work (story 2)

```bash
npm run spike:import:parity        # old vs new pipeline on the sample set: rows + cover hashes identical (FR-007)
npm run spike:import:timing -- --label after   # SC-002 ≥ 40 % faster per large book (or the figure fixed in SC-002)
cd source/core && npx vitest run tests/zip/ranged-zip.test.ts tests/app-models/import-queue.test.ts
npm run mobile:test                # stage = native copy, hash = native digest, EPUB through ranges
```

Manual: import the PDF → it appears before its signature state changes from "not checked yet"; import the same file
again → duplicate message; a cover appears for the TXT / MD / PDF without the Library list blinking.

## 3. Background import (story 3)

1. Add file → pick the 5 samples → the menu closes at once (usable ≤ 2 s, SC-003); the pill shows "Importing 1 of 5".
2. Open another book, read, open Settings, Collections: the pill stays; progress moves at least every 2 s (SC-004).
3. Cancel a waiting job, then the running one during "Checking for duplicates" → nothing added; during "Saving" →
   button shows "Finishing…".
4. Batch ends → summary groups add up to 5; Open when one was added.
5. Pick 51 files → 50 queued, "1 file was not added" toast. Pick a ZIP with two PDFs → ZIP left out, toast.
6. With imports waiting: Quit from the tray → dialog names the count; Cancel keeps going; Quit → next start:
   `npm run spike:import:cleanup` reports 0 rows / copies / covers left and unchanged source hashes (SC-006).
7. Phone: same steps 1–4; switch apps during a large import; force-stop the app from Android settings, start it →
   the running file shows "Interrupted" + Try again, the waiting ones continue; Back never cancels.
8. Pick 20 books at once (Desktop and phone): the five summary groups add up to 20 and match the `books` table
   (SC-008).
9. With Run in Background on, hide the window during a large import, then import the same file in a visible window:
   compare total time and the largest progress gap (`backgroundThrottling`); write the figures in `timing-baseline.md`.

## 4. Opening is not slowed (story 4)

`READMATE_TIMING=1`: open the large PDF alone, then while a large import runs → `open-first-page` at most 20 % later
(SC-005); right after its import → at most 5 % over baseline. `bookIndex:ensure` appears in the log only after
`open-first-page`.

## Gate

`npm run check` green (typecheck, lint incl. `readmate/no-ui-literals`, core + mobile tests, boundaries,
platform-adapters, builds, build-split, `check:desktop-baseline` with the new approval lines).
