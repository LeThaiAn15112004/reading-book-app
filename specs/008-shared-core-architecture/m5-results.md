# M5 results (phone UI, Mobile Reader, Android build)

**Date**: 2026-11-05. Device checks (T064, T094–T096, T104, T017, T093, T074) have **not** run: the user could not
import a book on the phone at the time, so they were left for later at the user's request. Everything below was
checked on the Windows development machine only.

## T092: the Android build failure

`npm run build:web` then `./gradlew assembleDebug` in `android/` (the build step of `npx expo run:android`). Full logs
were kept outside the repo (session scratchpad). Three separate causes, in the order they appeared:

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | `:local-server:compileDebugKotlin` — `LoopbackServer.kt:87:92 Syntax error: Expecting '"'` (and lines 103, 109, 117) | Four **lone carriage returns** (`\r` not followed by `\n`) inside string literals, just before the escaped `\r\n` (`"Allow: GET⏎\r\n"`), most likely left by an editor on Windows; Kotlin treats a raw CR as a line break inside a one-line string. Two more in `LoopbackServerTest.kt` | Removed the lone CRs (CRLF line endings kept). The 13 Kotlin unit tests now compile and pass (`:local-server:testDebugUnitTest`, closes T054) |
| 2 | `react-native-worklets:buildCMakeDebug[armeabi-v7a]`, `react-native-screens`, `react-native-reanimated`: `ninja: error: manifest 'build.ninja' still dirty after 100 tries` | **Windows path length.** The SDK's CMake 3.22.1 ships **ninja 1.10.2**, which cannot open paths over 260 characters even with `LongPathsEnabled = 1` (support came in ninja 1.12). The prefab configs under `node_modules/<lib>/android/.cxx/Debug/<hash>/<abi>/../prefab/…` are 261–277 characters, so ninja reports them as missing (`ninja -d explain`: "…ReactAndroidConfigVersion.cmake of phony edge with no inputs doesn't exist", 261 chars; `react-native-workletsConfigVersion.cmake`, 277 chars), re-runs CMake, and gives up after 100 tries. Not a clock or timestamp problem (no file dated in the future) | Config plugin `plugins/with-short-native-build-dir.js` (in `app.json`): on Windows every native module's `externalNativeBuild.cmake.buildStagingDirectory` is `%LOCALAPPDATA%\rmcxx\<module>` (override: `READMATE_CXX_DIR`); a module another one evaluated early keeps its `.cxx` folder and is logged. Mapping the repo to a short drive with `subst` does **not** help: Expo autolinking resolves real paths on `C:` |
| 3 | `configureCMakeDebug[arm64-v8a]`: `…generate_cxx_metadata_*_timing.txt (The process cannot access the file because it is being used by another process)`; later `expo prebuild` failed with `EBUSY … android/.gradle/…lock` | **A second Gradle on the same project**: VS Code's Java extension (redhat.java + Gradle build server) imports `android/` and keeps its own Gradle 9.3.1 daemon on it. Earlier parallel runs of this session's builds also overlapped | Build with `--no-parallel`, and close VS Code's Gradle import of `source/apps/reading-book-mobile/android` while building (or set `java.import.gradle.enabled: false` for this workspace). Not killed by the agent |

Also: building four ABIs takes ~18 minutes on this machine; `-PreactNativeArchitectures=arm64-v8a,x86_64` covers a
phone and an x86_64 emulator.

**Build result with the three fixes**: see "T092 status" at the end of this file.

## T101–T103: the Mobile Reader

Built before the device checks at the user's request. Layout and behaviour: `contracts/phone-ui.md`, "As built
(T101–T103)". Checks run:

| Check | Result |
|---|---|
| Desktop `typecheck`, `lint` | Pass |
| Mobile `typecheck`, `typecheck:web` (compiles Desktop `src/` incl. the Mobile Reader), `lint`, `npm test` | Pass; 111 tests |
| R10 — Desktop `npx vite build` before / after | Before: 28 assets. After: one new chunk `MobileReaderScreen-*.js` (25,170 bytes); `index-*.js` 2,227,209 → 2,227,711 bytes (+502: the lazy loader and the `isMobileHost` branch); the other chunk sizes are unchanged (hashes changed). The Mobile Reader code is only in its own chunk |
| R8 — no Desktop-only UI pulled in | The Mobile Reader imports `ReaderOpenStatus`, `ReaderZoomViewport`, `AaSettingsPanel` by file (not the `components` barrel), and no `useReaderChromeUi` |
| Mobile-only stores | None (sheet, bars, toast and the Markdown selection are component state) |
| On a device | **Not run** (T094, T095, T104) |

## T078: Desktop unchanged

`node scripts/check-desktop-baseline.mjs` (2026-11-05, after all of the above): **All 25 passed** — SDK typecheck,
test typecheck, tests (1016; baseline 998), build; Desktop typecheck, lint, `e2e:typecheck`, `vite build`;
`electron/` unchanged since `8130c17`; 30 migrations; the pre-change library copy matches on every count and hash
(books, positions, bookmarks, annotations by type, audio notes, collections, TXT documents). `npm run dev:desktop`
was **not** started by the agent (it opens a window); Desktop E2E needs the user's answer (R7).

## T080: SC-005, SC-009

- `npm run check:boundaries`: 6 of 6 checks, 42 tests pass.
- `window.api` outside `reading-book-desktop/src/bridge/`: 0 files.
- Desktop `src/` or SDK `src/` files copied into Mobile (byte-identical, > 200 bytes): 0.
- Open Decisions: a Status column in `spec.md`; every one has a milestone; OD-10 (final) and OD-11 stay open, both
  saying what they block.

## T081: where M0–M5 stand

| Milestone | State |
|---|---|
| M0 baseline | Done; still green (above) |
| M1 workspace | Done |
| M2 feasibility | Provisional on Expo Go (`m2-results.md`); the Android-build part waits for T093 |
| M3 contracts | Done (fixtures in `book-reader-sdk/tests/contracts/`, both apps conform) |
| M4 bridge + host | Done in code and tests; the bridge-call log run (T064) needs the phone |
| M5 phone UI | Code done (T065–T073, T097–T103); device checks and the journey (T094–T096, T104, T074) not run; Android build: see below |
| M6 iOS | Not started; **required before the first release is complete** (`ios-readiness.md` lists what is unproven) |

## T092 status

**Not finished: no APK yet.** After the fixes above, the last run (`assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64
--no-parallel --max-workers=2`) compiled every Kotlin / Java module and stopped at `:app:mergeExtDexDebug` with
"Gradle build daemon disappeared unexpectedly": the JVM ran **out of native memory** (`hs_err_pid*.log`: "mmap failed
to map 307232768 bytes", machine 16 GB). At the time VS Code's Java extension held four more Gradle daemons and its
language server (0.1–2.4 GB each). The CMake step had not started yet, so fix 2 (short `.cxx` folders) is **not yet
proven** by a build; fixes 1 and 3 are.

To finish T092 (user, then agent): close VS Code (or disable its Gradle import for this workspace) and other large
apps, then in `source/apps/reading-book-mobile/android`:
`./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64 --no-parallel`. Expected: `%LOCALAPPDATA%\rmcxx\<module>`
folders appear and `app/build/outputs/apk/debug/app-debug.apk` is written. If ninja still reports
"still dirty", the remaining fallback is a newer CMake (3.31+, ninja ≥ 1.12) through `cmake.dir` in
`android/local.properties`, or a shorter checkout path.

T017, T093 and T074 run on that APK and need a device or emulator.

## Import on the phone: "Could not read the selected file." (2026-11-05)

Reported by the user on BlueStacks 5.22, Expo Go. `files.stage` answered `READ_FAILED`: the picker
(`copyToCacheDirectory: true`) copies the document to `context.cacheDir/DocumentPicker/`, which in Expo Go is outside
the project's scoped folders, and `expo-file-system` refuses `File.open()` there (`checkPermissionForPath` →
`InvalidPermissionException`). Content URIs skip that check. **Fix**: on Android the picker no longer copies, and the
host reads the `content://` document (ACTION_OPEN_DOCUMENT → SAF, which `File.open('r')` supports) once, during
`files.stage`; `discardUri` never deletes a `content://` URI. iOS keeps the cache copy. `READ_FAILED` now carries the
underlying error text, and the bridge logs it (`[bridge] import: copying the picked file failed`). **Not yet confirmed
on the device**: the cause is read from the Expo 57 sources, not from a log.
