---

description: "Task list for the Microsoft Store (MSIX) package of the Desktop app"
---

# Tasks: Microsoft Store Package for the Desktop App

**Input**: Design documents from `/specs/010-msix-store-packaging/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R12), data-model.md, contracts/ (store-build, store-icons,
store-import, packaged-runtime), quickstart.md

**Tests**: Included. plan.md requires core vitest cases (`source/core/tests/store-import/*`), `node --test` self-tests
for the build scripts (same pattern as `check-desktop-package.test.mjs`), the spikes `spike:store:import` and
`spike:store:packaged` (S1–S5), and the manual smoke-test list. E2E stays manual-only, so no task runs it.

**Organization**: by user story. Phase order differs from priority in one place: **US4 (signing, P2) comes before
US2 (P1)**, because a package can only be installed for testing once it is signed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1…US6 (spec.md)
- Paths are relative to the repository root. `EL` = `source/app/platforms/electron`, `CORE` = `source/core`,
  `ST` = `source/scripts/store`.

## Standing rules for every task

- Every Store branch in Main tests `process.windowsStore === true`. The direct build's behaviour must not change.
  The one intended direct-build change is its icon (US3).
- `CORE/src/store-import/` stays pure: no Node, DOM, Electron or `better-sqlite3`; relative imports only (R1–R3).
- The import never opens the direct build's folder `%APPDATA%\reading-book-desktop` with SQLite and never writes,
  renames or deletes anything in it (contracts/store-import.md).
- No new dependency is downloaded. `sharp` is declared as a devDependency at its installed version `0.35.5` (T003).
- New IPC goes through the four places (`EL/ipc/channels.ts`, `EL/ipc/<feature>.ipc.ts` + `EL/ipc/index.ts`,
  `EL/preload.ts` + `EL/ipc/api-types.ts`, `source/app/bridge/`). Mobile must provide the same method names, because
  its `api` is typed as Desktop's `Window['api']`; there they answer `NOT_AVAILABLE_ON_PLATFORM`.
- Every changed or new file under `EL/` gets an entry with its reason in `source/scripts/desktop-main-changes.json`
  (prefix the reason with `spec 010 Tnnn:`). `npm run check:desktop-baseline` must pass.
- Secrets: never print, log or write `READMATE_STORE_TEST_PFX_PASSWORD`; never add a `.pfx` / `.p12` to the repo.
- After each code task: `npm run typecheck`, `npm run lint`, `npm run sdk:test` (core tasks), `npm run build`. Before
  the end of each phase: `npm run check`.
- Store scripts exit 0 with `skipped: the Microsoft Store package is built on Windows only` when
  `process.platform !== 'win32'`.
- Follow the user's `auto-commit-and-push` preference during `/speckit-implement`. Never push directly to `main`.

---

## Phase 1: Setup

**Purpose**: places for the new code and records. Nothing functional yet.

- [X] T001 Add to `.gitignore`: `*.pfx`, `*.p12`, `.readmate-signing/`, `source/app/platforms/electron/build-resources/`, `source/app/platforms/electron/store/.cache/`
- [X] T002 [P] Create the folder `source/scripts/store/` with empty ESM modules (`export {}` plus a header comment naming the contract section): `package-store.mjs`, `check-store-config.mjs`, `check-store-secrets.mjs`, `check-external-paths.mjs`, `generate-icons.mjs`, `ico-writer.mjs`, `check-store-icons.mjs`, `run-wack.mjs`, `platform-guard.mjs`. `platform-guard.mjs` exports `requireWindows(scriptName)`: off Windows it prints the skip message and exits 0
- [X] T003 [P] In `package.json`: add `sharp` `0.35.5` to `devDependencies` (exact version, already in `node_modules`; run `npm install --prefer-offline` and confirm `package-lock.json` changes only by the `devDependencies` entry). Add the scripts `package:store`, `store:icons`, `store:wack`, `check:store-config`, `check:store-secrets`, `check:external-paths`, `spike:store:import`, `spike:store:packaged` pointing at the files of T002 and the spikes of T053 / T037 (contracts/store-build.md "Commands")
- [X] T004 [P] Create `docs/store/` with stub files: `checklist.md`, `submissions.md` (table header `Version | Date | Package SHA-256 | WACK | Smoke | Result | Notes`, no rows), `smoke-tests.md`, `signing.md`, `privacy-facts.md`, `listing/en-US.md`, `listing/vi-VN.md`, `wack/.gitkeep`; and `docs/implementation_plan/msix_store_packaging.md` (map stub linking spec, plan, research, contracts)
- [X] T005 [P] Create `CORE/src/store-import/index.ts` (empty exports) and export it from `CORE/src/index.ts`. Create `CORE/tests/store-import/` with one placeholder `describe` per future file: `plan.test.ts`, `rewrite-root.test.ts`, `schema.test.ts`, `marker.test.ts`

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Store config and version that every story builds on.

**⚠️ CRITICAL**: no user story starts before this phase is done.

- [X] T006 Create `EL/store/store-identity.json` with the fields of data-model §1, the placeholder `__FROM_PARTNER_CENTER__` for `identityName`, `publisher` and `publisherDisplayName`, and these fixed values: `applicationId` `ReadmateReader`, `displayName` `Readmate Reader`, `languages` `["en-US", "vi-VN"]`, `backgroundColor` `transparent`, `minVersion` `10.0.17763.0`, `maxVersionTested` `10.0.26100.0`, `capabilities` `["runFullTrust"]`, `addAutoLaunchExtension` `false`
- [X] T007 Create `EL/store/appx-extensions.xml` with exactly the `desktop:Extension` / `desktop:StartupTask TaskId="ReadmateReaderStartup" Enabled="false"` element and `uap10:Parameters="--hidden-at-startup"` from contracts/packaged-runtime.md. Then create `EL/store/appxmanifest.xml` from `node_modules/app-builder-lib/templates/appx/appxmanifest.xml`: keep every `${macro}` and add `xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"` plus `IgnorableNamespaces="uap10"` on `<Package>`
- [X] T008 Create `electron-builder.store.cjs` (CommonJS, read by `electron-builder --config`). It must:
  - set `extends: './electron-builder.json5'` and override `win.target` → `[{ target: 'appx', arch: ['x64'] }]`;
  - repeat the FFmpeg entry in `win.extraResources`, because arrays replace and do not merge, and add `{ from: 'source/app/platforms/electron/store/startup-task.ps1', to: 'store/startup-task.ps1' }`;
  - set `directories.buildResources` → `source/app/platforms/electron/build-resources` and keep the base `directories.output`;
  - add `appx` = the contents of `EL/store/store-identity.json` + `customExtensionsPath`, `customManifestPath` (paths of T007; `customManifestPath` is resolved against `buildResources`, so `generate-icons.mjs` also copies `appxmanifest.xml` there, T042) + `artifactName: '${productName}-Windows-${version}-Store.msix'`.

  Verify with `npx electron-builder --config electron-builder.store.cjs --win dir` that it resolves (this needs T009's version)

  _Done 2026-11-08, two deviations found while implementing:_
  - _electron-builder concatenates arrays when merging configs, it does not replace them. So `win.extraResources`
    only adds the `.ps1` (the FFmpeg entry is inherited, not repeated), and `package-store.mjs` passes `--win appx`
    (command-line targets replace the base `nsis` target)._
  - _`customManifestPath` falls back to a path relative to the project, so the manifest stays in `EL/store/` and is
    not copied into `build-resources/` (this removes the T008 → T042 ordering issue, analysis F5)._

  _Checked by resolving the merged config with electron-builder's own `getConfig` (no build). The
  `--win dir` packaging run was NOT done: it is a real Windows build, so it moves to T018._
- [X] T009 Raise `extraMetadata.version` in `electron-builder.json5` from `0.0.0` to `1.0.0` (research R3) and update the matching `version` in `EL/package.json` if `check-desktop-package.mjs` / `check-desktop-baseline.mjs` compare them. If any recorded baseline asserts `0.0.0`, update that expectation and give the reason (`spec 010 T009: Store-valid release version; userData follows extraMetadata.name, unchanged`). Do not loosen any check
- [X] T010 Run `npm run check` and `npm run check:desktop-baseline`; both green

**Checkpoint**: the Store config resolves, and every existing check is green.

---

## Phase 3: User Story 1 - A Store-ready package is produced from the repository (Priority: P1) 🎯 MVP

**Goal**: `npm run package:store` writes an x64 `.msix` with the Partner Center identity next to the NSIS installer,
and refuses placeholders, invalid versions and wrong content.

**Independent Test**: on a clean clone, `npm run package:store` with placeholders fails, listing every field. With
real (or realistic test) identity values it writes `release/1.0.0/Readmate Reader-Windows-1.0.0-Store.msix`, and its
`AppxManifest.xml` matches `store-identity.json`. `npm run package` still produces the NSIS installer.

### Tests for User Story 1

- [X] T011 [P] [US1] Write `ST/check-store-config.test.mjs` (`node --test`), one case per error code in contracts/store-build.md "Errors" that this script owns:
  - `identity_placeholder` for each of the 3 placeholder fields and for `YourAppID`;
  - `identity_shape` for: `identityName` "3–50 chars `[A-Za-z0-9.-]`" (too short, too long, `_`), `publisher` "starts with `CN=`", `applicationId` "letters/digits/periods, starts with a letter, not a reserved name" (`CON`, `1App`), `capabilities` "exactly this list" (`["runFullTrust","webcam"]`), `addAutoLaunchExtension` "must be false", "min ≤ max" for `minVersion` / `maxVersionTested`;
  - `version_invalid` for `0.0.0`, `1.0`, `1.0.0.1`, `1.70000.0`, `0.9.0` (rule "`MAJOR.MINOR.PATCH`, numeric, each ≤ 65535, `MAJOR ≥ 1`");
  - `version_not_increased` for a version equal to, and lower than, the last row of a fixture `submissions.md`;
  - `extensions_invalid` when `appx-extensions.xml` has no `ReadmateReaderStartup`;
  - all errors reported together in one run;
  - `--allow-placeholders` passes placeholders but still fails a bad shape.
- [X] T012 [P] [US1] Write `ST/check-store-secrets.test.mjs` (`node --test`) on a temporary git repo: a tracked `x.pfx`, `x.p12`, or a file with `-----BEGIN PRIVATE KEY-----` / `-----BEGIN RSA PRIVATE KEY-----` → fail naming the file; an ignored (untracked) `.pfx` → pass

### Implementation for User Story 1

- [X] T013 [US1] Implement `ST/check-store-config.mjs`:
  - export `checkStoreConfig({ identity, version, extensionsXml, submissionsMd, allowPlaceholders })` returning `{ errors: { code, message }[] }`, with the message shapes of contracts/store-build.md;
  - read the version from the `extraMetadata` block of `electron-builder.json5` with one regex (no json5 parse);
  - read the last version from the last data row of `docs/store/submissions.md`;
  - CLI flags `--allow-placeholders` and `--self-test` (`--self-test` runs `node --test ST/check-store-config.test.mjs`);
  - exit 1 when there are errors, after printing all of them. T011 must pass.

  _Done 2026-11-08, one deviation (analysis F1): the "last version" is the last row whose **Result** says the package
  was sent to the Store (`submitted` / `certified` / `published` / `rejected`). A row that `store:wack` adds before
  submitting does not block rebuilding that version. `--self-test` runs every `source/scripts/store/*.test.mjs`._
- [X] T014 [US1] Implement `ST/check-store-secrets.mjs`: `git ls-files` and scan for `*.pfx`, `*.p12` and private-key PEM headers in tracked text files (skip binary files and `node_modules`). Exit 1 listing each hit. T012 must pass
- [X] T015 [US1] Implement `ST/package-store.mjs` (no signing yet, T019 adds it):
  1. `requireWindows`;
  2. `checkStoreConfig` without placeholders allowed → print all errors and exit 1;
  3. `npm run store:icons` (a no-op until US3: until then it only checks that `build-resources/appx/` exists, else warns that electron-builder's sample logos will be used);
  4. `tsc -p tsconfig.electron.json`, `npm run check:package-deps`, `npm run build`;
  5. `npx electron-builder --win --config electron-builder.store.cjs`;
  6. `node source/scripts/check-desktop-package.mjs` on `release/<version>/win-unpacked`;
  7. `node ST/check-store-package.mjs <msix>` (T016);
  8. print the package path, its SHA-256 and the "Unsigned package for Partner Center upload…" line from contracts/store-build.md.

  _Done 2026-11-08: `--test-sign` answers "not implemented yet (US4)" until T021. Signing variables are already
  removed from every child environment. Children are spawned with `node <bin>` (tsc, vite, electron-builder CLI)
  rather than `npm`, because Node 22 will not spawn `.cmd` files without a shell. Only the placeholder path was run
  (it stops before building, US1 AS 2); a real build is T018._

  Every child runs with `spawn` and an argv array; a step that fails stops with that step's name.
- [X] T016 [US1] Create `ST/check-store-package.mjs <file.msix>` (Windows): extract `AppxManifest.xml` with the system `tar.exe -xf <msix> AppxManifest.xml -C <tmp>`. Assert:
  - `Identity` `Name` / `Publisher` / `Version` (`<extraMetadata.version>.0`) equal `store-identity.json` + version;
  - `ProcessorArchitecture="x64"`;
  - the `Capabilities` children are exactly `rescap:Capability Name="runFullTrust"`;
  - exactly one `windows.protocol` named `readmate-reader`;
  - exactly one `windows.startupTask` `ReadmateReaderStartup`;
  - `TargetDeviceFamily MinVersion="10.0.17763.0"`;
  - running `tar -tf` on the package lists `app/resources/ffmpeg/win32-x64/ffmpeg.exe` and `app/resources/store/startup-task.ps1`, and no `cloud-oauth-secrets.json` / `client_secret_*.json`.

  Print one line per assertion; exit 1 on any failure.

  _Done 2026-11-08: pure `checkManifest` / `checkListing` with 13 `node --test` cases
  (`check-store-package.test.mjs`); package entry names are percent-decoded. Not run against a real `.msix` yet
  (T018)._
- [X] T017 [US1] Add `npm run check:store-config -- --allow-placeholders --self-test && npm run check:store-secrets` to the `check` script in `package.json`, after `check:boundaries`. Confirm that `.github/workflows/ci.yml` runs the same steps. If CI lists steps one by one, add these two
- [ ] T018 [US1] Validate on Windows (quickstart §1 and §3, unsigned part):
  - with placeholders, `npm run package:store` fails listing 3 fields;
  - with temporary test identity values (`identityName` `ReadmateTest.ReadmateReader`, `publisher` `CN=Readmate Test`, `publisherDisplayName` `Readmate Test`, never committed), it writes the `.msix` and T016 passes;
  - `npm run package` still writes the NSIS installer.

  Record the outcome in `docs/implementation_plan/msix_store_packaging.md`.

**Checkpoint**: an unsigned Store package can be built, and its identity and content are checked.

---

## Phase 4: User Story 4 - Signing for local testing, and for the Store (Priority: P2, needed by US2)

**Goal**: `npm run package:store -- --test-sign` signs with a test certificate whose subject equals the publisher.
Secrets never enter the repository or the logs.

**Independent Test**: create the certificate with `docs/store/signing.md`, build with `--test-sign`, and install the
package on a machine that trusts the certificate. A certificate with another subject stops the build. `git status` and
the build log contain no `.pfx` and no password.

### Tests for User Story 4

- [ ] T019 [P] [US4] Write `ST/test-sign.test.mjs` (`node --test`) for `resolveTestSigning({ argv, env, repoRoot, readSubject, publisher })` with `readSubject` stubbed:
  - `--test-sign` without `READMATE_STORE_TEST_PFX` or `READMATE_STORE_TEST_PFX_PASSWORD` → error naming the missing variable;
  - a PFX path inside `repoRoot` → `cert_in_repo`;
  - subject ≠ `publisher` → `cert_subject_mismatch` with both values;
  - expiry < 30 days → a warning;
  - success returns `{ env: { WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD } }`;
  - no returned message contains the password.

### Implementation for User Story 4

- [ ] T020 [US4] Implement `ST/test-sign.mjs`:
  - `resolveTestSigning` (T019);
  - `readPfxSubject(pfxPath, password)`: spawn `powershell.exe -NoProfile -NonInteractive -Command` with a fixed script that reads the password from an environment variable passed only to that child (never on the command line), runs `Get-PfxData`, and prints `{ subject, notAfter }` as JSON.
- [ ] T021 [US4] Wire `--test-sign` into `ST/package-store.mjs`:
  - before building, call `resolveTestSigning`;
  - pass the returned `env` only to the electron-builder child;
  - after the build, print `Signed with the test certificate <subject> (sideload only).`.

  Without `--test-sign`, strip `WIN_CSC_LINK`, `CSC_LINK`, `WIN_CSC_KEY_PASSWORD` and `CSC_KEY_PASSWORD` from the child environment, so that a stray variable never signs the upload package. Confirm with `npx electron-builder --help` / electron-builder logs that the appx target signs when `WIN_CSC_LINK` is set and that the manifest publisher equals the certificate subject.
- [ ] T022 [US4] Write `docs/store/signing.md`:
  - create the test certificate (quickstart Prerequisites commands);
  - trust it in `Cert:\LocalMachine\TrustedPeople`;
  - set the two variables for one shell session only;
  - renew it on expiry and remove it from the store;
  - why the upload package is unsigned (the Store signs it).
- [ ] T023 [US4] Validate on Windows (quickstart §3, signed part):
  - signed build → `Add-AppxPackage` succeeds;
  - a certificate with subject `CN=Wrong` → `cert_subject_mismatch`, no package;
  - `git status --ignored` shows the `.pfx` only outside the repository;
  - search the full build output for the password → no hit.

  Record the results in `docs/implementation_plan/msix_store_packaging.md`.

**Checkpoint**: a test-signed package installs locally.

---

## Phase 5: User Story 2 - The package installs and the app works like the direct build (Priority: P1)

**Goal**: inside the package the app has its own data folder, a working sign-in link, notifications, Start at Login
and paths other apps can open. The update screen names the Store.

**Independent Test**: install the test-signed package on a machine that never had Readmate. `spike:store:packaged`
S1, S2 and S4 pass, and every row of `docs/store/smoke-tests.md` passes.

### Tests for User Story 2

- [ ] T024 [P] [US2] Write `ST/external-path.test.mjs` (`node --test`, imports the pure helper from T026). `packageFamilyNameFromExecPath`:
  - `C:\Program Files\WindowsApps\12345Readmate.ReadmateReader_1.0.0.0_x64__8wekyb3d8bbwe\app\Readmate Reader.exe` → `12345Readmate.ReadmateReader_8wekyb3d8bbwe`;
  - a non-WindowsApps path → `null`;
  - a malformed folder name → `null`.

  `mapForOtherApps(p, { userData, localAppData, pfn })`:
  - a path inside `userData` (case-insensitive, `/` = `\`) → `%LOCALAPPDATA%\Packages\<pfn>\LocalCache\Roaming\Readmate Reader Store\<relative>`;
  - a sibling folder `…\Readmate Reader Store2\x` → unchanged;
  - `pfn` null → unchanged.
- [ ] T025 [P] [US2] Write `ST/check-external-paths.test.mjs` (`node --test`) on fixture source files: a `shell.openPath(x)` / `shell.showItemInFolder(x)` / `shell.openExternal(pathToFileURL(x)...)` whose argument is not wrapped in `pathForOtherApps(` → reported with file:line; a wrapped call and `shell.openExternal('https://…')` / `'ms-settings:…'` → not reported. A `// external-path: user-chosen` comment on the line before exempts a call to a path the user picked

### Implementation for User Story 2

- [ ] T026 [US2] Create `EL/store/store-runtime.ts` exporting:
  - `isStoreBuild()` (= `process.windowsStore === true`);
  - `STORE_USER_DATA_DIR_NAME = 'Readmate Reader Store'`, `DIRECT_USER_DATA_DIR_NAME = 'reading-book-desktop'`;
  - `applyStoreUserData()`, which calls `app.setPath('userData', path.join(app.getPath('appData'), STORE_USER_DATA_DIR_NAME))` in the Store build.

  Also create `EL/files/external-path-core.mjs` (pure, no Electron: `packageFamilyNameFromExecPath`, `mapForOtherApps`, so T024 can import it) and `EL/files/external-path.ts` (`pathForOtherApps(p)`, which calls the pure helpers with `app.getPath('userData')`, `process.env.LOCALAPPDATA` and `process.execPath`, and logs one warning when the PFN cannot be parsed). T024 must pass.
- [ ] T027 [US2] Edit `EL/main.ts` (contracts/packaged-runtime.md "start order"):
  - make `import './store/store-userdata-first'` the **first import**. That is a new 3-line module `EL/store/store-userdata-first.ts` calling `applyStoreUserData()`; ESM evaluates imports in order, so it runs before any module that reads `userData`;
  - wrap the `setAsDefaultProtocolClient` block (lines 68–76) in `if (!isStoreBuild())`;
  - in `whenReady`, skip `app.setAppUserModelId` when `isStoreBuild()`.

  Grep `EL/**/*.ts` for top-level (module-scope) `app.getPath('userData')` reads that run before the setPath, and fix any you find by moving them into functions.
- [ ] T028 [US2] Route every `shell.openPath`, `shell.showItemInFolder` and `shell.openExternal(file:…)` in `EL/**` (excluding `spikes/`, `e2e/`) whose argument can be an app-owned path through `pathForOtherApps`. 8 call sites as of 2026-11-08; list them first with `grep -rn "shell\.\(openPath\|showItemInFolder\|openExternal\)" EL --include=*.ts`. Mark a user-chosen path (e.g. an export target) with the `// external-path: user-chosen` comment instead
- [ ] T029 [US2] Implement `ST/check-external-paths.mjs` (rules of T025) over `EL/**/*.ts` excluding `spikes/`, `e2e/`. Add `npm run check:external-paths` to the `check` script next to `check:store-secrets`. T025 must pass, and the real tree must pass after T028
- [ ] T030 [P] [US2] Write `EL/store/startup-task.ps1` (Windows PowerShell 5.1, no external module):
  - one positional argument `get` | `enable` | `disable`;
  - load `[Windows.ApplicationModel.StartupTask, Windows.ApplicationModel, ContentType=WindowsRuntime]`;
  - await `IAsyncOperation` through `[System.WindowsRuntimeSystemExtensions]::AsTask` by reflection;
  - `StartupTask.GetAsync('ReadmateReaderStartup')`;
  - `enable` = `RequestEnableAsync()`, `disable` = `Disable()`;
  - print exactly one line `{"state":"<Enabled|Disabled|DisabledByUser|DisabledByPolicy|EnabledByPolicy>"}`, or `{"error":"<message>"}` with exit 1;
  - no other output (`$ProgressPreference='SilentlyContinue'`, errors caught).
- [ ] T031 [US2] Create `EL/background/store-startup-task.ts`:
  - spawn `powershell.exe` with argv `['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', path.join(process.resourcesPath,'store','startup-task.ps1'), op]`, `windowsHide: true`, a 10 s timeout (kill on timeout);
  - parse the last stdout line;
  - map `Enabled` → `{ supported: true, enabled: true, state: 'enabled' }`, `Disabled` → `disabled`, `DisabledByUser` → `disabledByUser` (enabled false), `DisabledByPolicy` → `disabledByPolicy`, `EnabledByPolicy` → `enabledByPolicy` (enabled true);
  - timeout / error / unparsable → `{ supported: true, enabled: false, state: 'managedByWindows' }`;
  - `setStartAtLogin(true)` while the state is `disabledByUser` / `disabledByPolicy` returns the current state without calling `enable` (FR-007).
- [ ] T032 [US2] Edit `EL/background/login-item.ts`: in the Store build, `getStartAtLogin` / `setStartAtLogin` delegate to `store-startup-task.ts` (make both IPC handlers `async` if they are not; keep the channel names). `wasLaunchedAtLogin` keeps reading `--hidden-at-startup`. Extend `StartAtLoginDto` in `EL/ipc/api-types.ts` to `{ supported: boolean; enabled: boolean; state?: 'enabled' | 'disabled' | 'disabledByUser' | 'disabledByPolicy' | 'enabledByPolicy' | 'managedByWindows' }` (data-model §7). The direct build never sets `state`
- [ ] T033 [US2] Add the channel `BackgroundChannels.openStartupSettings` (`background:openStartupSettings`):
  - constant in `EL/ipc/channels.ts`;
  - handler in the background IPC file: Store build only, `shell.openExternal('ms-settings:startupapps')`, otherwise `{ ok: false }`;
  - `openStartupSettings(): Promise<{ ok: boolean }>` in `DesktopApi` (`EL/ipc/api-types.ts`) and `EL/preload.ts`;
  - wrapper in the matching `source/app/bridge/` background file;
  - Mobile: add the method to the Mobile `api` (`source/app/platforms/native/bridge/`, wherever the background group is built), answering `NOT_AVAILABLE_ON_PLATFORM`.

  Run `npm run mobile:typecheck:web`.
- [ ] T034 [US2] Update the Start at Login row in Settings → Background (find it with `grep -rn "StartAtLogin" source/app/screens/Settings`):
  - derive `canChange = state === undefined || state === 'enabled' || state === 'disabled'`;
  - when `!canChange`, disable the toggle and show "Turned off in Windows Settings → Startup" (`disabledByUser`), "Set by your organisation" (`disabledByPolicy` / `enabledByPolicy`) or "Managed by Windows" (`managedByWindows`);
  - show the button **Open Startup settings**, calling the bridge from T033.

  Re-read the state when the window regains focus.
- [ ] T035 [P] [US2] Fill `docs/store/smoke-tests.md` (FR-019): one row per feature, with columns `Check | How | 1.0.0`. Rows:
  - import a local EPUB / PDF / TXT / MD;
  - each format opens and remembers its position;
  - a PDF highlight is written into the user's own file;
  - a PDF attachment opens in the default viewer;
  - "Show in folder" for a managed (URL-imported) book;
  - an audiobook plays and seeks;
  - cloud sign-in returns to the app;
  - tray / run in background;
  - a reading-reminder toast shows the name and icon;
  - Start at Login on → sign out/in → starts hidden in the tray; off in Windows Settings → the toggle shows it;
  - Settings → Updates names the Microsoft Store;
  - Start and taskbar icons look sharp in light and dark themes;
  - uninstall leaves the books in Documents and the PDF annotations in place.
- [ ] T036 [US2] Verify that `AdvancedSettings.tsx` `CHANNEL_NOTE['microsoft-store']` and `EL/updates/update-service.ts` need no change (FR-008). If the text promises anything the Store build cannot do, adjust it
- [ ] T037 [US2] Create `EL/spikes/store-packaged.mjs` (`spike:store:packaged`, guided, Windows only). It finds the installed package with `Get-AppxPackage *ReadmateReader*` and runs:
  - **S1**: hash `%APPDATA%\reading-book-desktop` (if present) → ask the user to use the Store app for one minute and quit → hash again: identical. `%APPDATA%\Readmate Reader Store` must not exist outside the package view, and `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\Readmate Reader Store\reading-book.db` must exist;
  - **S2**: run `startup-task.ps1 get` through `Invoke-CommandInDesktopPackage` (state printed); ask the user to link a cloud account and confirm; ask them to trigger a reminder toast and confirm the name and icon; after turning Start at Login on and signing out and in, read `--hidden-at-startup` from the process command line (`Get-CimInstance Win32_Process`);
  - **S4**: ask the user to open a PDF attachment and "Show in folder" on a managed book, and confirm.

  Print pass / fail per scenario.
- [ ] T038 [US2] Run S1, S2 and S4 on a test-signed package (verify-first items of research R4–R7). For each failure, apply the fallback written in research.md (R5: `managedByWindows` + `Enabled="true"`; hidden start → known limitation in `docs/store/checklist.md`), and record the result under the matching R-section of `research.md` as "Verified 2026-mm-dd: …"
- [ ] T039 [US2] Add `desktop-main-changes.json` entries for every `EL/` file changed in this phase (`main.ts`, `background/login-item.ts`, `background/store-startup-task.ts`, the background IPC file, `ipc/api-types.ts`, `ipc/channels.ts`, `preload.ts`, `files/external-path*.{ts,mjs}`, `store/*`, each file of T028). Run `npm run check:desktop-baseline`
- [ ] T040 [US2] Run the full `docs/store/smoke-tests.md` on a clean machine or VM and fill in column `1.0.0`. Every row passes, or is fixed before moving on (SC-003)

**Checkpoint**: the installed package behaves like the direct build.

---

## Phase 6: User Story 3 - Store-standard icons are generated from one source image (Priority: P2)

**Goal**: one master PNG → every Store logo + `icon.ico`, at exact sizes, with no upscaling.

**Independent Test**: `npm run store:icons && node ST/check-store-icons.mjs` passes. A 512 px or non-square master
stops with `icon_master_invalid`.

### Tests for User Story 3

- [X] T041 [P] [US3] Write `ST/icons.test.mjs` (`node --test`):
  - `expectedAssets()` returns exactly the rows of contracts/store-icons.md (count them: 6 logos × 5 scales + 5 targetsizes × 3 variants = 45 PNGs, plus `icon.ico`);
  - `validateMaster({ width, height, hasAlpha })` rejects 512×512, 1024×1000 and an image without alpha (rule "square, ≥ 1024 px, has alpha");
  - `writeIco([{ size, png }])` produces a valid header (reserved 0, type 1, count 7) and the directory entries (size 256 written as 0);
  - `contentBox(canvasW, canvasH, share, masterSize)` never returns a side above `masterSize`.

### Implementation for User Story 3

- [X] T042 [US3] Implement `ST/generate-icons.mjs`:
  - `MASTER_ICON = 'source/app/platforms/native/assets/images/icon.png'`, optional `MASTER_ICON_LIGHT`;
  - `expectedAssets()` follows the table in contracts/store-icons.md: file names `<Logo>.scale-<n>.png` and `Square44x44Logo.targetsize-<n>[_altform-unplated|_altform-lightunplated].png`; `content` 100 % for StoreLogo / targetsize, 66 % otherwise; wide logos are centred, sized by height;
  - render each asset with `sharp`: resize the master to the content box (`kernel: lanczos3`), `extend` it onto a transparent canvas of the exact size, write a PNG;
  - empty and rewrite `EL/build-resources/appx/`, copy `EL/store/appxmanifest.xml` into `EL/build-resources/` (T008), and write `EL/build-resources/icon.ico` via `ico-writer.mjs` (16, 24, 32, 48, 64, 128, 256);
  - an invalid master → print `icon_master_invalid` (contracts/store-build.md) and exit 1.
- [X] T043 [P] [US3] Implement `ST/ico-writer.mjs` `writeIco(entries)`: an ICONDIR plus one ICONDIRENTRY per image (width/height byte, 0 for 256), PNG payloads, offsets correct. T041 must pass
- [X] T044 [US3] Implement `ST/check-store-icons.mjs`: for every `expectedAssets()` row, check that the file exists, `sharp(file).metadata()` has the exact width/height, and `stats()` shows a max alpha > 0; `icon.ico` has 7 entries. List every failure, exit 1
- [X] T045 [US3] Wire it in:
  - `store:icons` = `node ST/generate-icons.mjs && node ST/check-store-icons.mjs`;
  - `package-store.mjs` step 3 runs it (replace the T015 placeholder);
  - prefix `npm run package` with `npm run store:icons &&`;
  - in `electron-builder.json5` set `directories.buildResources` to `source/app/platforms/electron/build-resources` and `win.icon` to `source/app/platforms/electron/build-resources/icon.ico`.

  `npm run package` must still pass `check:desktop-package`.

  _Done 2026-11-08: the 45 logos + `icon.ico` are generated and checked (`check-store-icons: OK`), and both configs
  resolve with the new `buildResources` / `win.icon`. `electron-builder.store.cjs` no longer repeats
  `buildResources` (it is inherited). **Not run:** `npm run package` (a real packaging build). It is checked with
  T018 / T073 on Windows. **Note:** the master (`MASTER_ICON`, the Mobile `icon.png`) is Expo's template app icon,
  not Readmate art. Replace it before any submission (T046)._
- [ ] T046 [US3] Set the window icon in development too: if `BrowserWindow` creation in `EL/main.ts` has no `icon`, leave it (packaged builds take the exe icon). Do not add a runtime dependency on `build-resources/`. Then rebuild the test-signed package and fill the smoke-test row "Start and taskbar icons look sharp in light and dark themes" (FR-012). If the art is unreadable on one theme, add `MASTER_ICON_LIGHT` art and regenerate

**Checkpoint**: the package and the NSIS installer carry the Readmate icon.

---

## Phase 7: User Story 6 - Moving from the installer version keeps the user's library (Priority: P2)

**Goal**: the first launch of the Store build offers a copy-only, all-or-nothing import of the direct build's data
(contracts/store-import.md).

**Independent Test**: quickstart §6. The library, annotations, positions and settings appear in the Store build, and
the direct build's folder hashes are identical before and after, including when the import is interrupted or the
direct build is running.

### Tests for User Story 6

- [ ] T047 [P] [US6] Write `CORE/tests/store-import/plan.test.ts` for `planImport(source, { freeBytes })`:
  - only allowlisted entries are copied: `reading-book.db`, `books/`, `covers/`, `txt-edits/`, `background-prefs.json`, `notification-prefs.json`, `reading-reminder-state.json`, `Local Storage/`;
  - `cloud-tokens`, `models/`, `transcription-models/`, `attachment-tmp/`, `attachment-staging/`, `zip-import-tmp/`, `Cache/`, `GPUCache/`, `Session Storage/` and unknown entries go to `skip`;
  - `hasWal: true` → refuse `source_busy`;
  - `freeBytes < totalBytes * 1.1` → refuse `no_space`;
  - no `reading-book.db` → no plan (`null`).
- [ ] T048 [P] [US6] Write `CORE/tests/store-import/rewrite-root.test.ts` for `rewriteRoot(value, fromRoot, toRoot)`:
  - `C:\Users\a\AppData\Roaming\reading-book-desktop\books\x\file` → the same path under `…\Readmate Reader Store\books\x\file`;
  - case-insensitive (`c:\users\A\…`), and `/` treated as equal to `\`;
  - only whole segments count: `…\reading-book-desktop2\x` → `null`;
  - the root itself → `toRoot`;
  - `D:\Books\a.pdf` → `null`;
  - empty or `null` input → `null`.
- [ ] T049 [P] [US6] Write `CORE/tests/store-import/schema.test.ts`:
  - `isNewerSchema(sourceNames, knownNames)`: true when any source name is not in `knownNames`, false when the source is a subset;
  - `verifyCounts(source, staged)`: equal → ok; any table differs → `{ refuse: 'integrity', table }`.
- [ ] T050 [P] [US6] Write `CORE/tests/store-import/marker.test.ts` for `decideOnLaunch({ storeDbExists, marker, sourceDbExists, storeLibraryEmpty })` (data-model §5), covering every arrow of the state machine:
  - no db + no marker + source → `offer`;
  - no db + `declined` → `none`;
  - no db + `pending` → `importWithoutAsking`;
  - db exists → `none` whatever the marker;
  - no source → `none`;
  - plus `parseMarker` rejecting unknown `state` values or `version ≠ 1` (treated as absent).

### Implementation for User Story 6

- [ ] T051 [US6] Implement in `CORE/src/store-import/`:
  - `allowlist.ts` (the T047 lists as constants, with the comment "confirmed by grep of json-prefs-file.ts users on <date>");
  - `plan.ts` (`planImport`);
  - `rewrite-root.ts`;
  - `schema.ts` (`isNewerSchema`, `verifyCounts`, `COUNTED_TABLES = ['books','notes','collections','book_audio_chapters','txt_documents','audio_transcripts']`);
  - `marker.ts` (`StoreImportMarker` type from data-model §5, exactly `{ version: 1, state: 'pending' | 'declined' | 'done', at, source?, copied? }`, plus `parseMarker`, `decideOnLaunch`).

  Re-export from `index.ts`. T047–T050 pass; `npm run sdk:typecheck` and `npm run check:boundaries` pass.
- [ ] T052 [US6] Confirm the allowlist against the code: list every file name passed to `json-prefs-file.ts` (`grep -rn "json-prefs-file\|prefsFile" EL --include=*.ts`) and check the table names in `COUNTED_TABLES` against `CORE/src/db/desktop/migrations/*.sql`. Update `allowlist.ts` and contracts/store-import.md if they differ
- [ ] T053 [US6] Create `EL/spikes/store-import.mjs` (`spike:store:import`). Like `spike:audio:migration`, it relaunches itself with the app's Electron binary in `ELECTRON_RUN_AS_NODE` mode for better-sqlite3. On temp folders, with a real migrated schema plus sample rows (managed book, referenced book, cover, TXT revision, notes, a `Local Storage/` dir, `cloud-tokens`), it runs the host functions of T054–T057 directly. Scenarios:
  1. success: rows, counts and files are equal, managed paths are rewritten, referenced paths are unchanged, no TEXT value under the old root;
  2. a `-wal` exists in the source → `source_busy`, nothing created;
  3. a source with an extra migration name → `newer_schema`;
  4. a corrupted db → `integrity`;
  5. a planted value under the old root in an unexpected column → refused;
  6. a crash simulated after copying and before the db rename → the next `recover` leaves the target empty and `decideOnLaunch` offers again;
  7. cancel mid-copy → same as 6;
  8. in every scenario, the SHA-256 of every source file is identical before and after, and the source folder listing is unchanged.
- [ ] T054 [US6] Implement `EL/store-import/source.ts`:
  - `directRoot()` = `path.join(app.getPath('appData'), DIRECT_USER_DATA_DIR_NAME)`;
  - `readSource(root)`: `readdir` + `stat` only, sizes summed recursively, `hasWal` = `reading-book.db-wal` exists;
  - `readSourceMigrationNames(stagedDbPath)`: read from the STAGED copy, never the source.
- [ ] T055 [US6] Implement `EL/store-import/copy.ts` `copyEntries(plan, sourceRoot, stagingRoot, { onProgress, signal })`:
  - read streams → write streams, recursive, `lstat` (symlinks skipped and counted);
  - creating `store-import.partial/` fresh;
  - `fs.statfs` free-space check before starting;
  - progress per file `{ doneFiles, totalFiles, doneBytes, totalBytes }`;
  - abort on `signal`;
  - returns the file count and bytes per top-level entry.
- [ ] T056 [US6] Implement `EL/store-import/stage-db.ts` `prepareStagedDb(stagedDbPath, { fromRoot, toRoot, knownMigrationNames })`:
  - open with better-sqlite3 read-write, `PRAGMA integrity_check` must return exactly `ok`;
  - `isNewerSchema` → refuse `newer_schema`;
  - run the existing `migrate(db)` from `EL/persistence/migrate.ts` on this connection;
  - in one transaction, `UPDATE books SET file_path/normalized_path/cover_path` through `rewriteRoot` (only non-null results);
  - then, for every table from `sqlite_master` and every TEXT column from `pragma_table_info`, scan for values inside `fromRoot` with the `rewriteRoot` rule → refuse `integrity` with table.column;
  - return the counts of `COUNTED_TABLES`; close.

  Source counts come from a second read-only better-sqlite3 open of a SEPARATE byte copy taken before migration (`stagedDbPath + '.orig'`, deleted after), never from the source.
- [ ] T057 [US6] Implement `EL/store-import/commit.ts`:
  - `commitImport(stagingRoot, targetRoot, result)`: rename every staged entry into `targetRoot` with `reading-book.db` LAST, write `store-import.json` `{ version: 1, state: 'done', at, source: { schemaMigrations, lastMigration }, copied: { books, notes, files, bytes } }`, remove `store-import.partial/`;
  - `recover(targetRoot)`: if `reading-book.db` is absent, delete `store-import.partial/` and every allowlisted entry in `targetRoot`;
  - `writeMarker(state)`.
- [ ] T058 [US6] Implement `EL/store-import/dialogs.ts` with the exact texts and buttons of contracts/store-import.md "Dialogs" (`dialog.showMessageBox`, no parent window, `noLink: true`, `cancelId` = the Later / OK button). Implement `EL/store-import/progress-window.ts`: a frameless 420×160 `BrowserWindow` with no preload, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a `data:` URL page whose text Main updates with `webContents.executeJavaScript` of a JSON-encoded string, and a **Cancel** button that sends `document.title = 'cancel'` (Main listens to `page-title-updated`); closing the window = Cancel
- [ ] T059 [US6] Implement `EL/store-import/run.ts` `runStoreImportIfNeeded()`:
  1. `recover`;
  2. `decideOnLaunch`;
  3. on `offer`, show the first dialog;
  4. on Import (or `importWithoutAsking`): plan → busy / space / newer dialogs with Try again loops → progress window → copy → `prepareStagedDb` → `verifyCounts` against the source counts and file totals → `commitImport` → done dialog;
  5. any error or cancel → `recover` + failure dialog (cancel: no dialog);
  6. Start empty → `writeMarker('declined')`.

  Never throws to the caller. Call it in `EL/main.ts` `whenReady`, Store build only, **before** `ensureBooksSandbox()` / `openDatabase()` and before the first window.
- [ ] T060 [US6] Add the IPC group `StoreImportChannels` (`storeImport:getStatus`, `storeImport:schedule`) across the four places (contracts/store-import.md "IPC"):
  - `EL/ipc/channels.ts`;
  - `EL/ipc/store-import.ipc.ts`: `getStatus` = Store build && `SELECT COUNT(*) FROM books` = 0 && direct db exists, plus `lastResult` from the marker; `schedule` = same condition else `{ ok: false, reason: 'not_available' }`, write marker `pending`, `app.relaunch()`, then quit through the existing `quitApp()` / `isQuitting` path;
  - register it in `EL/ipc/index.ts`;
  - `StoreImportStatusDto` `{ available: boolean; lastResult?: 'done' | 'declined' }` in `EL/ipc/api-types.ts`, plus the `storeImport` group in `DesktopApi`;
  - `EL/preload.ts`;
  - `source/app/bridge/storeImport.ts` + re-export in `source/app/bridge/index.ts`;
  - the Mobile `storeImport` group answering `NOT_AVAILABLE_ON_PLATFORM` in `source/app/platforms/native/bridge/unavailable.ts` (and its `create-api.ts` wiring).

  `npm run mobile:typecheck:web` and `npm run mobile:test` must pass.
- [ ] T061 [US6] Add the row "Bring over library from installer version" to Settings → Advanced (`source/app/screens/Settings/components/advanced/AdvancedSettings.tsx`): load the status on mount (zustand per the user's preference if the row needs state beyond one effect), show it only when `available`, explain "Copies books, annotations, reading positions and settings. Readmate Reader restarts.", button **Bring over and restart** → `schedule`
- [ ] T062 [US6] Check how linked cloud accounts look when `cloud-tokens` is missing but the provider rows exist in SQLite. If the UI does not already say "Sign in again", make it say so in the cloud accounts list (renderer only; no token handling change)
- [ ] T063 [US6] Run `npm run spike:store:import`; all 8 scenarios pass
- [ ] T064 [US6] Run quickstart §6 on Windows with the test-signed package (S3, S5 of `spike:store:packaged`: extend T037's spike with S3 = hashes of the direct folder before/after import incl. with the direct build open, and S5 = ask the user to confirm Appearance / Library sort settings came across). Record the results in `research.md` R8 "Verified …" and in `docs/implementation_plan/msix_store_packaging.md`
- [ ] T065 [US6] Add `desktop-main-changes.json` entries for every `EL/` file of this phase (`store-import/*`, `ipc/store-import.ipc.ts`, `ipc/index.ts`, `ipc/channels.ts`, `ipc/api-types.ts`, `preload.ts`, `main.ts`, `spikes/store-import.mjs`); `npm run check:desktop-baseline`

**Checkpoint**: an installer-version user can move to the Store build without losing anything, and the installer
version's data is unchanged.

---

## Phase 8: User Story 5 - A submission checklist the maintainer can follow end to end (Priority: P3)

**Goal**: `docs/store/checklist.md` takes a maintainer from "nothing reserved" to "Submit for certification".

**Independent Test**: someone who did not build the feature follows only the checklist on a clean clone and reaches the
Partner Center submit step (SC-006).

- [ ] T066 [P] [US5] Implement `ST/run-wack.mjs` (`store:wack`):
  - `requireWindows`;
  - find `appcert.exe` under `%ProgramFiles(x86)%\Windows Kits\10\App Certification Kit\`, or print where to get it;
  - check elevation (`net session` exit code) or print "run from an elevated prompt";
  - run `appcert.exe reset`, then `appcert.exe test -appxpackagepath <newest .msix> -reportoutputpath docs/store/wack/<version>.xml`;
  - parse `OVERALL_RESULT` and the failed test names;
  - append the WACK column to the `docs/store/submissions.md` row of this version (create the row with version, date and SHA-256 if missing);
  - exit 1 on FAIL.
- [ ] T067 [P] [US5] Write `docs/store/privacy-facts.md` (FR-018): data stays on the device (books, annotations, reading state, transcripts in local SQLite / files); network use is only:
  - user-started cloud sign-in and download (Google Drive / Dropbox / OneDrive);
  - URL import;
  - the optional, explicitly started model downloads (translation, speech).

  No telemetry, no ads, no account. Confirm each point with a grep of `EL/` for `fetch(` / `net.request` / `https.get` and list the call sites at the end. Include the text of a privacy policy page the maintainer can host.
- [ ] T068 [P] [US5] Write `docs/store/listing/en-US.md` and `docs/store/listing/vi-VN.md`: product name, short description (≤ 100 chars), description (≤ 10 000 chars), "What's new in this version", features list (≤ 20 × 200 chars), keywords (≤ 7), category `Books & reference`, the screenshot plan (≥ 1, recommended 4, 1366×768 or larger, which screens), and the support contact and privacy URL placeholders
- [ ] T069 [US5] Write `docs/store/checklist.md` in order, each item with "where the answer comes from" and "how to check":
  1. Partner Center developer account;
  2. reserve the name "Readmate Reader";
  3. Product identity → copy the 3 values into `EL/store/store-identity.json`;
  4. raise `extraMetadata.version`;
  5. `npm run package:store` (+ `--test-sign` for testing, `docs/store/signing.md`);
  6. install and run `docs/store/smoke-tests.md`;
  7. `npm run store:wack`;
  8. pricing and availability (free, all markets);
  9. properties (category, privacy URL, support contact, system requirements: Windows 10 1809+ x64);
  10. age ratings questionnaire (answers from `privacy-facts.md`: no user-generated content sharing, no purchases);
  11. the `runFullTrust` restricted-capability justification text (desktop app needing full file system access to read the user's own book files in place and write annotations into their PDFs; bundled FFmpeg / speech helper processes);
  12. Store listings per language from `listing/`;
  13. upload the UNSIGNED `.msix` from step 5;
  14. submit; record the result in `submissions.md`;
  15. on rejection, record each reason and its fix.

  Add an "Update submission" section (version bump → build → smoke → WACK → "What's new" → upload → record) and a "Known limitations" section (fed by T038).
- [ ] T070 [US5] Dry run: follow `docs/store/checklist.md` steps 3–7 on a clean clone with the test identity, fix every unclear step, and confirm that each Partner Center field of a first submission has a prepared answer or a named source (SC-006, US5 AS 1)

**Checkpoint**: everything needed for the first submission is in `docs/store/`.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T071 [P] Complete `docs/implementation_plan/msix_store_packaging.md`: commands, files, the separate userData and why (R4), the import flow, the startup task, external paths, verification results, known limitations
- [ ] T072 [P] Add a **Microsoft Store package** paragraph to `CLAUDE.md` (under Commands: `package:store`, `--test-sign`, `store:icons`, `store:wack`, the new checks and spikes; under Architecture: the Store build's `Readmate Reader Store` userData and its reason, `pathForOtherApps`, the startup task, the one-time import, `docs/store/`)
- [ ] T073 Run `npm run check`, `npm run check:desktop-baseline`, `npm run package` (the NSIS installer differs only by its icon, SC-008) and `npm run package:store` with placeholders (fails as designed). Fix anything red, except failures that predate this feature (list them)
- [ ] T074 SC-005: run `npm run check:store-secrets` and `git log -p --all -- '*.pfx' '*.p12'` (empty), and grep the T018 / T023 build logs for the password → no hit. Record this in `docs/implementation_plan/msix_store_packaging.md`
- [ ] T075 After the first real submission (maintainer): record the result in `docs/store/submissions.md`; on rejection, add the reasons and fixes to `checklist.md` (SC-007)

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** (blocks everything). In Phase 1, T002–T005 run in parallel after T001. In Phase 2: T006 → T007 → T008, then T009 → T010.
- **US1 (Phase 3)** after Phase 2: T011 and T012 in parallel, then T013 / T014, T015 → T016 → T017 → T018.
- **US4 (Phase 4)** needs T015 (wrapper). **US2 (Phase 5)** needs US4 to install the package; its code tasks T024–T036 can be written while US4 is in progress, but T037–T040 need a signed package.
- **US3 (Phase 6)** needs only Phase 2 + T015, and can run in parallel with US2. T046 needs US4.
- **US6 (Phase 7)**: the core tasks T047–T051 need only Phase 1. The host tasks T054–T060 need T026–T027 (Store userData) from US2. T064 needs US4 and T037.
- **US5 (Phase 8)**: T066–T068 can start any time after Phase 1. T069 after T038 (known limitations). T070 after US1 + US4.
- **Polish** after all stories. T075 is done by the maintainer after submission.

```text
Setup → Foundational → US1 ─→ US4 ─→ US2 ─┬→ US5 → Polish
                         │            │    │
                         ├→ US3 ──────┘    │
                         └→ (core T047–T051) → US6 (host, needs T026–T027) ┘
```

## Parallel Examples

- Phase 1: T002, T003, T004, T005 together.
- US1: T011 with T012; then T013 with T014.
- US2: T024, T025, T030, T035 together; T026 → T027 → T028 → T029 in order; T031 → T032 → T033 → T034 in order.
- US3: T041 with T043; then T042 → T044 → T045.
- US6: T047, T048, T049, T050 together; after T051, T054 / T055 / T056 / T057 / T058 in parallel (different files), then T059 → T060 → T061.
- US5: T066, T067, T068 together.

## Implementation Strategy

1. **MVP = Phase 1 + 2 + US1 + US4 + US2**: a test-signed package installs and behaves like the direct build, and the
   unsigned one is ready for upload. Validate with quickstart §1, §3 and §4 before going on.
2. Add **US3** (real icons) before any submission: sample logos would fail review.
3. Add **US6** before announcing the Store version to existing installer users. A first submission for new users only
   could go without it, but the spec requires it, so it is part of the release.
4. Finish with **US5** (checklist, WACK, listing, privacy) and Polish, then submit (T075).
5. Never treat a research item marked *(verify)* as true until T038 / T064 have recorded it.
