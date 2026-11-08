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
- **Re-run after the fix: not done yet.** No `.msix` exists yet; `check-store-package` has not run on a real package.

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
- **Signed build with the real test certificate + `Add-AppxPackage`: not done yet.** `READMATE_STORE_TEST_PFX` /
  `READMATE_STORE_TEST_PFX_PASSWORD` were set in the maintainer's own PowerShell window, which the agent's shell does
  not inherit (checked: not set at process or User scope). To be run in that window — `docs/store/signing.md` §3.
