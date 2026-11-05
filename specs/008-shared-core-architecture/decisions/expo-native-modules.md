# Decision: WebView, SQLite, file system and document picker modules

**Date**: 2026-10-31 | **Status**: Accepted, not tested on a device | **Needed for**: FR-014, FR-017b, FR-017g; tasks T009, T052

Versions are the ones Expo 57 pins in `expo/bundledNativeModules.json`: `react-native-webview` 13.16.1; `expo-sqlite`, `expo-file-system` and `expo-document-picker` ~57.0.0. Newer registry versions (14.x, 58.x) are not used, since they do not target this SDK.

## Need

| Module | Need |
|---|---|
| `react-native-webview` | Runs the React UI inside the host |
| `expo-sqlite` | Database behind the bridge |
| `expo-file-system` | App-private copies of books and covers |
| `expo-document-picker` | Picks books from the device |

## Alternatives

| Option | Why not |
|---|---|
| A native reader instead of a WebView | Rejected by the agreed direction |
| SQLite inside the WebView (WebAssembly) | Storage durability depends on browser data; Expo's prebuilt web build has no FTS |
| `react-native-fs`, `react-native-document-picker` | Outside Expo's pinned set; no need shown that the Expo modules cannot meet |
| IndexedDB | Different from Desktop's data contract; no SQL or transactions matching Desktop's stores |

## Compatibility

| Item | Finding | Source or test |
|---|---|---|
| Expo 57, React Native 0.86 | Pinned for this SDK | `bundledNativeModules.json` |
| Android and iOS | WebView supports both; Expo's SQLite documents exclusive transactions on Android and iOS | [Expo WebView](https://docs.expo.dev/versions/v57.0.0/sdk/webview/), [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) |
| iOS 18.2+ | Expected, as the deployment target is above Expo's floor | **Not tested** |
| Apple-silicon build | Expected for Expo-maintained modules | **Not tested** (M6) |
| Development build | WebView works in Expo Go; a development build is still used, because of the expected local server | Expo docs |
| JSON functions in SQLite | Not stated in the docs | **Not tested**: T023 |

## Licence and maintenance

All four are MIT according to the npm registry. The three `expo-*` modules are maintained in the Expo repository. `react-native-webview` is maintained by its community organisation; the registry shows activity in 2026.

## Decision and trade-offs

Use all four at Expo's pinned versions. Expo upgrades then move them together. The cost is being limited to their APIs; if chunked hashing proves too slow (T052), a small native addition gets its own record.
