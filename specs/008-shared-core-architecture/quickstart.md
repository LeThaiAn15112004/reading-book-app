# Quickstart: Validating Readmate Mobile

The scripts named here (`build:web`, `check:boundaries`, Mobile `test`) do not exist yet; tasks create them. Paths are relative to `source/`.

## Prerequisites

- Node 22, and `npm ci` in `source/`.
- Daily development: Expo Go for SDK 57 on a phone on the same Wi-Fi as the computer (section 2a).
- Real app (deferred, FR-017l): Android SDK and an emulator or device, for a native Android build.
- iOS (M6, separate task): the environment from OD-11; iOS 18.2 or newer.
- WebKit early check (M2): Playwright WebKit against the Mobile web build, with a fake host. A pass does not prove iOS works.
- iOS readiness on Windows: `npx expo config --type public` in `apps/reading-book-mobile` shows the bundle identifier and `ios.deploymentTarget` 18.2.
- Test books: small and 100 MB EPUB and PDF; TXT; Markdown; one PDF with annotations from another reader; one duplicate file.

## 1. Desktop is unaffected (every milestone)

```bash
npm run typecheck -w @reading-book/book-reader-sdk
npm test -w @reading-book/book-reader-sdk
cd apps/reading-book-desktop && npm run typecheck && npm run lint && npx vite build
```

**Expected**: same results as the recorded baseline (SC-001). Then, from the repo root, `npm run dev:desktop` starts, and a library made before this work shows all its data with no new migration (SC-002).

## 2. Workspace (M1)

Run `npm ci` in `source/`, then `npm ls react -w reading-book-mobile`.

**Expected**: one lockfile in `source/`; every nested package is in the exception list; each runtime loads one React (SC-011).

## 2a. Expo Go (M2, then every day)

```bash
cd apps/reading-book-mobile
npm run build:web      # first time, and after UI changes
npx expo start         # scan the QR code with Expo Go
```

**Expected**: Metro starts with no error; `http://localhost:8081/readmate-ui/index.html` answers on the computer; the Readmate UI appears in the WebView on the phone. Keep the Wi-Fi on, since the UI comes from the computer. Without `web/dist`, the page says to run `npm run build:web`.

## 3. WebView feasibility (M2)

**Provisional pass in Expo Go (FR-017m)**: render and page turns for all 4 formats, workers, text selection, SQLite. Use `npm run build:web:feasibility`. Results go in `m2-results.md`.

**On the deferred Android build only, recorded as unverified until then**: everything below that mentions networking off, 100 MB files or a restart, plus the `file://` check. Build the web UI and a native Android build, then turn networking off.

| Check | Expected |
|---|---|
| App starts | Library appears; no remote request |
| EPUB and PDF, small | Render; turning pages works; workers run |
| 100 MB EPUB and PDF | Opens without a WebView crash; memory recorded |
| Select text | Selection and app toolbar both usable |
| `SELECT sqlite_version()`, JSON function | Recorded |
| Restart app | `localStorage` values kept |

**Record** the serving route, Android minimum, size limit and fonts decision. If a format fails, stop and report.

## 4. Automated checks (M3, M4)

```bash
npm run check:boundaries
npm test -w reading-book-mobile
```

**Expected**: every probe in the audit table fails the check (SC-003); fixtures pass on both stores with no Desktop change (SC-006); `tsc` confirms the bridge satisfies `DesktopApi`.

## 5. First-release journey (M5 on Android, M6 on iOS)

During development, this can be tried in Expo Go with books up to 20 MB, but that does not count towards SC-004. It counts only on a native build.

With networking off, for each of EPUB, PDF, TXT and Markdown:

1. Import from the device. **Expected**: progress, then the book in Library.
2. Import the same file again. **Expected**: reported as duplicate, with no second copy.
3. Delete the original from the device, then open the book. **Expected**: it opens.
4. Read, and move to another position.
5. Add a highlight, a note and a bookmark.
6. Force-quit, then reopen. **Expected**: position and annotations intact (SC-010).
7. Compare the app's copy hash with the imported hash. **Expected**: identical.
8. Remove the book. **Expected**: gone from Library, app copy deleted, other device files untouched.

Also check:

- Cancel an import, and fill storage during one: no partial book, clear message.
- Excluded features do not appear; a log shows no `NOT_AVAILABLE_ON_PLATFORM` during the journey.
- Rotate the phone, and use Android back.
- Kill the WebView process on Android (or force it through memory load): the app reloads and data is intact.
- Open a TXT file: read-only, annotations work.
- Open a PDF with others' annotations: displays, and the file is unchanged.

**Expected overall**: SC-004 passes on the platform.
