# Baseline (M0)

**Date**: 2026-10-31 | **Base commit**: `8130c17` plus the uncommitted Phase 1 changes | **Environment**: Windows, Node 22.13.0, npm 11.5.2

Recorded after T001 and rerun after the workspace changes, with the same results.

| Check | Result |
|---|---|
| SDK `typecheck`, `typecheck:tests`, `build` | Pass |
| SDK `test` against the working copy | **998 of 998 pass** |
| SDK `test` as CI runs it, before the flags are committed | 996 of 998: the 2 gate tests read `git show HEAD:…features.ts`, so they stay red until the flag change is committed |
| Desktop `typecheck`, `lint`, `e2e:typecheck`, `npx vite build` | Pass |
| `npm run dev:desktop` | Vite dev server ready and Main, Preload built. Run with `ELECTRON_RUN_AS_NODE=1`, so **no window opened** and no user data was touched; a real window was not checked |
| `npm ci --dry-run` from `source/package-lock.json` | Pass |
| Mobile `typecheck`, `typecheck:web`, `build:web` | Pass |
| Mobile Metro bundle (Android, iOS) | Failed at this date; passes since 2026-11-03: see below |
| Desktop E2E | Not run; manual only |

The working-copy result was taken with `GIT_DIR=/nonexistent`, which makes the gate tests use their documented fallback to the working file.

## Behaviour change from T001

`audiobookZipImportEnabled` and `audiobookTranscriptionEnabled` are now `false`, by the user's decision. Desktop hides audiobook ZIP import and transcription.

## Rerun after the Expo Go changes (2026-11-03)

After a real `npm ci` in `source/`, with `source/node_modules/expo` linked by Mobile's `postinstall`:

| Check | Result |
|---|---|
| `npm ci` | First run **failed** after about 20 minutes with a `node-gyp` error on `better-sqlite3`, and its log was not kept. Second run passed. A Metro process from earlier checks was stopped between the two, so that may be the cause, but this is **not proven** |
| Link after `npm ci` and after `npm install` | Present after both |
| `package-lock.json` | One added line: `hasInstallScript` for Mobile, from the new `postinstall` |
| SDK `typecheck`, `typecheck:tests`, `build` | Pass |
| SDK `test` with `GIT_DIR=/nonexistent` | 998 of 998 pass |
| Desktop `typecheck`, `lint`, `e2e:typecheck`, `npx vite build` | Pass |
| `npx electron-builder --dir` | First run failed with a transient `EPERM` renaming the output folder. Second run passed, FFmpeg verified, 0 Expo or React Native packages in `app.asar` |
| `better-sqlite3` under Electron's runtime | Loads and runs a query |
| `npx expo export` for Android and iOS | Pass |
| `npm run dev:desktop` and Desktop E2E | Not run |

## Earlier failure: Metro bundle of the template app

The failure below no longer occurs, because the template's `global.css` and NativeWind are gone (T016).

`npx expo export` stopped with `src\global.css: failed to deserialize; expected an object-like struct named Specifier, found ()`.

- Cause, by version comparison: `lightningcss` is 1.32.0 (required exactly by `@tailwindcss/node`), which the NativeWind preview CSS transform appears not to read. Both the root and the old Mobile lockfile at `8130c17` already lock 1.32.0, despite the `1.30.1` override. The `@/` alias was broken too (`'\1'`, fixed by T006), so the template could not have bundled at this commit.
- Metro itself reaches about 1,800 modules before this error.
- T016 must settle it. The WebView host needs no NativeWind.

## One-command check (T025, T027)

From `source/`: `npm run check:desktop-baseline` (or `node scripts/check-desktop-baseline.mjs`). It runs three groups
and exits non-zero if any check fails:

| Group | What | Passes when |
|---|---|---|
| `checks` | SDK `typecheck`, `typecheck:tests`, `test`, `build`; Desktop `typecheck`, `lint`, `e2e:typecheck`, `npx vite build` | Each exits 0; SDK tests have 0 failures and at least 998 passing |
| `git` | `git diff` and untracked files under `apps/reading-book-desktop/electron/` against `8130c17`; migration files against that commit | 0 changed files; same 30 migrations |
| `library` | Counts of the copied pre-change library (below) against `baseline-library.json` | Every count equal |

Options: `--only checks|git|library`, `--base <ref>`, `--library <dir>`, `--print-library`, and `--ci`, which runs the
SDK tests as CI does. Without `--ci`, the 2 feature-flag gate tests read the working file (`GIT_DIR` set to a missing
folder), because the T001 flag change is still uncommitted; once it is committed, `--ci` passes too. Desktop E2E and
`npm run dev:desktop` are not part of it (manual; T078).

First full run, 2026-11-04: **25 of 25 pass** (SDK tests 998 of 998). The `git` group was also run against `HEAD~3`,
where `electron/` differs, and failed as it should.

## Pre-change library check (T026)

**Source**: the developer's own Desktop library, `%APPDATA%\reading-book-desktop`, last written 2026-10-31 00:17, before
any spec 008 code. Desktop was not running when it was copied. The real folder is never opened by the check: the
script refuses that path.

**Procedure** (repeat it to refresh the copy; Desktop must be closed):

1. Copy into the throw-away folder `%LOCALAPPDATA%\readmate-baseline\userdata-pre-change`:
   `reading-book.db`, `reading-book.db-wal`, `reading-book.db-shm` (always together), `books\`, `covers\`,
   `txt-edits\`, `Local Storage\`, and the 3 Main prefs files (`background-prefs.json`, `notification-prefs.json`,
   `reading-reminder-state.json`). Caches, `models\` and `transcription-models\` are left out (about 1.4 GB, not
   library data). The copy is 723 MB.
2. Keep the 3 database files alone in `%LOCALAPPDATA%\readmate-baseline\db-reference` as an untouched reference.
3. `npm run check:desktop-baseline -- --only library` compares the copy with `baseline-library.json`.
4. For T078, open Desktop on the copy, never on the real folder:
   `npx electron dist-electron/main.js --user-data-dir=%LOCALAPPDATA%\readmate-baseline\userdata-pre-change`
   after a Desktop build (the same switch the E2E fixture uses), check books, positions and annotations by eye,
   close it, and rerun step 3. Opening a book may legitimately rewrite its position; counts and ids must not change.
   Referenced books keep their absolute paths, so they open from the user's own files, read-only.

**Expected counts** (`baseline-library.json`, from the reference copy):

| Count | Value |
|---|---|
| Migrations applied | 30, last `030_audio_transcript_scope.sql` |
| Books | 36: 19 PDF, 8 Markdown, 5 EPUB, 2 MP3, 1 TXT, 1 DOCX |
| Books with a reading position (`lastReadLocation`) | 36 |
| Audiobooks with listening progress | 2 |
| Bookmarks (`notes` rows of type `bookmark`) | 11 |
| Annotations (other `notes` rows) | 48: 22 highlight, 9 underline, 7 strikethrough, 5 squiggly, 1 each of insert, replace, textbox, typewriter, attachment |
| Audiobook Notes (`audioBookmarks`) | 4 |
| Collections | 0 |
| TXT edited copies (`txt_documents`) | 1 |
| Book id and note id fingerprints | `43e952f6a299eecd`, `65a309f7d618765a` |

The library has no collections, so collection behaviour is not covered by this baseline.

## Boundary checks (US2, T028 to T035)

`npm run check:boundaries` from `source/` (also a CI step after the Mobile web build). First run 2026-11-04: all 5
checks pass on the real code and all 42 negative tests pass.

| Rule | Check | Real code |
|---|---|---|
| R1 | SDK tsconfig (`window`, `Buffer` probes fail `tsc`) | Pass |
| R2, R3 | `check-sdk-imports.mjs`: only `zustand/vanilla` and relative paths inside `src`, type-only imports included | Pass |
| R7, R8, R11 | `check-app-imports.mjs` | Pass |
| R8 | `check-mobile-ui-graph.mjs`: 591 files reached from `web/src/main.ts`; no `electron/` runtime import except `pdf-font-embed.ts` (`exceptions.json`) | Pass; without the exception it fails, so the exception is really used |
| R5 | `check-workspace-graph.mjs`: edges Desktop → SDK, Desktop → config, Mobile → Desktop, config → SDK; no cycle | Pass |
| R9 | Desktop ESLint `no-restricted-syntax` on `window.api` / `globalThis.api` / `self.api` outside `src/bridge/` | Lint green with `--max-warnings 0` |
| FR-033 | `check-no-secrets.mjs`: no secret file name in any bundle output; locally also no secret value or file content (values never printed) | Pass with the 2 local secret files, over Desktop `dist`, `dist-electron`, `release` and both Mobile outputs |

**Finding, not a violation**: 29 `book-reader-sdk/host-adapters` files (cloud providers) reach the Mobile UI bundle
through Desktop's `src/hooks/app/useLinkedLibraries.ts`. Mobile itself imports none, so R11 holds as written. They
are hidden on Mobile by the cloud gating of T068; removing them from the bundle would need that hook to load them
lazily, which is a Desktop change left for M5 if bundle size matters. `check-mobile-ui-graph.mjs` prints the count.
`check-no-secrets.mjs` searches `release/` file by file; an NSIS installer is compressed, so only the unpacked
`app.asar` is a real check there.
