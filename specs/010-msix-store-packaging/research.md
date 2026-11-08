# Research: Microsoft Store Package for the Desktop App

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-08

Facts read from the repository on 2026-11-08 are marked *(repo)*. Platform behaviour that this plan relies on but
that was not executed yet is marked *(verify: S-n)* and is proven by the spike `spike:store:packaged` (scenario S-n,
see [quickstart.md](quickstart.md)) **before** the dependent tasks are implemented. Every such item names its
fallback, so no decision is left open.

## Starting point *(repo)*

- `electron-builder` **26.18.0**, Electron **39.8.10**. `electron-builder.json5`: `appId: "YourAppID"`,
  `productName: "Readmate Reader"`, `extraMetadata { name: "reading-book-desktop", version: "0.0.0" }`, Windows target
  `nsis` x64 only, `protocols: readmate-reader`, `afterPack` re-checks the bundled FFmpeg, no `win.icon` (Electron's
  default icon is shipped), no `directories.buildResources`.
- `main.ts:50` `APP_USER_MODEL_ID = 'YourAppID'`, set on `whenReady` when packaged; `main.ts:68-76` registers the
  OAuth scheme with `setAsDefaultProtocolClient`; `main.ts:79` `requestSingleInstanceLock()`.
- `background/login-item.ts` uses `app.setLoginItemSettings` with `--hidden-at-startup`.
- `updates/update-service.ts` already detects `process.windowsStore` → channel `microsoft-store`, and
  `AdvancedSettings.tsx` already shows "This copy was installed from the Microsoft Store, which delivers updates…".
- Everything the app owns is under `app.getPath('userData')` = `%APPDATA%\reading-book-desktop`:
  `reading-book.db` (WAL mode, `persistence/db.ts`), `books/` (managed copies, absolute `books.file_path`),
  `covers/` (absolute `books.cover_path`), `txt-edits/`, Main JSON prefs (`prefs/json-prefs-file.ts`),
  `cloud-tokens` (token vault), `models/`, `transcription-models/`, `attachment-tmp/`, `attachment-staging/`,
  `zip-import-tmp/`, plus Chromium's own folders (renderer preferences live in `Local Storage/`).
- Schema history is the `schema_migrations(name, applied_at)` table, migrations `001`–`030` in
  `source/core/src/db/desktop/migrations/`.
- The constitution file `.specify/memory/constitution.md` is still the unfilled template.

---

## R1 — Packaging tool

**Decision**: Use electron-builder's built-in **`appx` target** (26.18 runs `makeappx.exe` + `makepri.exe` from its
own Windows kit bundle), with the artifact name ending in `.msix`
(`"artifactName": "${productName}-Windows-${version}-Store.msix"`): `makeappx pack` writes the same package format
whatever the extension, and Partner Center accepts `.msix` uploads. The Store build has its **own config file**
`electron-builder.store.cjs` that `extends` the base `electron-builder.json5` and only overrides `win.target`,
`artifactName`, `directories.buildResources` and adds the `appx` block. A wrapper script
`source/scripts/store/package-store.mjs` validates the inputs (R2, R3, R10), generates the icons (R9), then runs
`electron-builder --win --config electron-builder.store.cjs` and the existing post-checks.

**Rationale**: No new dependency; it reuses the same `files` allowlist, `extraResources` (FFmpeg) and `afterPack`
hook, so FR-005 ("same content rules") comes for free. `appx` already emits `windows.protocol` from `protocols`,
`runFullTrust`, scaled assets + `resources.pri`, and supports `customExtensionsPath` (R5) and `customManifestPath`.

**Alternatives considered**: MSIX Packaging Tool (GUI, repackages an installer — not repeatable from a command);
hand-written `AppxManifest.xml` + direct `makeappx` over `win-unpacked/` (duplicates what electron-builder does and
needs a separately installed Windows SDK); `electron-windows-store` (deprecated, needs Desktop App Converter).

## R2 — Store identity: one place, placeholders block the build

**Decision**: `source/app/platforms/electron/store/store-identity.json` (plain JSON, read by both the Store config
`electron-builder.store.cjs` — which `extends` the base config and builds its `appx` block from it — and by the checks;
`json5` is not a direct dependency, so the scripts never parse the base `.json5`) is the single place for `identityName`,
`publisher` (`CN=…` exactly as shown on Partner Center → Product identity), `publisherDisplayName`,
`applicationId` (`ReadmateReader`), `displayName`, `languages` (`["en-US", "vi-VN"]`), `backgroundColor`
(`transparent`), `minVersion` `10.0.17763.0` (1809), `maxVersionTested` `10.0.26100.0`, `capabilities`
(`["runFullTrust"]` only) and `addAutoLaunchExtension: false`. The checked-in values are placeholders of the form
`__FROM_PARTNER_CENTER__`. `source/scripts/store/check-store-config.mjs` refuses any placeholder or `YourAppID`,
checks the shapes (`identityName` 3–50 chars `[A-Za-z0-9.-]`, `publisher` starts with `CN=`, no reserved names) and
prints every failure at once.

**Rationale**: The identity values are public (they appear in every installed manifest), so they belong in the
repository, not in a secret. One file = FR-002.

**Alternatives considered**: environment variables (invisible, easy to forget on a new machine); a separate
`store-identity.json` merged by the wrapper (two places to read for one manifest).

**Note**: the base config's `appId` / `APP_USER_MODEL_ID` `YourAppID` belong to the direct build and are left
untouched by this feature (changing the direct build's AUMID changes its notification identity; out of scope). The
Store build never calls `setAppUserModelId` (R6).

## R3 — Version

**Decision**: The single release version stays `extraMetadata.version` in `electron-builder.json5` (the Desktop
identity, separate from the root `package.json` shared with Mobile). It is raised from `0.0.0` to a real
`MAJOR.MINOR.PATCH` (first submission `1.0.0`). electron-builder turns it into the Store form `1.0.0.0` (fourth part
0, `setBuildNumber: false`). `check-store-config.mjs` refuses: not three numeric parts, `MAJOR = 0`, any part
> 65535, or a version not greater than the last one in `docs/store/submissions.md` (the submission log).

**Rationale**: `userData` comes from `extraMetadata.name`, not the version, so raising it keeps the direct build's data
(FR-003). `app.getVersion()` (update screen, About) becomes truthful.

**Alternatives considered**: a separate Store version (two numbers drift); deriving from git tags (no tags in this
repo's flow).

**Follow-up**: `check:desktop-baseline` / `check:desktop-package` may assert `0.0.0`; the tasks phase updates the
recorded expectation with an approval note.

## R4 — The Store build's own data folder (critical)

**Finding**: For a packaged full-trust app on Windows 10 1903+ / 11, writes to *new* files and folders under the
user's `AppData` are redirected to the package's private location
(`%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\…`) and merged into the app's view, but **files that already exist
in the real `AppData` are modified in place**. If the Store build kept the userData folder name
`reading-book-desktop`, it would open the direct build's real `reading-book.db` and write to it, while new files
(`-wal`, `-shm`, new covers) would land in the private copy — a split database and a violation of FR-014 ("never
change the direct build's data").

**Decision**: When `process.windowsStore` is true, Main calls
`app.setPath('userData', path.join(app.getPath('appData'), 'Readmate Reader Store'))` as its **first** statement,
before `requestSingleInstanceLock()` and before anything reads `userData`. The folder never exists in the real
`AppData`, so everything the Store build writes is private to the package and removed on uninstall (FR-010 is
unaffected: book files are never under it). *(verify: S1 — after a full session the direct build's folder hashes are
unchanged and no `Readmate Reader Store` folder exists outside the package view)*

**Alternatives considered**: keep the name and rely on virtualization (unsafe, above); disable write virtualization
with the restricted `unvirtualizedResources` capability (shares the real folders with the direct build, data
survives uninstall, extra restricted capability to justify).

## R5 — Start at Login

**Decision**: Declare our own startup task in `source/app/platforms/electron/store/appx-extensions.xml`
(`customExtensionsPath`; electron-builder's built-in one is hard-coded `TaskId="SlackStartup"`):
`desktop:StartupTask TaskId="ReadmateReaderStartup" Enabled="false"`, and pass the hidden flag with
`uap10:Parameters="--hidden-at-startup"` on that extension (ignorable namespace: older Windows ignore it and the app
starts visible). In the Store build `login-item.ts` delegates to a new `background/store-startup-task.ts` that reads
and changes the task state through the WinRT `Windows.ApplicationModel.StartupTask` API, called from a short-lived
**Windows PowerShell 5.1 child process** spawned with an argv array and a fixed, checked-in script (no user input, no
shell string). Child processes of a packaged app run with its package identity, so `StartupTask.GetAsync` resolves
the app's own task. States map to `StartAtLoginDto.state`: `Enabled`, `Disabled`, `DisabledByUser`,
`DisabledByPolicy`, `EnabledByPolicy`. When the state is `DisabledByUser` / `DisabledByPolicy` the toggle is shown
off, cannot be switched on, and offers "Open Windows Startup settings" (`ms-settings:startupapps`).
*(verify: S2 — PowerShell child resolves the task; `uap10:Parameters` arrives in `process.argv`)*

**Fallbacks**: if the PowerShell child does not get package identity → the toggle becomes "Managed by Windows" with
the Settings button and the task is declared `Enabled="true"` (Windows enables it after first launch; the user turns
it off in Settings). If `uap10:Parameters` is not delivered → the app starts visible at login on the Store build,
recorded as a known limitation in the checklist.

**Alternatives considered**: `electron-winstore-auto-launch` / NodeRT (unmaintained native modules, must be rebuilt
for Electron 39); a C++ N-API addon (adds a native toolchain to the build); `setLoginItemSettings` (does not work for
packaged apps).

## R6 — Protocol, notifications, single instance, updates

**Decisions**:
- **`readmate-reader:` link**: declared by electron-builder from `protocols` as `windows.protocol`. In the Store build
  `main.ts` skips `setAsDefaultProtocolClient` (the registration belongs to the package; a registry write would be
  virtualized anyway). Windows starts the packaged exe with the URI as an argument, so the existing
  `second-instance` / argv handling is unchanged. *(verify: S2)*
- **Notifications**: the package gives the process its AUMID (`<PFN>!ReadmateReader`); the Store build does **not**
  call `setAppUserModelId` (a different id would break toasts). *(verify: S2 — reminder toast shows name + icon)*
- **Single instance**: the lock follows `userData`, which R4 changes before the lock is taken, so the direct build and
  the Store build can run side by side without stealing each other's links.
- **Updates**: nothing to build — `detectUpdateChannel()` and the Settings text already cover FR-008. The Store build
  has no other update route (no updater is configured anywhere).

## R7 — Paths handed to other apps

**Finding**: a file the Store build creates under its (virtualized) `userData` exists for other processes only at its
real location under `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\Readmate Reader Store\…`. `shell.openPath` on
the virtual path (PDF attachment temp copies in `attachment-tmp/`) or `shell.showItemInFolder` on a managed book
would hand Explorer / the default app a path it cannot see.

**Decision**: one Main helper `files/external-path.ts` → `pathForOtherApps(p)`: in the Store build, a path inside
`userData` is mapped to its real package path (PFN parsed from the install folder name of `process.execPath`,
`…\WindowsApps\<Name>_<Version>_<Arch>__<PublisherId>\…` → `<Name>_<PublisherId>`); otherwise returned unchanged.
Every `shell.openPath` / `showItemInFolder` / `openExternal(file:)` call on an app-owned path goes through it (the
tasks phase lists them with a grep, and a check fails on a new unmapped call). *(verify: S4 — an attachment opens in
the default PDF viewer; "Show in folder" on a managed book selects the file)*

**Alternatives considered**: write temp copies to `os.tmpdir()` (also under `AppData`, same problem); disable
virtualization (R4, rejected).

## R8 — One-time import from the direct build

**Decision** (FR-014, User Story 6): Main-owned, runs **before the first window and before `openDatabase()`**, in
`source/app/platforms/electron/store-import/`. Pure rules (allowlist, path rewrite, newer-schema test, commit-state
machine) live in core `source/core/src/store-import/` with vitest tests.

1. **When**: Store build, its `userData` has no `reading-book.db` and no `store-import.json` marker, and the direct
   build's `%APPDATA%\reading-book-desktop\reading-book.db` exists (readable through the merged view). Or the marker
   says `pending` (chosen from Settings, R8.6).
2. **Ask**: a native `dialog.showMessageBox` (no renderer yet): "Bring over your library from Readmate Reader
   (installer version)?" — **Import** / **Start empty**. Start empty writes the marker `declined`.
3. **Snapshot, never touching the source with SQLite**: if the source folder has a `reading-book.db-wal`, the direct
   build is running (or crashed) → "Close Readmate Reader (installer version) and try again" — **Try again** /
   **Start empty** / **Later** (Later = no marker, asked again next launch). Otherwise the database file is
   **byte-copied** (no writer exists, so the copy is consistent) and all other allowlisted entries are copied, into
   `{userData}/store-import.partial/`. Free space is checked first (`fs.statfs`, total + 10 %).
4. **Prepare the copy**: open the staged database read-write, `PRAGMA integrity_check`; refuse when
   `schema_migrations` lists a name this build does not know (FR-014a, "installer version is newer"); run the normal
   migrations (source may be older); rewrite every value that starts with the direct build's `userData` root to the
   Store root (`books.file_path`, `normalized_path`, `cover_path`, and a generic scan of every TEXT column of every
   table as a safety net — any remaining old-root value aborts the import); compare row counts of the copied tables
   and the copied file count / bytes with the source.
5. **Commit**: rename each staged top-level entry into `userData`, **`reading-book.db` last** — its presence is the
   commit point. On a start with no database but leftovers (`store-import.partial/` or allowlisted entries), they are
   deleted and the offer is made again (spec AS 6.3). Then the marker `done` (+ counts) is written.
6. **Settings entry**: Settings → Advanced shows "Bring over library from installer version" only when
   `storeImport:getStatus` says the Store library is empty and a source exists; it calls `storeImport:schedule`
   (marker `pending`) and relaunches; step 2 is skipped for `pending`.
7. **Progress**: a small Main-owned window with a static page (no preload API) shows "Copying n of m files"
   + **Cancel** (= discard staging, Start empty for this launch, asked again next launch).

**Allowlist** (copied): `reading-book.db`, `books/`, `covers/`, `txt-edits/`, Main JSON prefs
(`background-prefs.json`, `notification-prefs.json` and every other file written by `json-prefs-file.ts`, listed in
the contract), `Local Storage/` (renderer preferences; same Electron version, same `file://` origin). **Not copied**:
`cloud-tokens` (per-app protected; accounts show "sign in again" — FR-014), `models/`, `transcription-models/`
(re-downloadable, possibly GBs), `attachment-tmp/`, `attachment-staging/`, `zip-import-tmp/`, every Chromium cache.
*(verify: S3 — source folder byte-identical before / after, including when the direct build is running; S5 —
renderer preferences appear after import)*

**Alternatives considered**: SQLite online backup from a read-only connection on the source (a read-only open of a WAL
database can still need to create `-shm` in the source folder — the byte copy avoids touching it at all); doing the
import from the renderer (the database and `Local Storage` are already open by then); moving instead of copying
(forbidden by FR-014).

## R9 — Icons

**Decision**: `source/scripts/store/generate-icons.mjs` uses `sharp` (already installed, 0.35.5, through `@huggingface/transformers`; declared as a `devDependency` at
that exact version so the build script does not rely on a transitive package — no new download) to
generate, from one master PNG (path in one constant; first release: the 1024 × 1024 Mobile icon
`source/app/platforms/native/assets/images/icon.png`), into the git-ignored
`source/app/platforms/electron/build-resources/`:
- `appx/` — `StoreLogo`, `Square44x44Logo`, `Square150x150Logo`, `Wide310x150Logo`, `SmallTile` (71),
  `LargeTile` (310), each at `scale-100/125/150/200/400`, plus `Square44x44Logo.targetsize-16/24/32/48/256` with
  `_altform-unplated` and `_altform-lightunplated` variants (exact table in
  [contracts/store-icons.md](contracts/store-icons.md)). electron-builder detects the qualified names and runs
  `makepri`.
- `icon.ico` (16–256, PNG-compressed entries, written by a ~40-line in-repo ICO writer) used by `win.icon` for the
  window, taskbar and the NSIS installer.

The master must be square, ≥ 1024 px, have an alpha channel; the drawn icon is never scaled above the master's size
(wide / large tiles place it on a transparent canvas). `check-store-icons.mjs` verifies every expected file, its exact
pixel size and that it is not blank.

**Rationale**: one source, repeatable, no new dependency; generated files are not committed (no drift).

**Alternatives considered**: Visual Studio's asset generator (manual, Windows-only GUI); committing hand-made PNGs (35+
files drift from the master).

## R10 — Signing

**Decision**: The **upload package is unsigned** (the Store signs it). For sideload testing,
`npm run package:store -- --test-sign` signs with a self-signed certificate created once with the documented
`New-SelfSignedCertificate` command (subject = `appx.publisher`, code-signing EKU), exported to a `.pfx` **outside**
the repository (default `%USERPROFILE%\.readmate-signing\readmate-store-test.pfx`). The wrapper reads
`READMATE_STORE_TEST_PFX` and `READMATE_STORE_TEST_PFX_PASSWORD`, reads the certificate subject with Node `crypto`
(`X509Certificate` after decoding the PFX through PowerShell `Get-PfxData`), refuses a subject ≠ `appx.publisher`,
then passes them to electron-builder only in the child environment as `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`; it never
prints them. `.gitignore` gets `*.pfx`, `*.p12`, `.readmate-signing/`; `check-store-secrets.mjs` (part of
`npm run check`, cross-platform) fails on any tracked `*.pfx` / `*.p12` / `PRIVATE KEY` block.

**Alternatives considered**: a purchased OV/EV certificate (not needed for Store distribution); signing with
`signtool` by hand (error-prone, not repeatable).

## R11 — Certification test and CI

**Decision**: `npm run store:wack` runs the Windows App Certification Kit (`appcert.exe test -appxpackagepath …
-reportoutputpath …`, from the Windows SDK; needs an elevated prompt) on the built package and writes
`docs/store/wack/<version>.xml` + a one-line summary to the submission log. Every Store script exits with
"skipped: Windows only" on other systems. `npm run check` gains only the cross-platform parts:
`check-store-config.mjs --allow-placeholders` (shapes and self-tests, placeholders allowed) and
`check-store-secrets.mjs`. CI (Ubuntu) therefore stays green (FR-015).

## R12 — Gates used instead of a constitution

The constitution file is an unfilled template, so the plan's gates are the repository's own binding rules from
`CLAUDE.md`: dependency rules R1–R12 (`check:boundaries`), the four-place IPC rule (Mobile `unavailable.ts` included),
the read-only / overlay invariant, Main-process changes approved in `source/scripts/desktop-main-changes.json`
(`check:desktop-baseline`), no new dependency without a reason, E2E manual-only, `npm run check` green.
