# E2E testing for the desktop app — survey and plan

Status: **survey / plan only.** No package installed, no application code changed, nothing launched
by this document. Every statement under §1–§2 was read from the repo; statements about third-party
tools (§3) are from general knowledge and must be re-checked at install time (see §9 "To verify").

## 1. Audit (current state)

| Area | Finding |
|---|---|
| Workspaces | `source/package.json`: `workspaces: apps/*, packages/*`; only a `babel-plugin-module-resolver` devDependency at the root |
| Desktop scripts | `dev`, `typecheck`, `lint`, `build` (`tsc && vite build && electron-builder`), `preview`, `spike:*` — **no `test` / `e2e` script** |
| SDK scripts | `typecheck`, `typecheck:tests`, `test` (vitest), `build`, `verify` |
| E2E framework | **None.** No `playwright.config.*`, `wdio.conf.*`, `@playwright/test`, `playwright`, `webdriverio`, `spectron` in any workspace; no `*.e2e.*` / `*.spec.*` files |
| `data-testid` | **None** in `src/`. Selectors must use roles / `aria-label` / `title` / text until some are added |
| CI | `.github/workflows/ci.yml`: one Ubuntu job, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; SDK typecheck/test/build + desktop typecheck/lint. **Never launches Electron** |
| Electron entry | `main: dist-electron/main.js`, preload `dist-electron/preload.mjs`, renderer `dist/index.html`. `vite build` alone produces all three (electron-builder is not needed) |
| Window | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Dev server URL opens a **detached DevTools** window on launch |

### Test taxonomy in this repo

| Kind | What exists | Runs the real Electron app? | Real UI? |
|---|---|---|---|
| Unit | `book-reader-sdk/tests/**` (vitest, node env) | no | no |
| Integration | `book-reader-sdk/tests/integration/reader-flow.test.ts` (public SDK API on `createInMemoryStorage()`) | no | no |
| Spike scripts | `desktop/spikes/*` — Node scripts that import Main/renderer **modules** with stubbed `electron` / real stores / real SQLite | no | no (stores and logic only) |
| **E2E** | **nothing** | — | — |

The spikes are the closest thing, but none starts Electron, renders React, or clicks anything. So
the PDF selection menu, `Copy with Citation`, bookmark toggling and bookmark restore are today
covered by **type-checking and manual testing only**.

## 2. Facts that shape the design

1. **File import goes through a native dialog in Main** (`import.ipc.ts` `importFromFile` →
   `dialog.showOpenDialog`). The renderer never supplies a path. An E2E run therefore cannot type a
   path into the app; it must stub `dialog.showOpenDialog` **in the Main process**
   (`electronApp.evaluate`). No app change needed.
2. **All persistent state is under `app.getPath('userData')`** — `reading-book.db`,
   `books/`, `covers/`, `*-prefs.json`, `cloud-tokens/`, `models/`. Pointing `userData` at a temp dir
   isolates everything. (Renderer `localStorage` lives in the same dir.)
3. **Single-instance lock** is keyed on `userData`, so a test instance with its own dir does not
   collide with the developer's running app.
4. **OS side effects at startup** (`main.ts`): `app.setAsDefaultProtocolClient('readmate-reader')`
   runs on every launch, including unpackaged. Under test it would **re-point the user's real
   `readmate-reader://` handler at the test Electron binary** (HKCU on Windows). This is the one
   place the isolation is not free — see §5 / R1.
5. **`better-sqlite3` is built for the Electron ABI** (`postinstall: electron-builder install-app-deps`),
   so a Node-side test runner **cannot `require` it** to inspect the DB. State must be asserted via the
   UI, or via `electronApp.evaluate` inside Main.
6. **The reference-based library never copies the book**, so fixtures can sit in a temp dir and the
   "file is never mutated" invariant can be asserted by hashing the fixture before/after.
7. **Fixtures already exist as generators**: `npm run spike:pdf:fixtures` →
   `spikes/pdf-search/fixtures/text.pdf` (3 pages, "Hello Readmate", "fox"); `npm run spike:epub:fixture`
   → `spikes/epub-engine/fixtures/spike-sample.epub`. Both are deterministic, dependency-free.
8. **UI hooks already available**: context menu is `role="menu"` / `role="menuitem"` with text
   `Copy`, `Copy with Citation`, `Bookmark here` (`HighlightContextMenu.tsx`); footer bookmark button
   has `title="Bookmark this place"` / `"Remove bookmark"`; PDF pages are `[data-page-number]` slots
   with a `.textLayer`; sidebar bookmark delete is `aria-label="Delete bookmark"`.

## 3. Tool evaluation

| | Playwright (`_electron`) | WebdriverIO + `wdio-electron-service` | Spectron |
|---|---|---|---|
| Launch Electron directly | `electron.launch({ args: ['dist-electron/main.js', '--user-data-dir=…'], env })` | via service + chromedriver | deprecated, unmaintained |
| Extra moving parts | one npm dev dependency, uses the repo's own `electron` binary, no browser download | chromedriver must match Electron 39's Chromium; more config | — |
| Run code **inside Main** | `electronApp.evaluate(({ dialog, clipboard }) => …)` — needed for dialog stub and clipboard read | supported via service, less direct | — |
| Failure artifacts | built-in trace, screenshot, video, HTML report | screenshot hook by hand | — |
| Runner | `@playwright/test` (fixtures, retries, projects) | mocha/jasmine/cucumber | — |
| Fit | **High** | Medium | Reject |

**Recommendation: Playwright with its Electron API.** The two Main-process hooks that this app
needs (stub native dialog, read system clipboard) are first-class there, and the failure tooling is
the best of the options. Caveat: Playwright documents its Electron support as experimental → pin the
exact version and keep the harness thin (§9).

## 4. Proposed layout

```
source/apps/reading-book-desktop/
├── e2e/
│   ├── playwright.config.ts
│   ├── fixtures/
│   │   ├── app.ts              # launchApp({ userDataDir, openDialogPath }) + teardown
│   │   └── library.ts          # importBook(page, app, absPath)
│   ├── support/
│   │   ├── build-fixtures.mjs  # writes PDF/EPUB into a temp dir (reuses spikes generators)
│   │   └── stub-dialog.ts
│   └── specs/
│       ├── pdf-selection.spec.ts
│       ├── pdf-bookmark.spec.ts
│       └── epub-regression.spec.ts
└── test-results/ , playwright-report/   # gitignored
```

E2E stays inside `reading-book-desktop` (no new workspace) and out of the root `workspaces` glob.

## 5. Test data isolation

Per test file (or per worker) a fresh `os.tmpdir()/readmate-e2e-<random>/`:

| Concern | Mechanism |
|---|---|
| DB, covers, prefs, `localStorage`, token vault | `--user-data-dir=<tmp>/userData` as an Electron arg |
| Books | generated fixtures in `<tmp>/books/`; referenced in place (never copied), real library untouched |
| Native file picker | `electronApp.evaluate` replaces `dialog.showOpenDialog` → `{ canceled:false, filePaths:[fixture] }` |
| Real library safety net | the harness **refuses to start** if the resolved userData path is not inside the temp root (checked in `electronApp.evaluate(app.getPath('userData'))` before any test action) |
| `readmate-reader://` handler, tray, login item | **needs a small gate in Main** (`READMATE_E2E=1` skips `setAsDefaultProtocolClient`, tray, reminders, login item). This is the only proposed application change; it is deferred until approved |
| Cleanup | `app.close()` then `fs.rm(tmp, { recursive })`; kept when the test failed, so the DB can be inspected |

Restore test: close with `app.close()` (goes through the session-flush handshake, same as a user
closing the window), relaunch with the **same** userData dir.

## 6. Scenarios

All run on built output (`vite build`), not the dev server, so no DevTools window and no HMR.

| # | Flow | Steps | Assertion |
|---|---|---|---|
| E1 | Open PDF | stub dialog → click Import → open `text.pdf` | Reader visible, `[data-page-number="1"] .textLayer` contains "Hello Readmate" |
| E2 | Select text | in page 1 text layer, select the "fox" sentence (mouse drag across the span rect; fallback: `Range` + `Selection` via `page.evaluate`) | `getSelection().toString()` equals the sentence |
| E3 | Copy | right-click inside the selection → menuitem `Copy` | `electronApp.evaluate(({clipboard}) => clipboard.readText())` equals the sentence; menu closed |
| E4 | Copy with Citation | same → `Copy with Citation` | clipboard matches `"…" — <Title>, <Author> (p. 1)`; second case across pages 1–2 expects `(pp. 1–2)` |
| E5 | Right-click outside selection | right-click on blank area of the page | no `role="menu"` (and no native menu) |
| E6 | PDF bookmark | click footer "Bookmark this place" on page 2 | button title becomes "Remove bookmark"; TOC sidebar lists a bookmark for p. 2 |
| E7 | Bookmark via context menu | select on page 3 → `Bookmark here` | bookmark appears for p. 3 (first page of selection) |
| E8 | Restore | `app.close()` → relaunch same userData → open the book | both bookmarks listed; footer shows "Remove bookmark" when on p. 2 |
| E9 | EPUB regression | import `spike-sample.epub`; select text → right-click | menu has Highlight / Underline / Strikethrough / Add note **and** Copy / Copy with Citation; Copy puts text on clipboard; highlight survives relaunch |
| E10 | Invariant | SHA-256 of fixtures before/after the run | unchanged |

Limits to be honest about: pixel-exact selection geometry depends on the PDF.js text layer and DPI;
E2 is the flakiest step, which is why the programmatic-`Range` fallback is part of the design, and
what it verifies (the menu + clipboard + bookmark logic) is exactly what the recent change added.

## 7. npm scripts (proposed, desktop workspace)

```jsonc
"e2e:prepare": "node e2e/support/build-fixtures.mjs",
"e2e:build":   "vite build",                       // dist/ + dist-electron/, no installer
"e2e":         "npm run e2e:build && npm run e2e:prepare && playwright test -c e2e/playwright.config.ts",
"e2e:headed":  "npm run e2e -- --headed",
"e2e:debug":   "npm run e2e -- --debug",
"e2e:report":  "playwright show-report e2e/playwright-report"
```

Config highlights: `workers: 1` (one SQLite/userData per test, deterministic), `retries: 0` locally
and `1` in CI, `timeout: 60_000`, `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`,
`video: 'retain-on-failure'`, reporter `list` + `html`.

### Screenshots / logs on failure

| Artifact | Source |
|---|---|
| Screenshot, video, trace (DOM snapshots, network, console) | Playwright, written to `test-results/` per failed test |
| Renderer console + page errors | `page.on('console' / 'pageerror')` collected by the fixture and attached with `testInfo.attach` |
| Main-process stdout/stderr | `electronApp.process().stdout/stderr` attached on failure |
| App data | kept `userData` temp dir path printed on failure |
| Open in viewer | `npx playwright show-trace test-results/<test>/trace.zip` |

## 8. CI

Keep the existing job untouched (it intentionally skips the Electron download). Add a **separate**
`e2e` job, not on every push at first (`workflow_dispatch` + PRs touching `source/apps/reading-book-desktop/**`):

- runner: `windows-latest` (matches the primary dev platform and the title-bar overlay code path),
  or `ubuntu-latest` + `xvfb-run` as a cheaper second step;
- real `npm ci` (Electron binary + `better-sqlite3` rebuild for Electron), then `npm run e2e`;
- `actions/upload-artifact` for `test-results/` and `playwright-report/` on failure.

## 9. Dependencies, risks, to verify

### New dependencies (not installed)

| Package | Where | Purpose |
|---|---|---|
| `@playwright/test` (pin exact) | desktop `devDependencies` | runner + `_electron` API. No browser download is needed (uses repo's `electron`) — run `npm i` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` |
| *(none else)* | | PDF/EPUB fixtures reuse the existing generators; no `pdf-lib` etc. |

### Pros / cons

| + | − |
|---|---|
| Covers what no current test can: real PDF.js text layer, selection, context menu, clipboard, SQLite restore | Slowest suite in the repo (launch ≈ seconds per test) |
| One dependency, runs on the repo's own Electron | Playwright's Electron API is labelled experimental |
| Rich failure artifacts out of the box | Selection via mouse is geometry-dependent |
| No `data-testid` required to start | Role/text selectors break on copy changes → add a few `data-testid` later |

### Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Test launch re-registers `readmate-reader://` to the test binary (real user side effect) | `READMATE_E2E` gate in Main (needs approval, §5); until then run E2E only on CI / a throwaway VM, and document it |
| R2 | Real `userData` touched by a mis-launched app | harness asserts `userData` is inside the temp root before any action; never launches without `--user-data-dir` |
| R3 | `better-sqlite3` unusable from the Node test process | assert through UI or `electronApp.evaluate`; never `require('better-sqlite3')` in specs |
| R4 | `ready-to-show` / tray / background mode makes the window hidden | tray prefs default off in a fresh userData; verify, else gate with `READMATE_E2E` |
| R5 | Playwright ↔ Electron 39 compatibility | verify before adopting (below) |
| R6 | Flaky drag selection | programmatic `Range` fallback; assert on outcomes, not coordinates |

### Spike result (step 1, run 2026-10-13 on Windows 11, Node 22.13)

`npm run spike:e2e:launch` (`spikes/e2e-launch/launch.mjs`) launched the **built** app with Playwright 1.64.0 against Electron 39.8.10.

- [x] `_electron.launch` works with `dist-electron/main.js`. It must be given `executablePath` (resolved from the desktop workspace via `createRequire`), because Playwright resolves `electron` from the hoisted root where it does not exist.
- [x] `--user-data-dir` is honoured: `app.getPath('userData')` was inside the temp root; the library was empty (fresh DB).
- [x] Window is visible (1 window), title "Readmate Reader", Library screen rendered (screenshot checked). No tray/background interference on a fresh userData.
- [x] Plain `vite build` output launches; no electron-builder needed.
- [x] **R1 confirmed**: without a gate, the launch overwrote `HKCU\Software\Classes\readmate-reader\shell\open\command` (script argument became `--inspect=0`). Fixed by the `READMATE_E2E=1` gate in `electron/main.ts`; the spike sets it and the registry value was byte-identical before/after.
- Still open: the `READMATE_E2E` gate covers only protocol registration. Tray / login item / reminders were not observed to misbehave on a fresh userData, so they are not gated.

## 10. Rollout steps

1. **Spike (≈ half a day):** install Playwright in a scratch branch, launch the built app with a temp
   userData, print `userData`, take one screenshot. Resolves every "to verify" item. No scenarios yet.
2. **Harness:** `e2e/` skeleton — launch fixture, dialog stub, userData guard, artifact attachment,
   `e2e:*` scripts, `.gitignore` entries.
3. **E1–E5** (PDF open / select / Copy / Copy with Citation).
4. **E6–E8** (bookmark + restore across relaunch).
5. **E9–E10** (EPUB regression + invariant).
6. **Gate (`READMATE_E2E`)** in Main — done with the spike (R1 confirmed).
7. **CI `e2e` job**, then decide whether it becomes required.

Each step is its own commit; steps 1–2 change `package.json` / lockfile only; step 6 is the only one
touching application code.
