# Quickstart: validating the Microsoft Store package

**Feature**: [spec.md](spec.md) · Contracts: [store-build](contracts/store-build.md),
[store-icons](contracts/store-icons.md), [store-import](contracts/store-import.md),
[packaged-runtime](contracts/packaged-runtime.md)

## Prerequisites

- Windows 10 1809+ or Windows 11 x64, `npm install` done at the repository root.
- For §3–§6: the identity values from Partner Center → Product identity in `electron-builder.store.cjs` (until then,
  §1 and §2 still run).
- For §3: a test certificate (created once, outside the repository):

  ```powershell
  $pub = 'CN=<publisher from Partner Center>'
  $c = New-SelfSignedCertificate -Type Custom -Subject $pub -KeyUsage DigitalSignature `
       -FriendlyName 'Readmate Store test' -CertStoreLocation Cert:\CurrentUser\My `
       -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.readmate-signing" | Out-Null
  $pw = Read-Host -AsSecureString 'PFX password'
  Export-PfxCertificate -Cert $c -FilePath "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx" -Password $pw
  # trust it for sideloading (elevated prompt):
  Import-PfxCertificate -FilePath "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx" `
       -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw
  ```
- For §5: the Windows SDK's App Certification Kit (`appcert.exe`), an elevated prompt.
- A second Windows account or VM that has never had Readmate installed (§4), and one with the direct build in use (§6).

## §1 Cross-platform checks (also in CI)

```bash
npm run check:store-config -- --allow-placeholders --self-test
npm run check:store-secrets
npm run check
```

Expected: all pass with placeholders in place. `npm run check:store-config` (without the flag) fails and lists each
placeholder field (spec US1 AS 2). Setting `extraMetadata.version` to `0.0.0` fails with `version_invalid` (US1 AS 3).

## §2 Icons

```bash
npm run store:icons && node source/scripts/store/check-store-icons.mjs
```

Expected: every row of the icon contract exists at its exact size. Pointing `MASTER_ICON` at a 512 px or non-square
PNG stops with `icon_master_invalid` (US3 AS 2).

## §3 Build

```powershell
npm run package:store                    # unsigned, for upload
$env:READMATE_STORE_TEST_PFX = "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx"
$env:READMATE_STORE_TEST_PFX_PASSWORD = '<password>'
npm run package:store -- --test-sign     # signed, for sideloading
```

Expected: `source/app/platforms/electron/release/<version>/Readmate Reader-Windows-<version>-Store.msix` and the NSIS
installer, path + SHA-256 printed, no password in the output. A certificate with another subject stops with
`cert_subject_mismatch` (US4 AS 2). `git status` shows no `.pfx` (US4 AS 4).

## §4 Packaged-runtime spike and smoke tests (clean machine)

Install the test-signed package (double-click, or `Add-AppxPackage <file>.msix`), then run
`npm run spike:store:packaged` from the repository on the same machine (guided: it checks files, hashes and the
manifest itself, tells you which action to take in the installed app for the rest, and prints pass / fail per scenario):

| Scenario | Proves | Research |
|---|---|---|
| S1 | Store data lives in its own `Readmate Reader Store` folder; the direct build's folder is unchanged | R4 |
| S2 | protocol link, startup task state + `--hidden-at-startup`, toast with name and icon | R5, R6 |
| S3 | import copies, never touches the source (hashes before/after, incl. direct build running) | R8 |
| S4 | attachment opens in the default viewer; "Show in folder" on a managed book | R7 |
| S5 | renderer preferences present after import | R8 |

Then follow `docs/store/smoke-tests.md` by hand and fill in the column for this version. Expected: 100 % pass (SC-003).
Uninstall: the app disappears, books in Documents and annotations written into PDFs are still there (FR-010).

## §5 Certification kit

```powershell
npm run store:wack     # elevated
```

Expected: `docs/store/wack/<version>.xml` written, no failed required test (SC-002), one row added to
`docs/store/submissions.md`.

## §6 Moving from the installer version (User Story 6)

On the account that uses the direct build: note the number of books and annotations, then
`Get-ChildItem -Recurse $env:APPDATA\reading-book-desktop | Get-FileHash > before.txt`. Install the Store package,
start it, choose **Import**. Check library, annotations, positions, Appearance settings; linked cloud accounts show
"sign in again". Close the Store app, start the direct build, repeat the hash listing: identical to `before.txt`
(SC-009). Repeat with: the direct build open (→ "close it and try again"), the import cancelled in the progress window
(→ next launch offers again, no partial library), **Start empty** (→ never offered again; Settings → Advanced offers
it while the library is empty).

## §7 Submission

Follow `docs/store/checklist.md` from the top. Expected: every Partner Center field has a prepared answer or a named
source; the upload is the unsigned `.msix` from §3 (SC-006).
