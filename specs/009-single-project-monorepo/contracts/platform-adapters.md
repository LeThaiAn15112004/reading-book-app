# Contract: Platform Adapters (`source/app/platforms/`)

Implements FR-010a. The mobile app keeps running the shared UI in a WebView (spec 008); adapters only choose
host-specific code at build time.

## Rules

1. A **concern** is one file name with two implementations: `<concern>.electron.ts(x)` (Desktop renderer) and
   `<concern>.native.ts(x)` (Mobile WebView). Both export the same names with the same types.
2. UI code imports `@app/platforms/<concern>` (no suffix). Importing a suffixed file directly is a lint error.
3. Resolution: Vite `resolve.extensions` lists the host's suffix first; TypeScript `moduleSuffixes` does the same in
   `tsconfig.electron.json` / `tsconfig.native.json` (research R4). Both tsconfigs are type-checked in `npm run typecheck`.
4. A Desktop build contains no `.native` module and a Mobile WebView build no `.electron` module (checked by grepping
   the build output in Phase 3.2).
5. Screens never call `isMobileHost()` for something an adapter covers; the `host` concern answers feature questions
   (`isFeatureAvailable`) for UI that stays shared but hides entries.
6. `check:platform-adapters` fails when a concern has one file only, or when the two export different names.

## Concerns (first set)

| Concern | `.electron` | `.native` | Replaces |
|---|---|---|---|
| `api` | `window.api` from Electron's preload | builds the Mobile Bridge (`createBridge`) and returns it | `web/src/main.ts` injecting `window.api`; the global type in `electron-env.d.ts` |
| `host` | `isMobileHost() = false`, every feature available | `true`, first-release feature set | `src/platform/index.ts` (`__READMATE_HOST__`) |
| `storage` | book bytes via `openBookContent` IPC, covers via `rb-cover://` | local-server URLs with the per-launch token | the split inside `library.openBookContent` / cover URLs |
| `window` | title bar, fullscreen, window controls, native theme | system bars colours, safe areas, no-op fullscreen | `chrome` desktop calls, `web/src/bridge/system-bars.ts` |
| `longPress` | `{ onContextMenu }` only | touch long press | `src/platform/long-press.ts` |

More concerns are added only when a screen would otherwise branch on the platform.

## Host code beside the adapters

`platforms/electron/` (Main, Preload, workers, spikes, E2E, packaging) and `platforms/native/` (React Native host,
host services, local-server module, plugins, WebView entry) are **not** adapters: they are each host's own program.
UI code never imports them; adapters may import the WebView-side parts of `native/` (bridge, stores).
