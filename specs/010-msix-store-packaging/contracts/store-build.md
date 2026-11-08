# Contract: Store build commands, config and outputs

## Commands (repository root)

| Command | Platform | Does | Exit |
|---|---|---|---|
| `npm run package` | any (installer: Windows) | unchanged NSIS / dmg / AppImage build; now also runs `store:icons` first (for `win.icon`) | as today |
| `npm run package:store` | Windows | `check-store-config` → `store:icons` + `check-store-icons` → `tsc` + `check:package-deps` + `build` → `electron-builder --win --config electron-builder.store.cjs` → `check:desktop-package` on the Store app dir → prints package path + SHA-256 | 0 = package written |
| `npm run package:store -- --test-sign` | Windows | same, and signs with the test certificate (env below) | 0 = signed package written |
| `npm run store:icons` | any | regenerate `source/app/platforms/electron/build-resources/` from the master icon | 0 / 1 |
| `npm run store:wack` | Windows, elevated | Windows App Certification Kit on the newest package → `docs/store/wack/<version>.xml` + summary line | 0 = no failed required test |
| `npm run check:store-config` | any | identity / version / extensions checks; `--allow-placeholders` in `npm run check`; `--self-test` negative tests | 0 / 1 |
| `npm run check:store-secrets` | any | no tracked `*.pfx`, `*.p12`, `-----BEGIN … PRIVATE KEY-----` | 0 / 1 |

On a non-Windows system, `package:store` and `store:wack` print `skipped: the Microsoft Store package is built on
Windows only` and exit 0.

## Environment (test signing only)

| Variable | Meaning | Rules |
|---|---|---|
| `READMATE_STORE_TEST_PFX` | absolute path of the test `.pfx` | outside the repository; file exists |
| `READMATE_STORE_TEST_PFX_PASSWORD` | its password | never printed, never written; passed only to the child as `WIN_CSC_KEY_PASSWORD` |

`--test-sign` without both variables → error, no package. Without `--test-sign` the variables are ignored and the
output says: `Unsigned package for Partner Center upload. It cannot be installed locally; use --test-sign for that.`

## Errors (all collected, printed together, exit 1, nothing built)

| Code | Message (shape) |
|---|---|
| `identity_placeholder` | `appx.<field> is still a placeholder — copy it from Partner Center → Product identity` |
| `identity_shape` | `appx.<field> "<value>" is not valid: <rule>` |
| `version_invalid` | `Version "<v>" is not valid for the Store: use MAJOR.MINOR.PATCH with MAJOR ≥ 1 (the Store adds .0)` |
| `version_not_increased` | `Version <v> is not greater than the last submitted <last> (docs/store/submissions.md)` |
| `extensions_invalid` | `appx-extensions.xml must declare the startup task ReadmateReaderStartup` |
| `cert_subject_mismatch` | `Test certificate subject "<s>" ≠ appx.publisher "<p>"` |
| `cert_in_repo` | `The test certificate must be outside the repository` |
| `icon_master_invalid` | `Master icon <path>: <width>×<height>, needs a square PNG ≥ 1024 px with transparency` |

## Files

| Path | Tracked | Content |
|---|---|---|
| `source/app/platforms/electron/store/store-identity.json` | yes | data-model §1 values (placeholders until Partner Center) |
| `electron-builder.store.cjs` | yes | `extends: "./electron-builder.json5"`; `appx` built from `store-identity.json`; `win.target: [{ target: "appx", arch: ["x64"] }]`;  `artifactName: "${productName}-Windows-${version}-Store.msix"`; `directories.buildResources` |
| `source/app/platforms/electron/store/appx-extensions.xml` | yes | the startup task (packaged-runtime contract) |
| `source/app/platforms/electron/build-resources/` | **no** (gitignored) | generated icons |
| `source/scripts/store/*.mjs` | yes | wrapper, checks, icon generator, ICO writer, WACK runner |
| `source/app/platforms/electron/release/<version>/…-Store.msix` | no | output, next to the NSIS installer |
| `docs/store/checklist.md`, `submissions.md`, `smoke-tests.md`, `listing/`, `wack/` | yes | release records (FR-016–FR-019) |

## Package content rules (checked on the Store app directory)

Same as `check:desktop-package` today (Main entry + externals present, no `react-native` / `expo` /
`platforms/native`), plus: `AppxManifest.xml` capabilities = `runFullTrust` only; one `windows.protocol`
`readmate-reader`; one `windows.startupTask` `ReadmateReaderStartup`; `resources/ffmpeg/win32-x64/ffmpeg.exe`
present (the `afterPack` hash check already runs for every target); no file named `cloud-oauth-secrets.json` or
`client_secret_*.json`.
