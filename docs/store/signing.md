# Test-signing the Store package

> Spec 010 (research R10, contracts/store-build.md "Environment"). The package uploaded to Partner Center is
> **unsigned**: the Microsoft Store signs it with its own certificate. A self-signed test certificate is only for
> installing the package on your own machine (sideloading) before you submit it.

## 1. Create the test certificate (once)

The subject MUST be exactly the `publisher` of `source/app/platforms/electron/store/store-identity.json`
(Partner Center → Product identity → Package/Identity/Publisher). Keep the `.pfx` **outside** the repository.

```powershell
$pub = 'CN=E2395284-7996-4927-857C-B41F415D298E'   # = appx.publisher in store-identity.json
$c = New-SelfSignedCertificate -Type Custom -Subject $pub -KeyUsage DigitalSignature `
     -FriendlyName 'Readmate Store test' -CertStoreLocation Cert:\CurrentUser\My `
     -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
New-Item -ItemType Directory -Force "$env:USERPROFILE\.readmate-signing" | Out-Null
$pw = Read-Host -AsSecureString 'PFX password'
Export-PfxCertificate -Cert $c -FilePath "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx" -Password $pw
```

## 2. Trust it for sideloading (elevated PowerShell, once per machine)

```powershell
Import-PfxCertificate -FilePath "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx" `
     -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw
```

## 3. Build a signed package

The two variables are read by `npm run package:store -- --test-sign` from **the environment of the process that runs
it**. Set them in the same shell that runs the build, for that session only (never in a file, never in the repo):

```powershell
$env:READMATE_STORE_TEST_PFX = "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx"
$env:READMATE_STORE_TEST_PFX_PASSWORD = '<password>'
npm run package:store -- --test-sign
Add-AppxPackage "source\app\platforms\electron\release\<version>\Readmate Reader-Windows-<version>-Store.msix"
```

Variables set in one terminal window are not visible to another one (or to an agent's shell) — run the build in the
window where you set them.

**Windows PowerShell and `--`:** `npm` there is the `npm.ps1` wrapper, and PowerShell drops the `--` of
`npm run package:store -- --test-sign`. npm then prints `npm warn Unknown cli config "--test-sign"`, keeps the flag
for itself and runs the script without it. The build still honours that form (it reads `npm_config_test_sign` and
prints a ⚠ line saying so), but the direct way is:

```powershell
npm.cmd run package:store -- --test-sign
```

Every build prints its signing decision: `▶ package:store — test certificate` + `subject … = appx.publisher` when
signing, `▶ package:store — signing: none …` when not.

What the build does with them (`source/scripts/store/test-sign.mjs`):

- refuses, before building anything: a missing variable (`test_sign_env_missing`), a relative or missing path
  (`test_sign_pfx_missing`), a `.pfx` inside the repository (`cert_in_repo`), a `.pfx` it cannot open
  (`test_sign_pfx_unreadable`), an expired certificate (`test_sign_cert_expired`), a subject ≠ `appx.publisher`
  (`cert_subject_mismatch`); warns when the certificate expires within 30 days;
- reads the certificate with Windows PowerShell; the path and password reach that child through its environment only,
  never its command line;
- passes them to the electron-builder child only, as `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`; every other child
  (tsc, vite, checks) gets an environment without any signing variable; nothing prints the password.

Without `--test-sign`, all signing variables are removed from every child, so a stray `CSC_LINK` can never sign the
upload package.

**Signing tool:** the Store config uses electron-builder's `toolsets.winCodeSign: "1.1.0"` (Windows Kits 10.0.26100).
The default toolset's 2016 `signtool.exe` cannot sign an `.msix` ("SignTool Error: A required function is not
present").

**What gets signed:** `Readmate Reader.exe`, other `.exe` files of the app, and the `.msix` itself. **Not** the bundled
`ffmpeg.exe` (`win.signExts: ["!ffmpeg.exe"]`): its trust anchor is the SHA-256 in
`transcription/ffmpeg-artifacts.json`, and signing would change its bytes, so `afterPack` would stop the build with
`INTEGRITY_FAILED`. See `docs/implementation_plan/ffmpeg_packaging.md` "Code signing".

## 4. Renew or remove

- Renew: create a new certificate (step 1) before `NotAfter`; the build warns 30 days ahead.
- Remove from the machine:
  ```powershell
  Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\TrustedPeople |
    Where-Object Subject -eq 'CN=E2395284-7996-4927-857C-B41F415D298E' | Remove-Item   # elevated for LocalMachine
  Remove-Item "$env:USERPROFILE\.readmate-signing\readmate-store-test.pfx"
  ```
- Uninstall the sideloaded app: `Get-AppxPackage *ReadMateReader* | Remove-AppxPackage`.
