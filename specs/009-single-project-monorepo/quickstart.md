# Quickstart: One Project for Desktop and Mobile

Validation guide for spec 009. Commands are in [contracts/root-commands.md](./contracts/root-commands.md).

## Baseline (before Phase 1; filled in step 1.1)

| Measure | Value |
|---|---|
| Install folders and sizes | root 11 MB, `source/` 950 MB, Desktop 480 MB, Mobile 1.6 GB (incl. Android native build output), SDK 0 — ~3.0 GB (2026-11-05) |
| Size without native build output | (1.1) |
| `npm ls react` | (1.1) |
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

(filled in at step 4.5)
