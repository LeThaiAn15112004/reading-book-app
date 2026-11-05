# Data Model: One Project for Desktop and Mobile

No stored user data changes (Desktop migrations 001–030 and the Mobile baseline are moved byte-identical). The
"entities" of this feature are project artefacts.

## Entities

| Entity | Fields / rules | Validated by |
|---|---|---|
| **Project manifest** (`package.json`, root) | `name`, `private`, `main: "expo-router/entry"`, `dependencies` (union, research R1 versions), `devDependencies`, `scripts` (contracts/root-commands.md), `expo.autolinking` paths. Exactly one in the repo outside `node_modules`, `android/`, `ios/` | `find -name package.json` (SC-002), FR-009 |
| **Lock file** (`package-lock.json`, root) | Exactly one; CI uses `npm ci` on it | SC-002, FR-007 |
| **Install folder** (`node_modules`, root) | Exactly one top level; nested `node_modules` only inside packages (npm's own) | SC-002, FR-006 |
| **Area folder** | `source/core` (logic), `source/app` (UI + `platforms/`), `source/scripts`; each with allowed imports (contracts/dependency-rules.md) | `check:boundaries` |
| **Platform concern** | Pair `<name>.electron.ts` / `<name>.native.ts`, same exports | `check:platform-adapters` |
| **SQL statement** | `{ sql, params }`, built in core, run by a host executor | core tests, store spikes |
| **Migration file** | Path under `source/core/src/db/{desktop,mobile}/migrations/`; SHA-256 unchanged | `check:desktop-baseline` |
| **Root command** | Script name → what it runs; old command → replacement | contracts/root-commands.md, SC-003 |

## Path map (old → new)

| Old | New | Phase |
|---|---|---|
| `package.json` (root, launcher) + `source/package.json` + 3 app manifests + `packages/config/package.json` | `package.json` (root) | 1.4 |
| `source/package-lock.json`, `apps/*/package-lock.json`, root lock | `package-lock.json` (root) | 1.4 |
| `apps/reading-book-mobile/{app.json,metro.config.js,babel.config.js}` | repository root | 1.5 |
| `apps/book-reader-sdk/src`, `tests` | `source/core/src`, `source/core/tests` | 2.1 |
| `apps/book-reader-sdk/dist`, `build.mjs` | removed (FR-012) | 2.1 |
| `packages/config/*` | `source/core/src/config/*` | 2.1 |
| `apps/reading-book-desktop/electron/persistence/migrations/*.sql` | `source/core/src/db/desktop/migrations/` | 2.3 |
| `apps/reading-book-mobile/web/src/db/migrations/*` | `source/core/src/db/mobile/migrations/` | 2.3 |
| SQL + row mapping inside `sqlite-*-store.ts` and `web/src/stores/*` | `source/core/src/db/<store>/{statements,codec}.ts` | 2.4–2.8 |
| `apps/reading-book-desktop/src/screens` | `source/app/screens` | 3.1 |
| `apps/reading-book-desktop/src/{components,chrome,reader}` | `source/app/components/{…,chrome,reader}` | 3.1 |
| `apps/reading-book-desktop/src/{hooks,theme,styles,shortcuts,utils,bridge,main.tsx,App.tsx,index.css}`, `index.html` | `source/app/…` (same names) | 3.1 |
| `apps/reading-book-desktop/src/platform/*` | `source/app/platforms/{host,longPress}.{electron,native}.ts` | 3.2 |
| `apps/reading-book-desktop/{electron,spikes,e2e,scripts,resources,assets,electron-builder.json5}` | `source/app/platforms/electron/…` (builder config at the root) | 3.3 |
| `apps/book-reader-sdk/host-adapters` | `source/app/platforms/electron/host-adapters` | 3.3 |
| `apps/reading-book-mobile/src/{host,app}` | `source/app/platforms/native/{host,routes}` | 3.4 |
| `apps/reading-book-mobile/web/src/{bridge,stores}`, `web/tests` | `source/app/platforms/native/{bridge,stores}`, `source/app/platforms/native/tests` | 3.4 |
| `apps/reading-book-mobile/{modules,plugins,scripts}` | `source/app/platforms/native/{modules,plugins,scripts}` | 3.4 |
| `source/scripts/*` | `source/scripts/*` (unchanged) | — |
