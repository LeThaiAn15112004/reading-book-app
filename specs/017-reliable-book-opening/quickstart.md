# Quickstart: validating 017

Run from the repository root. E2E stays manual-only (CLAUDE.md). Samples live outside the repo; reports name them by
format + size only.

## 0. Sample set

At least 30 valid books: EPUB (small, > 50 MB, many images, one with a saved position that no longer fits), PDF
(small, > 100 MB, one with annotations), TXT, MD; plus one moved file, one damaged EPUB, one DRM / password book, and a
folder synced by a cloud drive client (OneDrive / Google Drive) with 10 books in it.

## 1. Baseline (before any change)

```powershell
$env:READMATE_TIMING='1'; npm run dev      # open each sample 5 times
npm run spike:import:timing -- --label open-baseline
```

Phone: dev build, `localStorage['readmate.devTiming']='1'`, open each sample, `adb logcat | findstr "[timing]"`.
Write tap → first page per sample into `timing-baseline.md`.

## 2. Never stuck (US1)

1. Open a large book; press Back / Esc / system Back at each step → Library within 1 s; reopen → opens cleanly (SC-003).
2. `spike:open:limits` (new): a renderer step that never resolves → error "took too long" after 20 s with Try again /
   Open from the beginning / Back (SC-002).
3. Open the book whose saved position no longer fits → opens at the chapter start with the note, no error.
4. Phone: open a book right after returning from the background, and while an import runs → opens (SC-001).
5. Moved file → error within 2 s with Locate file (Desktop) / import-again text (phone) (SC-004).
6. Each sample 5 × on both hosts → 0 "cannot open" for valid books (SC-001).

## 3. One waiting screen (US2)

Every format, both hosts, light + dark, reduced motion on / off, Narrator / TalkBack: cover + title at once; indicator
only after 300 ms; step line changes; slow note after 5 s; no second screen; focus to the page; contrast ≥ 4.5 : 1.

## 4. Less work (US3)

```powershell
npm run spike:import:timing -- --label open-after     # SC-005: ≥ 30 % faster for books > 50 MB, none slower
```

Turn 10 pages right after the first page of the large EPUB → none > 300 ms (SC-006). Open a PDF with annotations →
live sync still picks up an edit made in another reader.

## 5. Import without false failures (US4)

1. Pick 50 books (10 in the cloud-synced folder); let the queue run > 30 min → 50 / 50 added (SC-007).
2. Touch a file's modification time during its import (`(Get-Item f).LastWriteTime = Get-Date`) → added; change its
   content → "changed while it was being imported".
3. Phone: pick 10, force-stop during the queue, reopen → readable ones continue, others "Interrupted — pick the file
   again"; messages in Vietnamese with the UI in Vietnamese.

## Gate

`npm run check` green (typecheck, lint incl. `readmate/no-ui-literals`, core + mobile tests, boundaries, builds,
`check:desktop-baseline` with the new approval lines); `spike:import:parity|queue|cleanup` still green.
