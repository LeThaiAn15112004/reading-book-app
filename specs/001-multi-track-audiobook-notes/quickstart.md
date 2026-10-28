# Quickstart: verifying Notes for Multi-Track Audiobooks

A validation guide for after implementation. It runs no Electron window and no E2E (project rule: E2E is manual-only). Contracts: [notes-ipc](./contracts/notes-ipc.md), [sdk-track-notes](./contracts/sdk-track-notes.md). Data rules: [data-model](./data-model.md).

## 0. Prerequisites

- `npm ci` / `npm install` already done once in `source/` (nothing to install for this feature).
- Do not stage `source/packages/config/features.ts` (the local `audiobookZipImportEnabled: true` is a pre-existing, uncommitted change; the existing gate test reads `features.ts` from `HEAD`, so it stays green while the local flag is on).

## 1. SDK unit tests

```bash
cd source/apps/book-reader-sdk
npx vitest run tests/audio/audio-track-notes.test.ts tests/audio/audio-bookmarks.test.ts tests/audio/audio-notes.test.ts
npm run verify        # typecheck + test typecheck + all tests + build
```

Baseline (measured before any source change): fully green — no known baseline failure. `tests/config/audiobook-zip-gate.test.ts` passes because it reads `features.ts` from `HEAD`. Any failure is therefore a regression. `npm run verify` is fine to use; running its steps separately (`npm run typecheck`, `npm run typecheck:tests`, `npx vitest run`, `npm run build`) just shows every failure instead of the first.

Expected: new `audio-track-notes` cases pass (ordering, label, jump target incl. last-2-seconds and beyond-duration, cap helper, `trackId` kept/dropped by the sanitizer); every pre-existing bookmark/notes case passes **unchanged**.

## 2. Main-side checks (real IPC handlers + SQLite)

```bash
cd source/apps/reading-book-desktop
npm run spike:audio:main
npm run spike:audio:zip-import     # remove-audiobook leaves no Notes behind
```

Expected in `spike:audio:main` (section 7):
- multi-track book: a save of Notes that all name owned tracks → `ok:true`; `getBookmarks` returns them with `trackId`.
- missing, foreign-book and unknown `trackId`, and a mixed list → `ok:false`, stored list unchanged.
- single-file book: a Note with `trackId` → `ok:false`; the existing single-file Notes round trip (its own check, unchanged) and the pre-change golden of the stored `audioBookmarks` string both pass.
- **foreign entries**: stored entries with an unowned or missing `trackId` are not returned and do not count towards the 500; after add / edit / delete they are still in the stored array (compared in canonical form; seeded entries are canonical); with 500 owned Notes plus foreign entries, editing one owned Note keeps every foreign entry.
- **cap boundary (multi-track)**: exactly 500 owned Notes ⇒ `ok:true`, all stored, foreign entries preserved; 501 ⇒ `ok:false`, stored array byte-identical. Single-file 501 ⇒ `ok:true`, first 500 kept (the pre-change golden).
- **preservation matrix**: for a multi-track book seeded with `lastReadLocation`, `fontSize`, an unknown `futureKey` and an `audioProgress` (with `trackId`, no `percent`), the parsed state minus `audioBookmarks` is deep-equal to the seed after each add / edit / delete, and `audioProgress` is byte-identical; the reverse (progress save leaves `audioBookmarks` identical) also holds, for multi-track and single-file books.

## 3. Renderer store checks (real store, scriptable `Audio`)

```bash
cd source/apps/reading-book-desktop
npm run spike:audio:store
```

Expected: all pre-existing single-file checks (Notes add/edit/persist/reload/delete/cap, chapters, progress payload shape) pass **without modification**, plus the new multi-track suites:
- add Note on current track (with/without text), absent while `switching`, with a failed current track, or before ready;
- order across tracks; same-second Notes both kept; edit keeps track + position; delete after confirm;
- jump on the current track = seek only (no new element); jump to another track while playing / paused keeps the play state; Note at `duration − 1` lands exactly; Note beyond the duration lands at the end;
- rapid jumps A→B→C end on C at C's second; a late `loadedmetadata` of B never seeks C;
- add / edit / delete issue **zero** `saveAudioProgress` calls; a jump saves the old track first, then only `{trackId: target, positionSeconds}` (no `percent`, `durationSeconds`, `chapterId`);
- failed target: origin track restored paused at its position, target marked failed, notice names the target; stored progress ends at the origin;
- failed target **after** a newer Contents click / newer Note jump / auto-advance: no fallback, the newer action wins; target failing after it already loaded: no fallback;
- both fail: standard error notice, no loop, no progress saved for either track; jump with no settled origin: no fallback;
- a second Note on the track that is still loading is not lost (the track is reopened at the last requested second);
- rejected `getBookmarks` in a multi-track book: add / edit / delete are no-ops and nothing is written;
- 500 Notes: the 501st is refused with a notice; refused save reloads the list;
- `status === 'ready'` in every observed state.

## 4. Static checks

```bash
cd source/apps/reading-book-desktop
npm run typecheck
npm run lint
npx vite build
```

Expected: no errors, no warnings (`--max-warnings 0`).

## 5. Manual script (a person, once, with the 68-track ZIP)

1. Open the multi-track audiobook; the Notes tab is in the left rail; the list is empty with an explanation (US2 #4).
2. On track 3 at ~1:00 add a Note without text; on track 12 at ~3:20 add one with text; on track 30 add one near the end of the track.
3. Open Notes: three entries in track order, each "NN · Title" with an in-track timestamp (US2 #1–2).
4. Click the track-30 Note while playing track 12 → plays track 30 at that second; pause, click the track-3 Note → stays paused at that second (US3 #1–2). Click a Note on the current track → only the position moves.
5. Quit and restart the app; the Notes and their jumps are intact (US1 #3, US3 #5).
6. Edit one Note's text, clear another's, delete the third with confirmation, cancel one deletion (US4).
7. Temporarily make one track file unreadable (rename it in the app's books folder), click its Note → message names the track, you are back on the previous track and can keep listening; restore the file.
8. Current-track markers appear on the seek bar and follow track changes (US5).
9. A single-file audiobook: add/edit/jump/delete a Note exactly as before (US6). Open a PDF and an EPUB with annotations: nothing changed.
10. Remove the multi-track audiobook; re-importing it later starts with no Notes.

## 6. Done when

All of 1–4 pass, the manual script passes, `git status` shows no change to migrations, `package.json` / lockfiles, config, `preload.ts`, `channels.ts`, PDF/EPUB/TXT code or the ZIP import code.
