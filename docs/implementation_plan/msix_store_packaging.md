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
