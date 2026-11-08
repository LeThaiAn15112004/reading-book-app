# Implementation Plan: Microsoft Store Package for the Desktop App

**Branch**: `010-msix-store-packaging` (spec directory only; work stays on the current branch) | **Date**: 2026-11-08 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-msix-store-packaging/spec.md`

## Summary

Build a Microsoft Store package (`.msix`, x64) of the Desktop app next to the unchanged NSIS installer, using
electron-builder 26.18's own `appx` target through a separate `electron-builder.store.json5` that extends the base
config (R1). A wrapper `npm run package:store` validates the Partner Center identity and the Store version
(placeholders and `0.0.0` stop the build; R2, R3), generates every Store logo and the desktop `.ico` from one master
icon with `sharp` (R9), and optionally test-signs with a self-signed certificate kept outside the repository (R10).

Inside the package the app gets **its own `userData` folder** (`Readmate Reader Store`). This is required, because
Windows' AppData virtualization would otherwise let the Store build modify the installer version's existing database
in place (R4). It also skips the protocol and AUMID registrations that the package provides (R6), uses the Windows
startup task for Start at Login (R5), and maps app-owned paths before handing them to Explorer or other apps (R7).
On its first launch it offers a copy-only, all-or-nothing import of the installer version's library, done in Main
before any window opens (R8, FR-014). Release records (submission checklist, smoke tests, certification kit results,
submission log) live in `docs/store/`.

## Technical Context

**Language/Version**: TypeScript (strict) for Main / renderer / core; Node ESM `.mjs` for build scripts; one checked-in
Windows PowerShell 5.1 script (startup task state)

**Primary Dependencies**: existing only: `electron-builder` 26.18.0 (`appx` target, bundled `makeappx` / `makepri` /
`signtool`), Electron 39.8.10, `sharp` (already installed as a Main external, used here by a build script only),
`better-sqlite3` (staged import database). **No new dependency.** Windows SDK App Certification Kit for `store:wack`
(maintainer tool, not a project dependency).

**Storage**: no migration. The Store build has its own `userData` (`%APPDATA%\Readmate Reader Store`, virtualized
into the package). New files: `store-import.json` (marker) and the transient `store-import.partial/`. Release records
are Markdown and XML under `docs/store/`.

**Testing**: core vitest (`source/core/tests/store-import/*`: allowlist plan, `rewriteRoot`, newer-schema test, count
check, marker state machine). Build-script self-tests (`check-store-config --self-test`, icon checks). Desktop
spikes: `spike:store:import` (real better-sqlite3 + migrated schema on temp folders: copy, rewrite, refusals,
interruption and recovery, source byte-identical), `spike:store:packaged` (guided, on the installed package:
S1–S5 in quickstart). Manual smoke-test list per release. E2E stays manual-only and gets no new spec.

**Target Platform**: Windows 10 1809 (10.0.17763) → Windows 11, x64 only (the bundled FFmpeg exists for win32-x64 only)

**Project Type**: desktop app (Electron), distribution / packaging feature

**Performance Goals**: import copies at disk speed with progress (streams, no whole-file buffers); the start-up cost
for users who are not importing is one `stat` of the marker plus one `stat` of the source database; the startup-task
query returns within 10 s or falls back

**Constraints**: the direct build's data and behaviour stay unchanged (FR-014, SC-008); the import never opens the
source with SQLite and never writes to it; no secret is tracked or printed (FR-013); `npm run check` stays green on
Ubuntu CI (FR-015); every Main file change is approved in `source/scripts/desktop-main-changes.json`

**Scale/Scope**: about 10 new script / Main modules, 1 new core module, 2 new IPC channels + 1 background channel,
about 45 generated image files, 4 new docs under `docs/store/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so it has no ratified principles to check. The
gates below are the repository's binding rules from `CLAUDE.md` (research R12).

| Gate | Pre-research | Post-design |
|---|---|---|
| G1 Core purity (R1–R3): core has no Node / DOM / Electron, no app import | ✅ only pure rules go to `source/core/src/store-import/` (strings, numbers, plans) | ✅ host I/O (fs, dialogs, better-sqlite3, PowerShell) all in `platforms/electron/store-import/` and `background/` |
| G2 Host separation (R7, R8, R11, R12) | ✅ Store code lives only on the Desktop side | ✅ the new IPC group is answered by Mobile `unavailable.ts` (`NOT_AVAILABLE_ON_PLATFORM`); no `.electron` import outside `platforms/` |
| G3 IPC four places | ✅ planned | ✅ `StoreImportChannels` + `BackgroundChannels.openStartupSettings`: `channels.ts`, `*.ipc.ts`, `preload.ts` / `api-types.ts`, `bridge/` |
| G4 Read-only / overlay invariant | ✅ no book write path changes | ✅ referenced files are never copied or touched; managed copies are copied into the Store folder; the source data is read only |
| G5 No new dependency | ✅ | ✅ (`sharp` and electron-builder are already installed) |
| G6 Secrets stay out | ✅ | ✅ upload package unsigned; `.pfx` outside the repo, env-only password, `check:store-secrets` in `npm run check`, `.gitignore` entries |
| G7 Main-process changes approved | ⚠️ needed | ✅ the tasks phase adds entries for `main.ts`, `background/login-item.ts`, the new modules and every `shell.*` call routed through `pathForOtherApps` |
| G8 CI / check green, E2E manual | ✅ | ✅ Store scripts skip outside Windows; only cross-platform checks join `npm run check` |

No violations, so Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/010-msix-store-packaging/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R12
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── store-build.md        # commands, config, env, errors, outputs
│   ├── store-icons.md        # every generated logo
│   ├── store-import.md       # one-time import: allowlist, dialogs, steps, IPC
│   └── packaged-runtime.md   # userData, protocol, AUMID, startup task, external paths
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
electron-builder.json5                     # extraMetadata.version → 1.0.0; win.icon; buildResources (base)
electron-builder.store.json5               # NEW: extends base; appx target (.msix), identity, extensions, extraResources
package.json                               # scripts: package:store, store:icons, store:wack, check:store-config,
                                           #          check:store-secrets, spike:store:import, spike:store:packaged
.gitignore                                 # *.pfx, *.p12, .readmate-signing/, build-resources/

source/scripts/store/                      # NEW (Node ESM)
├── package-store.mjs                      # wrapper: validate → icons → build → electron-builder → post-checks
├── check-store-config.mjs                 # identity / version / extensions (+ --allow-placeholders, --self-test)
├── check-store-secrets.mjs
├── check-external-paths.mjs               # shell.* on app-owned paths must use pathForOtherApps
├── generate-icons.mjs  ico-writer.mjs  check-store-icons.mjs
└── run-wack.mjs

source/core/src/store-import/              # NEW, pure: plan, rewriteRoot, isNewerSchema, verifyCounts, marker states
source/core/tests/store-import/            # NEW vitest

source/app/platforms/electron/
├── main.ts                                # Store branch: setPath first, skip protocol + AUMID, import before window
├── store/
│   ├── appx-extensions.xml                # NEW startup task
│   └── startup-task.ps1                   # NEW (shipped via extraResources)
├── store-import/                          # NEW: detect, dialogs, progress window, copy, stage-db, commit, recover
├── background/login-item.ts               # Store branch → store-startup-task.ts
├── background/store-startup-task.ts       # NEW
├── files/external-path.ts                 # NEW pathForOtherApps
├── ipc/channels.ts  ipc/store-import.ipc.ts (NEW)  ipc/background.ipc.ts  ipc/index.ts  ipc/api-types.ts  preload.ts
├── spikes/store-import.mjs  spikes/store-packaged.mjs   # NEW
└── build-resources/                       # generated, gitignored (appx/ logos, icon.ico)

source/app/bridge/storeImport.ts           # NEW thin wrapper (+ bridge/index.ts)
source/app/screens/Settings/…              # Advanced: import row; Background: start-at-login states + Startup settings button
source/app/platforms/native/bridge/unavailable.ts   # storeImport group → NOT_AVAILABLE_ON_PLATFORM

docs/store/                                # NEW: checklist.md, submissions.md, smoke-tests.md, listing/{en-US,vi-VN}.md,
                                           #      privacy-facts.md, wack/
```

**Structure decision**: the existing single-project layout (spec 009). Build tooling goes in `source/scripts/store/`,
host code in the Desktop host, pure rules in core, and release records in `docs/store/`, next to the other docs.

## Phase notes for `/speckit-tasks`

1. **Order**: config + checks (US1) → icons (US3) → signing (US4) → runtime branches R4/R6 → spike S1/S2 on a real
   package → startup task (R5) → external paths (R7, spike S4) → import (R8, `spike:store:import`, then S3/S5) →
   docs (US5).
2. **Verify-first items**: before implementing the dependent code, run research items marked *(verify)* on a real
   test-signed package: S1 before the import, S2 before the startup-task UI, S4 before routing `shell.*` calls. If one
   fails, take the fallback written in research.md and record the result there.
3. **Baseline**: raising `extraMetadata.version` may touch `check:desktop-baseline` / `check:desktop-package`
   expectations; update them with an approval note, do not loosen them.
4. **Docs**: add a short "Microsoft Store package" paragraph to `CLAUDE.md` (commands, the separate `userData`, the
   import, `docs/store/`) and a map in `docs/implementation_plan/msix_store_packaging.md`.

## Complexity Tracking

No constitution or gate violations to justify.
