# Microsoft Store (MSIX) package — implementation map

Spec 010. Design: [spec](../../specs/010-msix-store-packaging/spec.md) ·
[plan](../../specs/010-msix-store-packaging/plan.md) · [research](../../specs/010-msix-store-packaging/research.md) ·
contracts: [store-build](../../specs/010-msix-store-packaging/contracts/store-build.md),
[store-icons](../../specs/010-msix-store-packaging/contracts/store-icons.md),
[store-import](../../specs/010-msix-store-packaging/contracts/store-import.md),
[packaged-runtime](../../specs/010-msix-store-packaging/contracts/packaged-runtime.md) ·
release records: [docs/store/](../store/)

_Completed in T071._

## Validation log

_Results of the Windows validation tasks (T018, T023, T038, T040, T064, T070) are recorded here._

### T018 — unsigned Store package (2026-11-08, Windows 11, electron-builder 26.18.0)

- Identity from Partner Center put in `store-identity.json`: `anthaile.ReadMateReader`,
  `CN=E2395284-7996-4927-857C-B41F415D298E`, `anthaile`. `check:store-config --self-test`: OK.
- First `npm run package:store`: **failed** at `electron-builder (appx)` with `Macro macro is not defined`. Cause: the
  comment at the top of `store/appxmanifest.xml` contained a literal dollar-brace "macro" text, and electron-builder
  expands every dollar-brace in the template, comments included. Fixed in the comment (23 known macros left, 0
  unknown). Steps before it passed: config, icons, tsc, package-deps, vite build, `win-unpacked/` + `afterPack` FFmpeg
  hash check.
- **Re-run after the fix — PASS.** Built by the maintainer at 19:27 (unsigned, see T023 for why):
  `source/app/platforms/electron/release/1.0.0/Readmate Reader-Windows-1.0.0-Store.msix`, 348,903,616 bytes,
  SHA-256 `64ecd6c90afae1b1bd8e00062af3649b68c478e4e56caf78d980d120c884ad7d`, Authenticode `NotSigned`.
  `check-store-package` on it: 15/15 PASS — Identity Name / Publisher / Version (`1.0.0.0`), ProcessorArchitecture x64,
  Capabilities = runFullTrust only, one `windows.protocol` `readmate-reader`, one `windows.startupTask`
  `ReadmateReaderStartup`, MinVersion `10.0.17763.0`, Windows.Desktop, contains `AppxManifest.xml`,
  `app/resources/app.asar`, `app/resources/ffmpeg/win32-x64/ffmpeg.exe`, `app/resources/store/startup-task.ps1`, no
  OAuth secret files.
- A leftover `~1admate Reader-Windows-1.0.0-Store.msix` (183 MB, 19:09) from an interrupted build sits next to it; it
  is not a valid package (git-ignored output; delete it).

### T023 — test signing (2026-11-08)

- `--test-sign` implemented (T019–T021): 13 `node --test` cases; `signtoolOptions.signingHashAlgorithms: ['sha256']`
  in the Store config (electron-builder only picks SHA-256-only signing for `*.appx` names; an MSIX cannot be
  dual-signed).
- **Wrong subject — PASS.** A throwaway `CN=Wrong` PFX (created in memory with .NET `CertificateRequest`, outside the
  repository, never added to a certificate store) with `npm run package:store -- --test-sign`: stopped at
  "test certificate" with `[cert_subject_mismatch] Test certificate subject "CN=Wrong" ≠ appx.publisher
  "CN=E2395284-7996-4927-857C-B41F415D298E"`, exit 1, nothing built (no `.msix`). The real PFX reader (Windows
  PowerShell + .NET `X509Certificate2`) was used. The password does not appear in the build log.
- **No secret tracked — PASS.** `git ls-files` lists no `.pfx` / `.p12`; `git status --ignored` shows none inside the
  repository; `check:store-secrets`: OK.
- **Why the maintainer's `npm run package:store -- --test-sign` came out unsigned (2026-11-08, reproduced):** Windows
  PowerShell 5.1 runs `npm.ps1`, which drops the `--`; npm took `--test-sign` as its own config (`npm warn Unknown cli
  config "--test-sign"`), the script got no argument and built unsigned without saying so. Fixed: the flag is also read
  from `npm_config_test_sign` (with a ⚠ line), every build prints its signing decision, regression tests added. Checked
  with the exact PowerShell form and the `CN=Wrong` certificate: the build now reaches "test certificate" and stops
  with `cert_subject_mismatch`. Direct form: `npm.cmd run package:store -- --test-sign`.
- **Signed build with the real test certificate + `Add-AppxPackage`: not done yet.** `READMATE_STORE_TEST_PFX` /
  `READMATE_STORE_TEST_PFX_PASSWORD` were set in the maintainer's own PowerShell window, which the agent's shell does
  not inherit (checked: not set at process or User scope). To be run in that window — `docs/store/signing.md` §3.

### T023 — signed build, FFmpeg exclusion (2026-11-08)

- The maintainer's signed build stopped in `afterPack` with `INTEGRITY_FAILED`: electron-builder had Authenticode-signed
  `resources/ffmpeg/win32-x64/ffmpeg.exe` (copied via `win.extraResources`), so its SHA-256 no longer matched
  `transcription/ffmpeg-artifacts.json`. Decision (maintainer): **do not sign `ffmpeg.exe`** →
  `electron-builder.json5` `win.signExts: ["!ffmpeg.exe"]`; reasons in `docs/implementation_plan/ffmpeg_packaging.md`
  "Code signing".
- Checked with app-builder-lib 26.18's real `WinPackager.shouldSignFile` on both configs: `ffmpeg.exe` (source and
  `win-unpacked`, `\` and `/`) → not signed; `Readmate Reader.exe`, other `.exe`, the `.msix` → signed.
- Real signed build (`npm.cmd run package:store -- --test-sign`) with a **throwaway** certificate whose subject is the
  publisher (file only, never in a certificate store; the maintainer's certificate was not available to the agent's
  shell): `afterPack` → `FFmpeg win32-x64: 1 file(s) verified` **PASS**; `win-unpacked\resources\ffmpeg\win32-x64\ffmpeg.exe`
  → `NotSigned` **PASS**; `win-unpacked\Readmate Reader.exe` → signed by `CN=E2395284-7996-4927-857C-B41F415D298E`
  **PASS** (`UnknownError` only because the throwaway root is not trusted). The raw password is not in the log
  (electron-builder prints the SHA-256 of the password in the signtool command line).
- **New blocker — the `.msix` itself is not signed:** `SignTool Error: A required function is not present`.
  electron-builder's default toolset (`toolsets.winCodeSign` `0.0.0` → winCodeSign-2.6.0) ships `signtool.exe`
  `WinBuild.160101` (Windows 10 1511 era), which predates MSIX (1809); no Windows SDK is installed here. Options:
  `toolsets.winCodeSign: "1.1.0"` (electron-builder's Windows Kits 10.0.26100 bundle, checksum-pinned, labelled beta)
  or install the Windows SDK and set `SIGNTOOL_PATH`. Awaiting the maintainer's choice; T023 stays open
  (install with `Add-AppxPackage` not done).
- **Blocker fixed (maintainer chose option 1):** `electron-builder.store.cjs` → `toolsets: { winCodeSign: '1.1.0' }`
  (Windows Kits 10.0.26100 bundle; Store config only, NSIS keeps the default). Signed rebuild with the same throwaway
  publisher-subject certificate — **PASS**: exit 0; `afterPack` FFmpeg verified; `check-store-package` 15/15;
  `.msix` signed by `CN=E2395284-7996-4927-857C-B41F415D298E` (throwaway thumbprint `E93CA27B…5F32`, `UnknownError` =
  untrusted throwaway root); `Readmate Reader.exe` signed; `ffmpeg.exe` `NotSigned`; raw password not in the log;
  "Signed with the test certificate … (sideload only)." printed. SHA-256 of that throwaway-signed package:
  `42b4d8acc4f74efc107a7f761a5b0bb521a8abd95feb7d416d801cb852b71f2a` (not for distribution).
- **Still to do for T023:** build with the maintainer's real (trusted) test certificate in their own PowerShell window and
  install with `Add-AppxPackage`; confirm the app opens.

- **Installed with the maintainer's real test certificate — PASS (2026-11-08).** `Get-AppxPackage *ReadmateReader*`:
  Name `anthaile.ReadMateReader`, PackageFullName `anthaile.ReadMateReader_1.0.0.0_x64__dpq7cpm4v6h3j`,
  PackageFamilyName `anthaile.ReadMateReader_dpq7cpm4v6h3j`, InstallLocation
  `C:\Program Files\WindowsApps\anthaile.ReadMateReader_1.0.0.0_x64__dpq7cpm4v6h3j`, Status `Ok`, SignatureKind
  `Developer`, AppId `ReadmateReader`. Opened: `Microsoft-Windows-AppModel-Runtime/Admin` event 201 "Created process
  31236 for application anthaile.ReadMateReader_dpq7cpm4v6h3j!ReadmateReader" at 21:16:42, container destroyed
  (event 217) at 21:33:08 — ran ~16 min, no crash. **T023 done.**

### ⚠ Finding: the Store build wrote into the installer build's data (R4 confirmed, 2026-11-08)

- During that run (21:16:42–21:33:08) these files of the **direct build's** `%APPDATA%\reading-book-desktop` changed:
  `reading-book.db-shm` 21:16:43, `Preferences` 21:16:53, `Network` 21:26, `reading-book.db-wal` 21:32:47 (4 MB).
  The package's private `LocalCache\Roaming` holds only `Microsoft\…` — no `reading-book-desktop`.
- Cause: T026–T027 (US2) are not implemented, so the package still uses userData `reading-book-desktop`; Windows lets a
  packaged app modify EXISTING files of the real AppData in place (research R4). This is exactly why R4 gives the
  Store build its own `Readmate Reader Store` folder.
- Status: the database, `-wal` and `-shm` are together in the real folder (consistent), but FR-014 ("never change the
  direct build's data") is violated by this pre-US2 package. **Do not launch a Store package again until T026–T027 are
  in it** and spike S1 (T037/T038) passes. Back up `%APPDATA%\reading-book-desktop` first.
- The smoke tests (T035/T040) were therefore NOT started; the agent did not launch the app.

### T038 — S1 own data folder (2026-11-09) — PASS (manual)

Package `anthaile.ReadMateReader_1.0.0.0_x64__dpq7cpm4v6h3j`, rebuilt with T026–T034 and reinstalled (installed
`app.asar` dated 2026-11-09 11:17:26), `SignatureKind Developer`, `Status Ok`.

- **Maintainer (by hand):** `Get-FileHash %APPDATA%\reading-book-desktop\reading-book.db` before the session gave
  `8634DE1D…398BD1`. They opened the Store app, used it, quit fully. The hash after was the same `8634DE1D…398BD1`.
  `Test-Path …\LocalCache\Roaming\Readmate Reader Store\reading-book.db` → `True`.
- **Agent (checked afterwards):**
  - The AppModel-Runtime log has the session as event 201 "Created process 8132" at 11:21:36 and event 217
    "Destroyed … container" at 11:28:55.
  - In `%APPDATA%\reading-book-desktop` (recursive), the newest LastWriteTime is `reading-book.db` at 00:39:46, before
    the session. No file changed between 11:21:36 and 11:28:55. That includes `-wal`, `-shm` and `Preferences`, the
    files changed in the 2026-11-08 incident.
  - The current hash of `reading-book.db` is `8634DE1DEB2D862797677D183ACF89714BA325E66EA95DE036D973001D398BD1`.
  - `Test-Path "$env:APPDATA\Readmate Reader Store"` from a normal shell (outside the package view) → `False`.
  - The private folder `…\Packages\anthaile.ReadMateReader_dpq7cpm4v6h3j\LocalCache\Roaming\Readmate Reader Store\`
    holds `reading-book.db` (294,912 bytes, 11:28:54), `Preferences`, `Local State`, `DIPS` and `SharedStorage`.
- **Deviations from S1 as written in T037:**
  1. It was run by hand, not through `spike:store:packaged`. **T037 is still not built.** It is not needed to go on
     with S2 / S4, but it is needed before T064, because S3 must hash the whole folder with the direct build running.
  2. Only `reading-book.db` was hashed, not the whole folder. With WAL, a write would show up first in `-wal` / `-shm`,
     not in the `.db` file. The LastWriteTime check of every file covers this, but it is weaker than per-file hashes.
  3. "One minute of use" in T037 became "a few seconds". The process itself lived 7 min 19 s.
  4. This was not a clean machine. That is fine for T038. A clean machine is T040.
- **Result: S1 PASS.** R4 is verified (research.md R4 "Verified 2026-11-09"). The R4 block on launching the package is
  lifted.

- **Side note: a second run of the pre-T026 package.** The log also shows a Store run from 2026-11-08 22:53:24 to
  2026-11-09 00:40:06. That run started before commit `054a8c8` (T026–T029, 00:21), so it was still the old package.
  Files in the direct folder changed during that window: `Local Storage` 22:54, `DIPS-wal` 23:53, caches 00:38,
  `reading-book.db-wal` 00:39:45, `reading-book.db` 00:39:46. It cannot be told which process wrote them. `npm run dev`
  also uses `reading-book-desktop` (`source/app/platforms/electron/package.json`), no NSIS build is installed, and dev
  work was going on at that time. The `.db` and `-wal` are together and consistent. The S1 baseline was taken after
  this window.

### T038 — S2 startup task, inside the package (2026-11-09) — first part PASS

- The installed `AppxManifest.xml` has `desktop:StartupTask TaskId="ReadmateReaderStartup" Enabled="false"
  DisplayName="Readmate Reader"`, the startup extension carries `uap10:Parameters="--hidden-at-startup"`, and it has
  `uap:Protocol Name="readmate-reader"`.
- `Invoke-CommandInDesktopPackage -PackageFamilyName anthaile.ReadMateReader_dpq7cpm4v6h3j -AppId ReadmateReader
  -Command cmd.exe -Args '/c powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File
  "<install>\app\resources\store\startup-task.ps1" get > <file>'` gave `{"state":"Disabled"}`. As a control, the same
  script outside the package gives `{"error":"Element not found. (Exception from HRESULT: 0x80070490)"}`. **A
  PowerShell child with package identity resolves the task.** The R5 fallback (`managedByWindows` + `Enabled="true"`)
  is not needed so far. Developer Mode is on (`AllowDevelopmentWithoutDevLicense = 1`).
- **Risk for cloud sign-in:** `HKCU\Software\Classes\readmate-reader` exists with `URL Protocol` but no
  `shell\open\command`. It is probably left over from an older `setAsDefaultProtocolClient` call by the dev or direct
  build. The agent did not touch it. If the browser does not return to the Store app, suspect this key first. Do not
  delete it without the maintainer's consent.
- Still to do (the maintainer, in the UI): cloud sign-in, reminder toast, Start at Login + `--hidden-at-startup`, and
  S4. Steps are in smoke-tests rows 8, 9, 11, 13, 14 and 15.

### T038 — S2 cloud sign-in (smoke row 11, 2026-11-09) — FAIL: packaged builds have no OAuth client config

- **What the maintainer saw** in the installed Store package, for all three providers:
  - Google: "GoogleDriveAuthService: clientId is required. Set GOOGLE_CLIENT_ID env var or pass credentials."
  - Dropbox: "Invalid client_id: ''".
  - Microsoft: "AADSTS900144 … 'client_id'".
- **Where the IDs come from.** `cloud.ipc.ts` builds every provider from
  `config/google-oauth-config.ts` / `config/cloud-oauth-config.ts`. Those read the git-ignored source files
  `client_secret_*.json` and `cloud-oauth-secrets.json` with `fs`, at
  `path.resolve(APP_ROOT, '../../../core/src/config')`. When a file is not there, the auth services fall back to
  environment variables: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`,
  `AZURE_CLIENT_ID` (+ `AZURE_TENANT_ID`). Nothing is hard-coded and there is no backend.
- **Why it fails.** `APP_ROOT` is `<resources>/app.asar` in any packaged build. The path then resolves to
  `C:\Program Files\WindowsApps\<package>\core\src\config` (MSIX) or `%LOCALAPPDATA%\Programs\core\src\config`
  (NSIS). Neither exists. `app.asar` (3,669 entries) contains no config file, by design: FR-033 / `check-no-secrets`
  forbids secret files in bundles, and `check-store-package` does the same for the `.msix`. No environment variable is
  set, so every ID is `''`.
- **Scope: every packaged build, not only the Store one.** The NSIS installer uses the same `files` list and the same
  `main.js`, so it should fail the same way. This comes from reading the code and config; an NSIS build was not run.
  `npm run dev` works, because `APP_ROOT` is the source folder and the maintainer's local files have every value.
  The maintainer's machine is not missing anything.
- **How to test sign-in locally without changing code (expected, not yet verified):** set the five variables at
  **User** scope from the existing local files (Dropbox's secret is optional with PKCE). Then sign out and back in, so
  the Store app started from Start gets them. Remove them after the test, because every process of the user can read
  them. The redirect URIs must already be registered:
  - Google Desktop client: loopback `http://127.0.0.1:8730/oauth2callback`;
  - Dropbox and Entra ID: `readmate-reader://oauth/callback`.
  If Dropbox or OneDrive does not return to the app, suspect the half-registered
  `HKCU\Software\Classes\readmate-reader` key first (see the S2 entry above).
- **Decided 2026-11-09 (maintainer): (a) + (c), implemented the same day** — KL-1 under "Known limitations" below.
  No secret is embedded. Re-test of Dropbox / OneDrive on a package rebuilt after the change: pending (maintainer).

## Known limitations

- **KL-1 — Cloud sign-in in distributed builds (found 2026-11-09). Decided 2026-11-09: (a) for Dropbox + OneDrive,
  (c) for Google Drive.**
  - **Problem.** OAuth client IDs were read only from git-ignored source files or environment variables (T038 S2 entry
    above). Every Cloud Sources sign-in therefore failed in every packaged build.
  - **(a) Dropbox + OneDrive, Store build: the public client IDs are embedded at build time.** Only the Dropbox app key
    and the Entra ID client ID are embedded. Both are public identifiers for authorization code + PKCE without a client
    secret. The app secret is never read.
    - `source/scripts/store/cloud-public-ids.cjs` takes each value from the build environment (`DROPBOX_APP_KEY` /
      `AZURE_CLIENT_ID`) or else from the local `cloud-oauth-secrets.json`. It checks the format (Dropbox key
      `[a-z0-9]{8,32}`, Entra ID a GUID) and refuses a value equal to any known secret.
    - `electron-builder.store.cjs` writes the values to `extraMetadata.readmateCloudOAuth`, which lands in
      `app.asar/package.json`.
    - `npm run package:store` stops before building when a value is missing or wrong (`cloud_id_missing`,
      `cloud_id_invalid`, `cloud_id_is_secret`, `cloud_secrets_unreadable`). After the build it reads `package.json`
      back out of `app.asar` and fails unless the object has exactly those two keys and the resolved values.
    - At run time, `config/cloud-oauth-config.ts` uses the local file in development and the embedded IDs in a packaged
      build. The `*_SECRET` variables are still honoured if set.
    - FR-033's `check-no-secrets` still searches the release output for every secret value.
    - Tests: `cloud-public-ids.test.mjs`, 10 cases.
    - **Console prerequisites (maintainer):** Dropbox App Console → "Allow public clients (Implicit Grant & PKCE)" is
      on, and `readmate-reader://oauth/callback` is a redirect URI. Entra ID → the redirect
      `readmate-reader://oauth/callback` is under "Mobile and desktop applications", and the supported account types
      include personal accounts (`common` endpoint).
  - **(c) Google Drive: not offered in any packaged build.**
    - `config/cloud-availability-core.mjs` makes Google Drive unavailable in a packaged build (Store and NSIS: same
      `files`, same `main.js`, so the same failure), and in development when its client ID or secret is missing.
      Tests: `cloud-availability.test.mjs`, 4 cases.
    - The new channel `cloud:getProviderAvailability` brings this to the renderer (`cloudProviderAvailabilityStore`).
    - The Cloud Sources dropdown shows "Google Drive · Coming soon" (or "Not configured" in development), disabled. Its
      screen, and so its Connect button, cannot be opened (`useLibraryView` guard).
    - `cloud:connect` in Main refuses it as well.
    - The Store listing (`docs/store/listing/*`) does not mention cloud sources at all; keep Google Drive out of it for
      v1.
    - To bring Google Drive back, the idea is a small token-exchange function that holds the client secret and stores
      no book data, keeping the local-first design. Google's OAuth app verification for the Drive scope is also needed
      before public distribution.
  - **NSIS installer: build left unchanged (as asked).** It gets the Google Drive rule at run time (`app.isPackaged`),
    but no embedded IDs. **Dropbox / OneDrive sign-in in the NSIS build therefore still fails as before.** The same
    `extraMetadata` line in `electron-builder.json5` would fix it once wanted.
