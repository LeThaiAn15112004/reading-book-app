# Decision: Local file server for the WebView

**Date**: 2026-11-01 | **Status**: Accepted, not tested on a device | **Needed for**: OD-10, FR-014; tasks T018, T054

## Need

The WebView needs a stable origin for `localStorage`, module scripts and the PDF.js worker, and later a way to read book files without passing bytes through `postMessage` (research R2). The WebView reference documents no custom scheme handler.

## Alternatives

| Option | Pros | Cons |
|---|---|---|
| `file://` only (T017) | No native code | Widens file access; module scripts and workers unproven; the build still needs `android_asset` and has no token or Range. Result pending on a device (`m2-results.md`) |
| `@dr.pogodin/react-native-static-server` 0.28.1 | Maintained (registry: Oct 2026); loopback by default; fixed port; iOS | Its README says building for Android on a Windows host is unsupported, which is this project's M0 to M5 machine; Expo is "said to work" only; token and Range are not documented; needs CMake and `react-native-fs` |
| `react-native-web-server` 0.1.14 | Small | Abandoned: registry last changed 2022, peer dependency React Native ^0.59 |
| `react-native-static-server` 0.5.0 | | Abandoned: registry last changed 2022 |
| **Small in-repo Expo module** (`modules/local-server`) | No new dependency; full control of Host check, Range and later the token; no CMake | We own about 300 lines per platform, including security-sensitive parsing; Swift cannot be compiled on Windows |

## Compatibility

| Item | Finding | Source or test |
|---|---|---|
| Expo SDK and React Native version | Uses the Expo Modules API of SDK 57; autolinking finds it for Android and iOS | `expo-modules-autolinking resolve` |
| Android | See `m2-results.md` for what compiled and ran on this machine | **Not tested on a device** |
| iOS 18.2+ | `NWListener` with a required local endpoint; `NSAllowsLocalNetworking` in `app.json` | **Not compiled, not tested** (M6) |
| Apple-silicon build | Plain Swift, no binary dependency | **Not tested** (M6) |
| Expo Go or development build | Native build only: Expo Go cannot carry this module. Since 2026-11-02, development uses Expo Go without it (research R11, R12); the real app still uses it (FR-017l) | Expo docs |

## Licence and maintenance

Project code, no third-party licence. Maintained here. Its only runtime dependencies are the Android and Apple SDKs.

## Decision and trade-offs

Use the in-repo module, on fixed port `47821`, bound to `127.0.0.1`.

- **Now**: serves the bundled UI, GET only, single `Range` (`206`, `416`), path traversal refused, `Host` must equal `127.0.0.1:47821` (blocks DNS rebinding).
- **T054 adds**: `/books/{id}` and `/covers/{id}` with a per-launch token. The criteria are met by design, since we own the request handling; they are not built yet.
- **UI files** ship inside the module: `npm run build:web` writes `modules/local-server/ui-assets/web-ui` (git-ignored), which Android includes as assets and iOS as a folder resource. So `build:web` must run before a native build.
- **Port taken**: `start` rejects with `PORT_IN_USE` and the host shows the error. There is no fallback port, because a new origin would lose `localStorage`.

Revisit if device testing shows streaming or concurrency problems, or if the Swift side proves costly at M6.
