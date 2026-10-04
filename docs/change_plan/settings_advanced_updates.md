# Settings → Advanced → Updates (SCR-06)

Status: implemented — **Current Version works; Check for Updates has no real update provider yet
and says so.** No updater, download, update server or fake result was added.

## What the codebase had (inspected before implementing)

| Topic | Finding |
|---|---|
| App version | `app:getAppInfo` IPC already existed (`electron/ipc/app.ipc.ts`) returning `app.getVersion()` — Electron reads it from `package.json` (`"version": "0.0.0"`). Bridge: `appApi.getAppInfo()`. |
| Electron / packaging | Electron `^39.8.10`, electron-builder `^26.15.3`. `electron-builder.json5` builds **mac `dmg`, win `nsis`, linux `AppImage`**; `appId` is still `"YourAppID"`. There is **no `mas` (Mac App Store) or `appx`/MSIX (Microsoft Store) target** in the repo. |
| Update mechanism | None: no `electron-updater`, no `autoUpdater`, no update server URL. |
| Settings | Sidebar section `advanced` existed as a placeholder; pages use `SettingsCard` + zustand stores per section. |
| Store URLs | Not referenced anywhere in the code. |

## What was implemented

```
Advanced
└── Updates
    ├── Current Version   0.0.0  (from app.getVersion())
    └── [ Check for Updates ] → inline status
```

**Current Version** — `useUpdatesStore.loadVersion()` → existing `appApi.getAppInfo()` →
`app.getVersion()`. Nothing is hard-coded; bump `package.json` and the page follows. (If the call
fails the page shows "Unknown".)

**Check for Updates** — renderer → `updatesApi.check()` → `updates:check` IPC →
`electron/updates/update-service.ts#checkForUpdates()`:

1. `detectUpdateChannel()` from Electron runtime flags: `process.mas` → `mac-app-store`,
   `process.windowsStore` → `microsoft-store`, otherwise `direct`.
2. `providerFor(channel)` returns the `UpdateProvider` for that channel — **currently `null` for
   every channel**.
3. No provider → `{ status: 'unavailable', reason: 'no-provider', currentVersion, channel }`.
   With a provider (future) → its `up-to-date` / `update-available` result, or `failed` if it
   throws.

UI states (`AdvancedSettings.tsx`, inline `role="status"`, no popups):

| State | Shown when | Text |
|---|---|---|
| Checking | IPC in flight; button disabled + `aria-busy`, spinner, repeated clicks ignored | "Checking… / Checking for updates…" |
| Up to date | a provider reports `up-to-date` (no provider does yet) | "You're up to date. You're running the latest version." |
| Update available | a provider reports `update-available` (no provider does yet) | "Update available. A new version is available." |
| Failed | provider error, or the IPC call throws | "Couldn't check for updates. Please try again later." |
| Unavailable | no provider for this channel — **what every build gets today** | "Update check not available yet" + a channel-specific explanation |

## Store-managed update strategy

- **Mac App Store:** the App Store installs updates; macOS offers no public API for an app to ask
  whether its own Store update is pending. A MAS build shows the Store explanation; there is no
  provider to implement in-app beyond, at most, opening the Store page.
- **Microsoft Store:** an in-app check is possible with
  `Windows.Services.Store.StoreContext.GetAppAndOptionalStorePackageUpdatesAsync`, which needs a
  native WinRT bridge (not in the project). That would become the `microsoft-store`
  `UpdateProvider`.
- **Direct builds (current dmg / nsis / AppImage):** no updater is configured. Adding one
  (e.g. electron-updater) is a separate decision and must not ship inside Store builds.
- Packaging note: Store distribution also needs `mas` / `appx` targets and a real `appId` in
  `electron-builder.json5`; until then `process.mas` / `process.windowsStore` are false and every
  build reports the `direct` channel.

## Not implemented in this phase (on purpose)

- Custom updater / electron-updater / GitHub Releases updater.
- Downloading or installing .dmg / .exe / any installer, auto-download, auto-install.
- An update server or update feed URL.
- Any fake or version-comparison-based "update available" result.
- Opening the Store pages from Updates (the official URLs are not wired anywhere yet).

## Files

- Added: `electron/updates/update-service.ts`, `electron/ipc/updates.ipc.ts`,
  `src/bridge/updates.ts`, `src/screens/Settings/logic/updatesStore.ts`,
  `src/screens/Settings/components/advanced/{AdvancedSettings.tsx,index.ts}`.
- Changed: `electron/ipc/{api-types,channels,index}.ts`, `electron/preload.ts`,
  `src/bridge/index.ts`, `src/screens/Settings/SettingsScreen.tsx`,
  `src/screens/Settings/components/index.ts`.

## Verification

- Typecheck pass; ESLint on all touched files clean; `vite build` pass. No test runner in the repo.
- In-app browser, production build with a stubbed `window.api` (`getAppInfo` → `0.0.0`,
  `updates.check` delayed 600 ms):
  - Settings → Advanced shows "Updates", Current Version `0.0.0`.
  - Three rapid clicks → one check; during it: "Checking…", button disabled, `aria-busy`.
  - Result `unavailable` (direct) → "Update check not available yet" + direct note; channel
    `mac-app-store` → App Store note; IPC throwing → "Couldn't check for updates…".
  - Other sections unchanged (Appearance, Storage, Privacy, About, placeholders).
- `checkForUpdates()` in Main was not exercised inside packaged Electron.
