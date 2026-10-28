# Quickstart: verifying Notes Grouped by Track

A validation guide for after implementation. It runs no Electron window and no E2E (project rule: E2E is manual-only). Contracts: [sdk-note-groups](./contracts/sdk-note-groups.md), [notes-tab-ui](./contracts/notes-tab-ui.md). Data rules: [data-model](./data-model.md).

## 0. Prerequisites

- `npm ci` / `npm install` already done once in `source/` (nothing to install).
- The baseline is green before the first edit (it was at the end of feature 001): run section 1 and 2 once untouched; any red later is a regression.
- Do not stage `source/packages/config/features.ts` (the local `audiobookZipImportEnabled: true` is a pre-existing, uncommitted change; the existing gate test reads `HEAD` and stays green).

## 1. SDK unit tests

```bash
cd source/apps/book-reader-sdk
npx vitest run tests/audio/audio-track-notes.test.ts
npm run typecheck && npm run typecheck:tests && npx vitest run && npm run build
```

Expected: the new `groupNotesByTrack` cases pass — only tracks with Notes; group order = track order for any input order; in-group order (second, then `createdAt`, then input order); `count`; each Note in exactly one group and counts sum to the number of known-track Notes; excluded single-file / unknown-track Notes; duplicate track ids; equal titles; no mutation; 500 Notes over 68 tracks and 500 in one track. Every case that existed before passes **unchanged**.

## 2. Renderer store checks (real stores, scriptable `Audio`)

```bash
cd source/apps/reading-book-desktop
npm run spike:audio:store
npm run spike:audio:main && npm run spike:audio:zip-import
```

Expected in `spike:audio:store`: all existing checks (single-file Notes, feature 001's multi-track Notes suites) pass **unmodified**, plus the new groups-store suite:

- **seeding**: `ensureSeeded(trackId)` opens exactly that row once; a second call (or a call with another track) changes nothing; a row opened earlier stays open;
- **toggle**: open/close one row, several open at once, others untouched;
- **add opens its row**: `addNote()` as the "+ Note" pill calls it opens that track's row — also for a track that had no Notes — with no component mounted; `lastAddedNote` is a new object each add;
- **no false signals**: `lastAddedNote` and `open` are unchanged by `load`, a refused-save reload, edit, delete, a 501st-Note refusal, and Note jumps;
- **no auto open/close**: Contents click, next/previous, auto-advance, Note jump and a failed-jump fallback leave `open` identical;
- **memory**: the state is still there when read back after "closing the tab" (the store is outside React); loading another audiobook clears it; reopening the same audiobook clears it;
- **unavailable**: with `notesUnavailable` the store still holds its state and `groupNotesByTrack` is not asked for rows (the tab shows the message);
- **single-file**: a single-file audiobook never sets `lastAddedNote` and never touches the groups store (no seeding).

## 3. Static checks

```bash
cd source/apps/reading-book-desktop
npm run typecheck
npm run lint
npx vite build
```

Expected: no errors, no warnings (`--max-warnings 0`).

## 4. Manual script (a person, once, with the 68-track ZIP)

1. Open the multi-track audiobook, open the left sidebar → Notes. With no Notes: the explanatory empty state.
2. On track 3 (~1:00), track 12 (~3:20 and ~7:45) and track 30 add Notes (one with text, the rest plain).
3. Notes tab: exactly three rows — 03, 12 (count 2), 30 — and none for the other 65 tracks. The row of the track you are on is marked "Playing" and is the only one open (US1, US2 #5).
4. Open track 12 with the mouse, then close it; open it again with the keyboard (Tab to the row, Enter/Space). Open two rows at once. Focus stays on the row after toggling (FR-005, FR-006, FR-020).
5. Inside an open row: the Notes are in time order with their timestamps; click one on another track (plays there at that second); edit a Note's text; delete one after confirming; cancel one deletion (US3). Delete the only Note of track 3: its row disappears.
6. Close the sidebar (or switch to Contents) and reopen Notes: the rows you opened or closed are as you left them (FR-016).
7. Close the sidebar, add a Note on a track that had none using the "+ Note" pill, reopen Notes: a new row for that track exists, open, with the Note (FR-013).
8. Let playback move to another track (or press Next): no row opens or closes by itself; the "Playing" mark follows (FR-014, FR-015).
9. Quit and restart: the Notes are all there; only the playing track's row is open (FR-016).
10. Measure once: an audiobook with ~500 Notes — opening the tab and opening/closing rows shows no freeze > 1 s (SC-005).
11. A single-file audiobook: the Notes tab is the flat list as before (US5). Open a PDF and an EPUB with annotations: nothing changed.

## 5. Done when

All of 1–3 pass, the manual script passes, and `git status` shows no change to migrations, `package.json` / lockfiles, config, `preload.ts`, `channels.ts`, `bridge/audio.ts`, Main-process persistence, PDF/EPUB/TXT code or the ZIP import code.
