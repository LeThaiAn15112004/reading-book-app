# Contract: Dependency Rules After the Move

Spec 008's rules R1–R11, re-pointed to the new folders (FR-011). Enforced by `npm run check:boundaries`, each with a
negative test that must fail.

| # | Rule | New scope |
|---|---|---|
| R1 | Core uses no Node or DOM globals | `source/core/src` compiled by `tsconfig.core.json` (`lib: ES2022`, `types: []`) |
| R2 | Core imports no forbidden packages | `source/core/src`: only relative paths and `zustand/vanilla` |
| R3 | Core never imports the app | `source/core/**` must not import `source/app/**` |
| R4 | (was: SDK `dist/` self-contained) | **Retired** with FR-012 |
| R5 | Graph is acyclic: app → core, never core → app | Import graph check |
| R6 | Adapters implement core ports | Driver ports (`sql-drivers.md`) implemented in `platforms/electron`, `platforms/native` |
| R7 | The two hosts never import each other | `platforms/electron/**` ↛ `platforms/native/**` and the reverse; `*.electron.*` ↛ `*.native.*` |
| R8 | Mobile host and WebView bundle contain no Electron code | `platforms/native/**` and the WebView build graph contain no `electron`, `better-sqlite3`, `platforms/electron/**` |
| R9 | Only the `api` adapter touches `window.api` | `window.api` appears only in `source/app/platforms/api.*.ts` (and the preload that defines it) |
| R10 | Shared code runs in supported WebViews | Manual device check (unchanged) |
| R11 | Node-only host adapters not used by Mobile | `platforms/electron/host-adapters/**` imported only from `platforms/electron/**` |
| R12 (new) | UI imports adapters without suffix | No import of `*.electron` / `*.native` outside `source/app/platforms/` |
