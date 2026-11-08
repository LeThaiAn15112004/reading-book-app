# Contract: behaviour of the app inside the Store package

All branches test `process.windowsStore === true` (set by Electron for a packaged app). The direct build never takes
them; its behaviour is unchanged.

## main.ts start order (Store build)

1. `app.setPath('userData', path.join(app.getPath('appData'), 'Readmate Reader Store'))` — first statement that runs.
2. Skip `setAsDefaultProtocolClient` (the package declares `readmate-reader`).
3. `requestSingleInstanceLock()` (now bound to the Store `userData`).
4. `whenReady`: skip `setAppUserModelId`; run the store import (store-import contract) before `openDatabase()` and
   before the first `BrowserWindow`.

## Manifest extensions (`source/app/platforms/electron/store/appx-extensions.xml`)

```xml
<desktop:Extension Category="windows.startupTask" Executable="app\Readmate Reader.exe"
                   EntryPoint="Windows.FullTrustApplication" uap10:Parameters="--hidden-at-startup">
  <desktop:StartupTask TaskId="ReadmateReaderStartup" Enabled="false" DisplayName="Readmate Reader" />
</desktop:Extension>
```

(`uap10` declared and listed in `IgnorableNamespaces` through `customManifestPath` if electron-builder's template
does not declare it; the protocol extension stays generated from `protocols`.)

## Start at Login (`background/store-startup-task.ts`)

- `getStartAtLogin()` / `setStartAtLogin(enabled)` keep their IPC channels and return `StartAtLoginDto` with `state`
  (data-model §7).
- Implementation: spawn `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>` with an
  argv array, `<script>` = `{process.resourcesPath}/store/startup-task.ps1` (checked-in, shipped as a real file through
  `extraResources` of the Store config — PowerShell cannot read inside `app.asar`), args `get` | `enable` | `disable`; it
  prints one JSON line `{ "state": "<StartupTaskState>" }`. Timeout 10 s → `state: 'managedByWindows'`.
- `enable` maps to `RequestEnableAsync()`; `DisabledByUser` / `DisabledByPolicy` are reported, never overridden.
- UI (Settings → Background): `canChange` false → toggle disabled, text "Turned off in Windows Settings → Startup" (or
  "Managed by Windows"), button **Open Startup settings** → Main `shell.openExternal('ms-settings:startupapps')`
  (new channel `BackgroundChannels.openStartupSettings`, Store build only).
- Launched by the task: `--hidden-at-startup` in `process.argv` → same hidden start as today.

## Paths given to other apps (`files/external-path.ts`)

`pathForOtherApps(p)`: Store build and `p` inside `userData` → `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\Readmate Reader Store\<relative>`;
otherwise `p`. PFN = `<Name>_<PublisherId>` parsed from the folder of `process.execPath`
(`…\WindowsApps\<Name>_<Version>_<Arch>__<PublisherId>\app\…`); unparsable → `p` unchanged + one warning in the log.
Every `shell.openPath`, `shell.showItemInFolder` and `shell.openExternal('file:…')` on an app-owned path goes through
it; `check-external-paths.mjs` (in `npm run check`) fails on a call in `platforms/electron/**` that does not.

## Updates

No change: channel `microsoft-store`, Settings text already says the Store delivers updates; no other update route
exists.
