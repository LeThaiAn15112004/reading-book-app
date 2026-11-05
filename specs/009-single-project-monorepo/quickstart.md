# Quickstart: One Project for Desktop and Mobile

Validation guide for spec 009. Commands are in [contracts/root-commands.md](./contracts/root-commands.md).

## Baseline (before Phase 1; recorded 2026-11-05, T001)

| Measure | Value |
|---|---|
| Install folders (all content) | root 10,978 KB; `source/` 972,375 KB; Desktop 490,540 KB; Mobile 1,616,783 KB; SDK 8 KB: **~3.09 GB** |
| Same, without `*/android/.cxx` and `*/android/build` | root 10,978; `source/` 972,375; Desktop 490,540; Mobile 408,707 KB: **1,882,600 KB (~1.80 GiB)** — SC-004 target ≤ 1,411,950 KB measured the same way |
| `npm ls` (depth 0) | Desktop: react / react-dom 18.3.1, typescript 5.9.3, eslint 8.57.1. Mobile: react / react-dom 19.2.3, typescript 6.0.3, eslint 9.39.5. SDK: typescript 5.9.3 |
| Desktop `vite build` assets (hashes removed) | `__vite-browser-external.js comic-book.js cursor-editorTextHighlight.svg epub.js fb2.js fflate.js fixed-layout.js hidden-epub-pagination.js index.css index.js mobi.js MobileReaderScreen.js` 9 Noto fonts `paginator.js pdf.worker.min.mjs rolldown-runtime.js search.js tts.js view.js zip.js` |
| Desktop migrations | 30 files; SHA-256 (CRLF → LF) in `source/scripts/desktop-migrations.sha256.json`, checked by `check-desktop-baseline` "migrations byte-identical" (T002) |
| Desktop baseline | 25/25 (2026-11-05) |
| `check:boundaries` | 6/6, 42 tests |
| Core tests / Mobile tests | 1016 / 111 |

## 1. Fresh clone, Desktop (SC-001)

```text
git clone … && cd reading-book-app
npm install
npm run dev
```

**Expected**: the Desktop window opens with the Library; no Expo / Metro process starts.

## 2. Same clone, Mobile (SC-001, SC-007)

```text
npx expo start            # or: npm run dev:mobile
```

**Expected**: QR code; Expo Go opens the Readmate Library; import an EPUB, open it, add a highlight, reopen.

## 3. One install (SC-002, SC-004)

```text
find . -name node_modules -prune -not -path "./node_modules/*" -print     # → ./node_modules only
find . -name package-lock.json -not -path "*/node_modules/*"              # → ./package-lock.json only
find . -name package.json -not -path "*/node_modules/*" -not -path "./android/*" -not -path "./ios/*"   # → ./package.json only
du -sh node_modules        # excluding **/android/.cxx and **/android/build
```

**Expected**: one of each; size ≤ 75 % of the baseline measured the same way.

## 4. Checks (SC-005, SC-006)

```text
npm run check
npm run check:desktop-baseline
```

**Expected**: all green; Desktop baseline 25/25 with the pre-change library; boundaries negative tests fail as designed.

## 5. Packaging and Android

```text
npm run package           # Windows installer + check:desktop-package
npm run android           # or: cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a,x86_64 --no-parallel
```

**Expected**: installer starts and reads an existing library; the asar has no `react-native` / `expo`; the APK installs
and opens the Library.

## 6. Desktop E2E (only with the user's agreement)

```text
npm run e2e
```

**Expected**: same pass / fail set as before the move (failures known before spec 009 listed in spec 008 tasks).

## Results

### After Phase 2 (T003–T012, 2026-11-05)

| Measure | Value |
|---|---|
| Install folders | `./node_modules` only (+ 6 files VS Code holds under the old Mobile folder, see T010) |
| Lock files | `./package-lock.json` only |
| Manifests | root + 4 without dependencies (Desktop, Mobile, SDK, config; plan "Kept manifests", removed in US4 except where a tool needs one) |
| `npm ls react typescript eslint` | react / react-dom 19.2.3, typescript 6.0.3, eslint 9.39.5, each once |
| Size without native build output | **1,873,973 KB** vs baseline 1,882,600 KB (−0.5 %). The duplicates were small; most of the size is packages only one host uses. SC-004 (≤ 1,411,950 KB) is **not met** yet: T021 lists the largest packages |
| `npm run check` | pass |
| Desktop baseline | 26/26 (the Main check now accepts the listed changes) |
| Desktop E2E (React 19, hidden, 84 tests) | **72 passed / 4 failed / 8 skipped** (pre-009: 67–71 passed). 3 failures known before spec 009 (`epub-toc-regression` E2E 7, `md-reader` E, `pdf-annotations` "EPUB highlights …"); `pdf-typewriter` passes alone (2/2). No failure from React 19 / TS 6 |

### After US1 + US2 (T013–T018, 2026-11-05)

| Check | Result |
|---|---|
| `npm run dev` (root, hidden window) | Desktop only: renderer `200`, Electron running, no Metro (SC-001 Desktop) |
| `npx expo start` / `npm run dev:mobile` (root) | Metro ready in 69 s incl. the WebView build; `/readmate-ui/index.html` `200`; Android bundle 1,384 modules |
| `npx expo prebuild -p android` (root) | `./android` written; plugins applied; `local-server` autolinked |
| Expo Go on a device | **User, 2026-11-05: import works** (SC-007) |
| `npm run check` | pass |
