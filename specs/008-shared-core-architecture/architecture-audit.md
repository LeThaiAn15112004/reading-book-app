# Architecture Audit: Shared Core for Desktop and Mobile

**Date**: 2026-10-31 · **Commit audited**: `8130c17` on `anle-dev` (clean tree) · **Companion to**: [spec.md](./spec.md)

No application source was changed. Probes ran from the scratchpad. "Verified" below means the code or a command was checked. It does not mean the documentation says so.

Paths are relative to `source/` unless they start with `docs/`, `specs/` or `.github/`.

## 1. Baseline commands

| Check | Result |
|---|---|
| SDK `npm run typecheck`, `typecheck:tests` | Pass |
| SDK `npm test` | **2 of 998 tests FAIL** (2 of 63 files): `tests/config/audiobook-zip-gate.test.ts` and `audiobook-transcription-gate.test.ts` |
| Desktop `npm run typecheck`, `npm run lint` | Pass |
| Mobile `npx tsc --noEmit` | No errors, but this proves little: the mobile source imports nothing from the SDK or config |

**Why the 2 tests fail**: `packages/config/features.ts` is committed with `audiobookZipImportEnabled: true` and `audiobookTranscriptionEnabled: true`. Its own comment says "LOCAL ONLY — the committed value must stay false". The gate tests check the committed content, so the same two tests should fail in CI at this commit. CI itself was not inspected. CLAUDE.md also describes both flags as default-off, which does not match the code.

## 2. Workspace and dependency graph

```
reading-book-desktop ──(tsconfig + vite alias, SDK SOURCE)──▶ book-reader-sdk/src
        │                                                     book-reader-sdk/host-adapters
        └──(alias)──▶ packages/config ──(npm dep)──▶ book-reader-sdk

reading-book-mobile  ──(tsconfig path only, unused)─ ─ ─ ─▶ book-reader-sdk/src
```

| Finding | Evidence |
|---|---|
| One npm workspace with 3 apps and 1 package; the structure is enough | `package.json` workspaces `apps/*`, `packages/*` |
| No workspace declares its dependency on the SDK or config, except config → SDK | `apps/*/package.json`; resolution relies on aliases and hoisting |
| The SDK imports `zustand/vanilla` but lists it only as a devDependency. That is fine for the inlined `dist/`, while source consumers rely on hoisting | `book-reader-sdk/src/stores/*`, `package.json` |
| Mobile keeps its own lockfile and `node_modules` (React Native is not hoisted to the root) | `apps/reading-book-mobile/package-lock.json`; `node_modules/react-native` exists only under mobile |
| React versions differ: desktop root 18.3.1, mobile 19.2.3. TypeScript also differs: `^5` vs `~6.0.3` | manifests; `node_modules/react/package.json` |
| Local leftovers: dangling `node_modules/@reading-book/{domain,shared}` links | `ls source/node_modules/@reading-book` |
| CI covers the SDK (typecheck, test typecheck, tests, build) and desktop (typecheck, lint). It covers nothing for mobile or `packages/config` | `.github/workflows/ci.yml` |

## 3. Platform independence of `book-reader-sdk/src`

**Strengths (verified)**

- The only bare import in `src/` is `zustand/vanilla`, in 4 places.
- No `window`, `document` DOM, `Buffer`, `process` or `fs` use compiled in. Optional host globals go through one cast in `core/platform-globals.ts`.
- The build fails if `dist/` has any bare import (`scripts/build.mjs`).
- `crypto.subtle` absence is already expected: `ports/index.ts` says a `HashAdapter` is required on React Native. Sentence splitting has a regex fallback for missing `Intl.Segmenter`, and `attachment-policy.ts` avoids `TextDecoder`.
- `hermesc` from the mobile app's `hermes-compiler` compiled `dist/index.cjs` to bytecode with no errors. This shows syntax and literal-regex compatibility only. **The code was not executed on Hermes.**

**Compile-time boundary: the documented guarantee is only partly true**

CLAUDE.md says that importing `electron`, `better-sqlite3`, React or format engines from SDK source is a compile error. A virtual file at `book-reader-sdk/src/` was type-checked with the SDK's own `tsconfig.json`:

| Import from SDK `src/` | Result | Reason |
|---|---|---|
| `window`, `Buffer`, `node:fs` | Blocked | `lib` / `types: []`: a real guarantee |
| `electron`, `pdfjs-dist`, `react-native` | Blocked | **Accident of install layout**: not resolvable from the SDK folder today |
| `react-dom` | Blocked | Accident: no type declarations resolved |
| **`better-sqlite3`, `react`, `epubjs`** | **Compiles** | Resolved through hoisted types |
| **`@reading-book/config`** | **Compiles** | Would create a package cycle (config already depends on the SDK) |
| **`../../reading-book-desktop/electron/ipc/channels`** | **Compiles** | Nothing stops the SDK importing an app |

`dist/` self-containment does not catch these either, because rolldown inlines what it can resolve. There are no ESLint boundary rules: desktop's `.eslintrc.cjs` has none, and the SDK has no ESLint at all.

**Possible runtime risks on Hermes (not executed)**

- `audio/audio-zip-import.ts:128` runs `new Intl.Collator('en', { numeric: true, … })` at **module load**, and it is in the bundle. If `Intl.Collator` were missing or limited, the failure would be at load or in natural ordering.
- `search/text-search.ts` builds `\p{…}` regexes from strings at run time, so `hermesc` cannot check them. `md/md-policy.ts` uses `\p{Script=Latin}` and `normalize('NFD')`.
- Public sources found in this audit did not confirm Hermes support for these features. A comment in `services/translation/translation-text.ts:79` says `Intl.Segmenter` is missing on Hermes, which is also unconfirmed.

## 4. How Desktop actually uses the SDK

Desktop imports the SDK from 130 renderer files and 71 Main files, so the SDK is genuinely shared code. It uses it as a **library of models and pure functions**, not as an application layer.

Named imports from the package root matched against SDK exports (a name-based count, so approximate):

| SDK area | Exports | Used by Desktop | Note |
|---|---:|---:|---|
| `app-models` | 208 | 132 | Real sharing |
| `audio` | 117 | 81 | Real sharing |
| `txt`, `md`, `ink`, `typewriter` | 238 | 139 | Real sharing |
| `transcription`, `attachments`, `annotation-transfer` | 105 | 60 | Real sharing |
| `domain` | 72 | 35 | Real sharing |
| `persistence` | 18 | 11 | Partial: see §6 |
| `cfi` / `pagination` / `viewport` | 63 | 9 | Mostly unused by name |
| **`stores`** | **18** | **0** | Not used |
| **`epub`** | **21** | **0** | Not used; see below |
| **`testing`** | 4 | 0 | Expected |
| **`core`** | 34 | 2 | `createBookReaderSdk` not used |
| **`ports`** | 25 | 5 | Host I/O ports mostly not used |

**The main finding: two parallel application layers exist.**

1. **SDK**: `createBookReaderSdk`, `services/{library,annotation,session}-service`, `stores/*`, `services/{import-book,open-reader,save-reading-session-state,create-collection,manage-collection-books}`. These run only in SDK tests (`tests/integration/reader-flow.test.ts`); grep finds no use in Desktop's `src/`, `electron/` or `spikes/`.
2. **Desktop**: the real behaviour lives in `electron/**` (handlers plus `sqlite-*-store.ts`) and in renderer zustand stores. The 25 largest of these total about 8,700 lines, for example `audioPlayerStore.ts` 972, `pdfHighlightsStore.ts` 778, `txtDocumentStore.ts` 562, `highlightsStore.ts` 553.

The SDK README's "Electron" table and "Lộ trình áp dụng" describe an adoption that never happened. It also lists `storage.library / annotations / bookmarks / sessions`, while the code has `StorageAdapter { library, overlays }`.

**Other duplication**

- `electron/adapters/epub.adapter.ts` parses EPUB with JSZip and `fast-xml-parser`, while the SDK's `epub/` parser is unused by Desktop. They look like parallel implementations; whether their results match needs a comparison.
- `reading-book-mobile/src/services/oauth/redirect-uri.ts` hand-copies `OAUTH_CALLBACK_PATH` from `packages/config/oauth-redirect.ts`.

## 5. Ports against the requested list

| Requested | What exists | Verified status |
|---|---|---|
| LibraryStore | `domain-ports/library-store.ts` (7 methods) | `SqliteLibraryStore implements` it, but the Desktop store's real surface is much wider (for example `createCollection`, reached by direct call from `library.ipc.ts`) |
| Collection store | `domain-ports/collection-store.ts` | CLAUDE.md says implemented. The `implements` clause names only `LibraryStore`, and Desktop does not import `CollectionStore` by name |
| AnnotationStore, ReadingStateStore | **No such ports.** `OverlayStore` covers both | `SqliteOverlayStore implements` it. Do not add duplicates. Its contract omits ink, audio progress and Notes, TXT commit and transcript operations, which live on separate Desktop stores with no ports |
| FileAccess | `ports/file-system.ts` `FileSystemAdapter` (`FileRef` already allows `content://`) | No Desktop implementation. Whole-file `readBytes` only, no streaming or partial read. `copyToSandbox` conflicts with Desktop's reference-in-place import for local files |
| DocumentImport | `domain-ports/document-importer.ts` | Implemented by Desktop adapters. It takes a `path` and describes a post-copy sandbox path, which is stale against reference-based import |
| Document rendering | `domain-ports/document-renderer.ts`; `ports/reader-surface.ts` | No implementation or Desktop consumer of either was found by name. `ReaderSurface` is the one designed for a WebView bridge |
| Location codec | `domain-ports/location-codec.ts` | Implemented by `CfiCodec`. Its input and output are `unknown`, so little is enforced |
| SQL driver | `persistence/sql-notes.ts` `SqlDatabase` (async `run`, `all`) | Desktop does not use it. No transaction member, and see §6 |
| TTS, translation, archive, hash, clock, IDs | `ports/*` | Host-injected; only `TtsEngine` and translation parts are used by Desktop |
| AI | `NoOpAiProvider` | Stub only, out of scope |

## 6. Data and persistence

- **Schema owner**: 30 numbered files in `reading-book-desktop/electron/persistence/migrations/`, imported through Vite `?raw` in `migrate.ts`. Mobile cannot use them as they stand.
- **SQLite features that any Mobile driver must support**: FTS5 with `unicode61 remove_diacritics 2` and external-content triggers (021, 029); JSON functions in `CHECK` constraints, data migrations and an expression index; `PRAGMA foreign_keys` toggled around each migration; WAL (`db.ts`).
- **Synchronous transaction reliance**: annotation import uses one synchronous `BEGIN IMMEDIATE … COMMIT` with no `await` inside, because the connection is shared. The Expo SQLite API is asynchronous-first in common use, so atomicity cannot just be copied across. Needs investigation.
- **`persistence/sql-notes.ts` does NOT match Desktop data, despite its comment.**
  - It reads and writes a `reading_sessions` table that no migration creates; Desktop stores this in `books.reading_state_json`.
  - Its highlight reader requires `group === 'annotation'` plus `styleKind` and `colorHex`. Desktop's reader accepts absent `group`, and uses `type` with a list of 13 kinds. Rows could be dropped silently.
  - CLAUDE.md already says this layout is "not compatible yet".
  - **It must not become Mobile's persistence as it stands.**
- **Device-bound columns**: `books.file_path`, `normalized_path` and `cover_path` hold host paths. Portable identity: `books.sha256` (unique).
- **Positions**: PDF rects are normalized 0–1 with page index, and TXT offsets are UTF-16 indices, which are portable by design. EPUB CFIs are a standard form, but matching across engines is unproven. Audio is seconds. None of this has been tested on another renderer.
- **Existing portable format**: `.readmate-notes.json` (spec 006). Its pure logic is in SDK `annotation-transfer/`, identifies books by `sha256`, and removes duplicates by content key. It already allows moving annotations by hand without a backend.
- **App preferences**: renderer `localStorage` in 21 files, plus Main-owned JSON. Both are per platform. SDS still says `electron-store`.

## 7. Desktop coupling

- **Strong boundary, verified**: `window.api` appears only in `src/bridge/*` (20 files). Renderer stores reach Main through that bridge.
- **Electron and Node are contained**: 41 files in `electron/` import `electron`, and 72 import Node modules. They are expected to stay there.
- **Renderer logic is not portable as it stands**: 34 of 122 files in `screens/*/logic` and `hooks` use `window`, `document` or `localStorage`, and sampled stores import the bridge directly and often React. Rules worth sharing are mixed with state. `audioPlayerStore.ts` is built on the DOM `Audio` element.
- **Engines**: `epubjs` is the production EPUB engine (`foliate-js` appears only under `src/spikes`). `pdfjs-dist` is in the renderer and the Main scan worker.

## 8. Host adapters

`book-reader-sdk/host-adapters/` is outside the SDK's `tsconfig` `include`, so it is checked only through Desktop's imports. Its cloud services use `window`, `Buffer` or Node APIs in at least 8 files, and translation uses `@huggingface/transformers`. **It is Desktop infrastructure located inside the SDK folder and cannot be assumed to work on Mobile.** The dist build does not include it.

## 9. Mobile scaffold

| Finding | Evidence |
|---|---|
| It is the Expo template with 21 source files; the only project-specific file is `services/oauth/redirect-uri.ts` | `src/` |
| SDK path exists in `tsconfig.json`, but nothing imports it, and there is no config path | `tsconfig.json`, grep |
| Metro watches only `source/packages`, **not** `apps/book-reader-sdk` | `metro.config.js` |
| Babel aliases the removed `@reading-book/shared`, which no longer exists | `babel.config.js` |
| No SQLite, file-system, picker, WebView, crypto or audio module is installed | `package.json`; `expo-sqlite` absent |
| Ships `react-native-web` and a web target, not requested for this architecture | `package.json`, `app.json` |
| `AGENTS.md`: Expo v57 changed; read the versioned docs before writing code | `apps/reading-book-mobile/AGENTS.md` |

**Not determined**: whether Metro can bundle the SDK. Three scratchpad attempts failed because of how the probe's entry file was set up, **not because of the SDK**, so this says nothing about compatibility. SDK source uses `.js` suffixes on 490 relative imports of `.ts` files, so resolving source and consuming `dist/` must both be tried.

## 10. Runtime dependencies on React Native

Judged from how each is used here; only the first three rows' conclusions are firm without a device test.

| Dependency | Current use | Mobile position |
|---|---|---|
| `electron`, `better-sqlite3` | Desktop | Not usable |
| `pdfjs-dist`, `epubjs`, `react-dom`, `react-router-dom`, `react-markdown`, `react-colorful` | Desktop DOM UI | Not usable directly in native views; only possibly inside a WebView |
| `@huggingface/transformers`, own FFmpeg and Whisper process | Desktop | Not usable as built |
| `zustand` | SDK, renderer | Inlined in SDK dist; expected to work, to confirm |
| `jszip`, `fast-xml-parser`, `music-metadata` | Main | Unverified |

## 11. Formats

| Format | Exists today | Reusable (SDK) | Platform-specific |
|---|---|---|---|
| EPUB | Full | CFI, locator, annotation query, OPF parser (unused by Desktop) | `src/reader/renderers/epub`, epub.js, `epub.adapter.ts` |
| PDF | Full, including write-back | `app-models/pdf-*`, `planTwoWaySync`, attachment policy, ink, typewriter layout | pdf.js, `electron/pdf-sync` incremental writer and verifier |
| TXT | Full, editable | `txt/` | `<textarea>` surface, `electron/txt` |
| Markdown | Full | `md/` | `react-markdown` surface |
| Audiobook | Full; ZIP and transcription are gated | `audio/`, `transcription/` | `rb-audio://`, DOM `Audio`, FFmpeg, Whisper |
| **CBZ** | **Not supported.** Not in `DocumentFormat` or `SUPPORTED_FORMATS`; no importer or renderer. It appears only as a cloud-listing extension (`external-library.ts:113`, `CloudSourcesHub.tsx`) | Nothing yet | Nothing yet |

## 12. Documentation that does not match the code

| Document says | Code says |
|---|---|
| CLAUDE.md: both feature gates default off | Committed `true` (§1) |
| CLAUDE.md: importing `better-sqlite3`, React or engines in the SDK is a compile error | `better-sqlite3`, `react`, `epubjs` compile (§3) |
| SDK README: Electron integration through `createBookReaderSdk`, `createSqlNoteRepositories` | Not used by Desktop (§4) |
| `sql-notes.ts`: "matching the desktop SQLite layout" | Does not match (§6) |
| `ports/storage.ts`: "one adapter can serve both" | Only the narrow subset (§5) |
| SDS §2.7, §3.10: `packages/domain`, `packages/shared`, migrations through 019, `electron-store` | Folded into the SDK, 30 migrations, JSON prefs |
| `oauth-redirect.ts`: mobile not wired into `packages/*` "(see root CLAUDE.md)" | True in effect, and the reference is stale |
| `specs/003-unified-app-codebase` FR-001: one home for screens shared across apps | Conflicts with this feature's native Mobile direction: see spec.md |

## 13. External references (checked 2026-10-31; re-check at decision time)

- [Expo SQLite reference](https://docs.expo.dev/versions/unversioned/sdk/sqlite): config plugin has `enableFTS` (FTS3/4/5). JSON1 is not addressed there, so it needs a runtime test.
- [React Native: Hermes](https://reactnative.dev/docs/hermes): default engine since 0.70. No answer on the specific APIs in §3.
- [epubjs-react-native](https://github.com/victorsoares96/epubjs-react-native): epub.js inside a WebView.
- [React Native PDF overview (gluestack)](https://market.gluestack.io/blog/react-native-pdf-viewer) and [Nutrient](https://nutrient.io/blog/opening-a-pdf-in-react-native): secondary sources. `react-native-pdf` needs native code, so not Expo Go. Licensing and Readium were not confirmed.

## 14. WebView direction (added 2026-10-31, commit `8130c17`)

Counts come from `grep` over `reading-book-desktop/src`, excluding `src/spikes` where noted. None of this was run on a device.

| Finding | Evidence |
|---|---|
| `window.api` only in `src/bridge/*`; 52 files import the bridge | grep |
| About 131 channel constants across 20 groups; `DesktopApi` types take 1,574 lines | `electron/ipc/channels.ts`, `api-types.ts` |
| `electron/` is about 24,000 lines; `src/` about 54,700 lines in 395 files | `wc -l` |
| `src/` imports from `electron/` in 2 files, including `ipc/api-types`; whether any is a runtime import in the app UI needs checking | grep |
| `openBookContent` returns the whole file as `ArrayBuffer`; audio and covers use Electron protocols | `api-types.ts`, `audioPlayerStore.ts` |
| Routing is `HashRouter`, which needs no server routes | `src/App.tsx` |
| Window minimum 900 x 600; 1 width-based `@media`; Tailwind prefixes `sm:` 38, `md:` 9, `lg:` 7, `xl:` 1 | `electron/main.ts`, grep |
| Files using touch 1, pointer events 30, right-click 16, hover 82, keyboard 52 | grep |
| Files using `getSelection` 12, `caretRangeFromPoint` family 4, `contenteditable` 5, `setPointerCapture` 9, iframe access 6, `localStorage` 21 | grep |
| PDF.js 5.4.624 ships a `legacy/build`. Its modern build contains `Promise.try`, `Uint8Array.fromBase64` and `OffscreenCanvas`, some possibly behind feature checks, and needs a module worker URL | `node_modules/pdfjs-dist`, `PdfRenderer.tsx` |
| EPUB uses iframes with `allowScriptedContent: false` | `openEpubjs.ts` |
| Installs today: nested packages under Desktop (258 entries) and Mobile (329 entries); tracked lockfiles in repo root, `source/`, Desktop and Mobile | `ls`, `git ls-files` |
| React: Desktop and root 18.3.1, Mobile 19.2.3 | manifests |

**Compatibility assessment (not run on a device)**: PDF.js, epub.js, selection-based annotation, and storage durability are all plausible but unproven. iOS is the tighter target, because its WebView follows the OS version. Safari on iOS gains `Promise.try` and `Uint8Array.fromBase64` at 18.2 ([web-features](https://web-platform-dx.github.io/web-features-explorer/features/promise-try), [caniuse](https://caniuse.com/mdn-javascript_builtins_uint8array_frombase64)). Module scripts and workers from `file://` are a known risk, but the search found no primary source, hence OD-10.
