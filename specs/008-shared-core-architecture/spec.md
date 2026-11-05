# Feature Specification: Readmate Mobile as an Expo WebView Host of the Existing React UI

**Feature Branch**: `008-shared-core-architecture` (spec directory only; no git branch was created)

**Created**: 2026-10-31

**Status**: Draft

**Input**: User description: "Establish Shared Core Architecture for Electron Desktop and React Native Mobile: define the target architecture for one npm-workspaces monorepo with one Desktop app, one Mobile app and one shared `book-reader-sdk`, based on a verified audit. An evolution, not a rewrite. No application code in this feature's specification phase."

**Direction update (2026-10-31)**: the user replaced the earlier native-Mobile direction with Expo + WebView running the existing React UI. See Clarifications. This file keeps its directory name `008-shared-core-architecture`.

**Evidence**: every statement about the current system comes from [architecture-audit.md](./architecture-audit.md) (`§` references below).

**Status labels used throughout**:

- **[EXISTS]**: implemented and verified in code.
- **[PROPOSED]**: a change this architecture calls for.
- **[FUTURE]**: possible later; not required or authorized here.
- **[INVESTIGATE]**: cannot be decided from the code; see Open Decisions.

## Clarifications

### Session 2026-10-31

- Direction given by the user (not a question): Expo + React Native host; WebView runs the existing Desktop React UI; maximum reuse of UI, CSS and business logic; Desktop and Mobile are independent apps in one repository with no direct communication; Desktop keeps Main, Preload and IPC; Mobile has its own Mobile Bridge, not Electron IPC; no new shared SDK; npm Workspaces with one lockfile and one root `node_modules` preferred; `npm run dev` must keep working; no mass move or refactor of Desktop code for Mobile.
- Q: What must the first Mobile release do? → A: Library, import books from the device, read EPUB/PDF/TXT/Markdown, save reading position, and highlights, notes and bookmarks stored in the app. Excluded: writing into PDF files, audiobooks, cloud, translation, transcription.
- Q: Where should the phone interface be added so Desktop is not affected? → A: Directly in Desktop's `src/`, additive only: CSS below 900 px, plus small phone-only components where really needed. *Superseded for the Reader on 2026-11-03, next entry.*
- Q (2026-11-03, after the M2 review in T024): CSS and small branches cannot give a usable phone Reader, because `ReaderScreen.tsx` (2,021 lines) wires two sidebars, the toolbar, right-click menus, hover cards and resize handles together. How should the phone Reader be built? → A: A separate Mobile Reader UI, optimised for touch, inside `src/`, chosen by the Mobile signal. Desktop's Reader keeps its behaviour and look. The phone Reader reuses the existing zustand stores, business logic, format renderers and bridge contracts, and gets no Mobile-only stores or copied logic unless truly needed. The wiring it needs is moved out of `ReaderScreen.tsx` in small steps, never in one bulk refactor. Library, Settings and the rest stay on the CSS-and-small-branches rule.
- Q: When importing a book on a phone, should the app copy the file or keep a link to the original? → A: Always copy into the app's private storage. Removing a book deletes only the app's copy, never the original.
- Q: Which platforms must the first Mobile release meet, and from which iOS version? → A: Both Android and iOS, from iOS 18.2.
- Q: How does the first Mobile release reach people? → A: The goal is that it runs on both platforms; store publishing is not part of it. Current work is adapting the app for Mobile. Code is planned to be MacBook- and iOS-compatible now; a Docker test environment comes later in a separate task (OD-11).

### Session 2026-11-02

- Q: How should a developer open the Mobile app when it "runs with `npx expo start`"? → A: In Expo Go, by scanning the QR code, with no Android build. Expo Go cannot carry the native local server, so in this mode the WebView loads the UI from a development server on the developer's computer. It passes when the Readmate UI appears in the WebView.
- Q: After choosing Expo Go for development, does the real app still need a separate offline Android build? → A: Yes, but it is deferred. Expo Go is used until UI and bridge development are finished. The native local server stays, and an offline Android build must pass before the first release counts as complete.
- Q: Are Expo Go results enough to pass the M2 gate and continue to the bridge? → A: Yes, as a provisional pass. Expo Go covers rendering of all 4 formats, page turns, text selection, the PDF.js worker and SQLite. Offline running, the local server, 100 MB books and `localStorage` after a restart are recorded as unverified and must pass on the later Android build.

## Goals

**Business goals**

- Keep the Desktop product stable while shipping a Mobile app that reuses its UI.
- Avoid building and maintaining a second UI and a second copy of the reading rules.

**Architectural objectives**

- Make the shared core's independence **enforced**, not conventional.
- Prove the existing UI and its engines run in Android and iOS WebViews before building on that assumption.
- Fix one canonical data contract, owned by what Desktop users already have on disk.
- Keep Desktop files unchanged unless a Mobile requirement needs a change, and then keep it small and additive.

## Key Findings That Shape This Spec

1. **The SDK is widely used as a library, not as an application layer.** Desktop imports it from 201 files, but never calls `createBookReaderSdk` and uses none of the SDK's stores or its `ImportBook` / `OpenReader` style services. Real behaviour lives in Desktop's Main handlers and renderer stores (§4).
2. **The SDK's built-in SQL notes repository does not match Desktop's data** (§6).
3. **The dependency rule is only partly enforced**: SDK source can import `better-sqlite3`, `react`, `epubjs`, `@reading-book/config`, and even Desktop files, and still compile (§3).
4. **Mobile cannot run the UI yet.** No WebView, SQLite or file module is installed, and no web build exists outside Electron's Vite setup. Metro does not watch the SDK and Babel aliases a removed package (§9).
4a. **The bridge seam is real, but it only moves the work.** `window.api` appears only in `src/bridge/*`, so Mobile can supply the same API without changing the 52 files importing the bridge. Behind it, about 24,000 lines in `electron/` rely on `better-sqlite3` and `fs` and cannot run in a WebView. The channels the first release needs must be reimplemented or adapted for Mobile (§14).
4b. **The UI is desktop-sized.** Window minimum is 900 px, CSS has one width-based `@media`, 16 files use right-click menus and 1 handles touch (§14).
5. **The baseline is not fully green**: 2 of 998 SDK tests fail, because both feature gates are committed as `true` (§1). The gates' intended state must be settled before this baseline is used to judge regressions.
6. **CBZ does not exist** in the app (§11).

## Relationship to Spec 003

`specs/003-unified-app-codebase` is an unresolved draft asking whether Mobile should reuse Desktop's screens in a container. The direction now given matches its Question 1 option A, except that the Expo host stays. Repository layout stays as it is, which matches its Question 2 option A. Its Question 3 is answered by the Clarifications above. This spec does not edit 003; [INVESTIGATE] OD-9 covers its disposition.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Desktop users notice nothing (Priority: P1)

A person using the Desktop app updates to a build containing this work. Their library, positions, annotations, Notes and all features behave as before, with no data migration.

**Why this priority**: Desktop is the product that exists. Preparation that harms it has negative value.

**Independent Test**: Open a library created before this work in the new build and compare it to the old. Run the full check suite against the recorded baseline.

**Acceptance Scenarios**:

1. **Given** a library made by the previous version, **When** the new build opens it, **Then** all books, positions, annotations, bookmarks and audiobook Notes are present and no migration has been added.
2. **Given** the recorded baseline, **When** all checks run, **Then** nothing that passed now fails, and no check has been weakened or removed.
3. **Given** the release build, **When** it is packaged, **Then** it still produces a working installer.
4. **Given** the IPC surface, **When** this work is complete, **Then** channels and `window.api` keep their existing contracts.

---

### User Story 2 - A forbidden dependency fails the checks (Priority: P1)

A developer accidentally imports an app, a platform library or a rendering engine into the shared core. Automated checks reject it on their machine and in CI with a message naming the rule.

**Why this priority**: The audit showed that today's guarantee has holes. Every later step relies on this boundary.

**Independent Test**: For each row of the audit's probe table, add the violating import in a temporary test and confirm the check fails.

**Acceptance Scenarios**:

1. **Given** SDK source, **When** it imports any forbidden package or an application file, **Then** checks fail, whether or not that package happens to be installed nearby.
2. **Given** a workspace dependency that would form a cycle, **When** checks run, **Then** they fail.
3. **Given** today's code, **When** the checks first run, **Then** they pass, or each existing exception is listed explicitly.

---

### User Story 3 - The existing UI runs inside the Mobile app (Priority: P1)

A person opens the Mobile app, sees the existing Library UI inside a WebView on a phone, imports a book, reads it and adds a highlight.

**Why this priority**: Whether the UI and its engines really work in a WebView is the largest unknown, and everything else rests on it.

**Independent Test**: On one Android target and one iOS 18.2 or newer target, install a release-style build with networking off, then run the first-release journey for each format.

**Acceptance Scenarios**:

1. **Given** a Mobile build, **When** it starts offline, **Then** the UI loads from files inside the app, with no remote server or dev server.
2. **Given** the Mobile UI build, **When** it is produced, **Then** it uses the Desktop UI source without copying it, and Desktop's own build and `npm run dev` are unchanged.
3. **Given** a capability outside the first release, **When** the UI would offer it, **Then** it is hidden, or disabled with a reason, and never fails silently.
4. **Given** a book up to the agreed size limit, **When** it opens, **Then** the file does not pass whole through a WebView text message.
5. **Given** the app is killed and reopened, **When** the book is reopened, **Then** position, highlights, notes and bookmarks are intact.

---

### User Story 4 - Both apps agree on what reading data means (Priority: P2)

A developer implementing Mobile storage can test it against fixed sample data taken from real Desktop records and know their results match Desktop.

**Why this priority**: Without a canonical contract, the two apps would produce incompatible data, which is expensive to fix once real data exists.

**Independent Test**: Run the shared contract fixtures against the Desktop stores; they pass with no Desktop change. Run them against an in-memory implementation too.

**Acceptance Scenarios**:

1. **Given** fixtures from real `note_json` and `reading_state_json` shapes, **When** Desktop's stores read them, **Then** every record is returned intact.
2. **Given** the SDK's `persistence/sql-notes.ts`, **When** it runs against the same fixtures, **Then** its mismatch is shown by a test, and it stays marked as not for production until resolved.
3. **Given** the schema strategy, **When** a developer reads it, **Then** it states which SQLite capabilities are required and how Mobile's driver is verified to provide them.

---

### User Story 5 - A developer can tell where anything belongs (Priority: P2)

A developer adding a rule, an adapter or a screen can decide in minutes which package it belongs in, and the project's guidance documents no longer claim things the code does not do.

**Why this priority**: The architecture only holds if it is followed daily. Documents that are wrong mislead people and AI agents alike.

**Independent Test**: Give someone a list of ten sample capabilities and only the responsibility matrix; they should place them all correctly.

**Acceptance Scenarios**:

1. **Given** a new capability, **When** the developer consults the matrix, **Then** it gives one home and a reason.
2. **Given** each row in the audit's mismatch table (§12), **When** the docs are reviewed, **Then** it has been corrected or carries an explicit note.

---

### User Story 6 - New Mobile dependencies are decided on evidence (Priority: P3)

Before anyone adds a rendering library or native module to Mobile, a recorded decision compares alternatives, compatibility, trade-offs and licences.

**Why this priority**: Rendering choices are hard to reverse, but none is needed until a Mobile reader is started.

**Independent Test**: Review the decision record template against one sample library choice; every required field can be filled in.

**Acceptance Scenarios**:

1. **Given** a proposal for a new native dependency, **When** it has no completed record, **Then** it is not added.

---

### Edge Cases

- **A shared rule needs a platform service**: it takes an injected port and has a defined behaviour when that port is missing (the existing `ADAPTER_MISSING` pattern).
- **A dependency resolves only by hoisting**: checks must not depend on it being missing or present. A rule that holds only by accident of install layout counts as unenforced.
- **Large files on Mobile**: whole-file `readBytes` could exhaust memory, so any shared use case working on large books must have a chunked or host-owned route.
- **`content://` or other non-path references on Mobile**: they are used only while copying at import. Core code and the UI treat file references as opaque, and the UI never receives them.
- **A Desktop database opened by Mobile, or the reverse**: not supported by this feature. Device-bound paths would not resolve, and it must never be silently accepted as working.
- **A future schema change on one platform only**: the strategy must state who owns it, so schemas cannot fork unnoticed.
- **A WebView killed by the OS under memory pressure**: reading state already saved must survive, and the app must reload the UI rather than show a blank screen.
- **Book content in the WebView**: EPUB scripts stay disabled (`allowScriptedContent: false`), and the WebView must not navigate to anything outside the bundled UI.
- **A PDF that contains annotations from other readers**: they display as PDF.js draws them; Mobile does not import them into the app or write to the file in the first release.
- **OAuth secrets**: git-ignored local secret files sit in `packages/config`. They must never enter a Mobile bundle, or any bundle.
- **Mac unavailable**: iOS verification needs Apple tooling or a build service (OD-11). Android and Desktop work may proceed without it, but the first release is not complete until the iOS journey passes.
- **iOS older than 18.2**: not supported in the first release, and the install requirement must state it.
- **An Expo, React Native or WebView update breaks the UI**: the Mobile journey check catches it, and Desktop must be unaffected.

## Requirements *(mandatory)*

### Functional Requirements

**Monorepo structure**

- **FR-001**: The repository MUST remain one npm-workspaces monorepo with exactly one Desktop app, one Mobile app and one shared SDK, plus shared configuration in `packages/config`.
- **FR-002**: Directories MUST NOT be moved unless a written justification shows that the current layout blocks a requirement. The audit found none.
- **FR-003**: Each app's dependency on the SDK and config MUST be stated explicitly, not left to aliases and hoisting alone.

**Shared core boundary**

- **FR-004**: `book-reader-sdk/src` MUST NOT import Electron, React, React DOM, React Native, Node or DOM APIs, a SQLite driver, a format or rendering engine, an application, or `packages/config`.
- **FR-005**: Each rule in the Boundary Rules table MUST have an automated check that runs locally and in CI, and that does not depend on what is installed.
- **FR-006**: Workspace dependencies MUST be acyclic, and this MUST be checked automatically.
- **FR-007**: Shared code MUST run on Node and Chromium (Desktop) and in the supported WebViews (Mobile). If the Mobile host itself imports the SDK, it MUST also be shown to run on Hermes.
- **FR-008**: Runtime-sensitive code that executes at module load MUST NOT be able to prevent the SDK loading on a supported runtime.
- **FR-009**: No new shared SDK or package of shared business logic is created; `book-reader-sdk` remains the only one. Code that uses platform APIs MUST NOT move into SDK `src`. `host-adapters/` MUST be documented as Node/Desktop-only and MUST NOT be assumed to run on Mobile.

**Desktop preservation**

- **FR-010**: Desktop MUST keep Electron Main and Preload, IPC channels and handlers, React DOM, its SQLite and filesystem infrastructure, and pdf.js and epub.js rendering.
- **FR-011**: Desktop MUST NOT be required to adopt `createBookReaderSdk` or SDK stores to satisfy this feature.
- **FR-012**: A change to Desktop files for Mobile MUST be small and additive, and MUST leave Desktop behaviour unchanged. Moving or refactoring Desktop code in bulk for Mobile is not allowed. The one exception is FR-012c: wiring MAY be moved out of `ReaderScreen.tsx`, one small behaviour-preserving step at a time.
- **FR-012a**: Phone layout MUST live in `src/`, built from the Desktop UI source (FR-016); no separate Mobile override layer is created. Two parts:
  - **Library, Settings and other screens**: CSS that applies only below 900 px, Desktop's minimum window width, and only under the Mobile signal. Touch or layout needs that CSS cannot meet (for example right-click menus) MAY use small phone-only components or branches.
  - **Reader**: a separate Mobile Reader UI optimised for touch (decided 2026-11-03), under `src/screens/Reader/phone/`, chosen in `src/screens/ReaderRoute.tsx` by the Mobile signal, never by width alone. It MUST reuse the existing zustand stores, reader hooks, business logic, format renderers, capability rules and bridge contracts. It MUST NOT copy business logic, and MUST NOT add Mobile-only stores unless the reason is recorded in `contracts/phone-ui.md`; UI-only state, such as which sheet is open, stays in its components. It covers only the first-release Reader scope in `contracts/phone-ui.md`.
- **FR-012b**: At 900 px and above, and in every Electron run, phone-only CSS and branches MUST NOT change what Desktop shows or does. The phone branch MUST depend on a defined Mobile signal or width rule, and each one MUST be checked against Desktop. Electron MUST always get the existing `ReaderScreen`, and the Mobile Reader MUST be lazy-loaded so Desktop does not load its code.
- **FR-012c**: Wiring that the Mobile Reader needs MAY be moved out of `ReaderScreen.tsx` into shared hooks, stores or pure functions. Each step MUST move one area only, MUST keep Desktop's behaviour, look, effect order and stored data identical, MUST pass Desktop's checks (`typecheck`, `lint`, `npx vite build`, the spikes of that area) before the next step starts, and MUST be reversible on its own. Wiring the Mobile Reader does not use (ink, shapes, typewriter, attachments, graphics, translation, read aloud, snapshot, word count, search, export) stays where it is.
- **FR-013**: Desktop's user data, schema and behaviour, and `npm run dev`, MUST remain unchanged by this feature.

**Mobile**

- **FR-014**: Mobile MUST remain an independent Expo + React Native app that hosts a WebView. React Native owns only the host: WebView container, native services, permissions and lifecycle. Screens, CSS and readers stay in the React web UI.
- **FR-015**: Mobile MUST NOT use Electron or Electron IPC, and Desktop MUST NOT depend on Mobile's code. Mobile reuses Desktop's UI source (`src/`) as build input and MUST NOT import `electron/` runtime code. The two apps MUST NOT need to communicate.
- **FR-016**: Mobile's UI build MUST come from the Desktop UI source without a copy, and its output MUST ship inside the app so it works offline. How it is served to the WebView is OD-10; a `file://` page MUST NOT be assumed to support module scripts and workers.
- **FR-017**: A repeatable Mobile journey check MUST cover the first release on a device or emulator.
- **FR-017a**: The Mobile Bridge MUST provide the `DesktopApi` shape as `window.api` before the UI starts, so `src/bridge/*` stays unchanged. A channel outside the first release MUST return a defined "not available on this platform" result.
- **FR-017b**: Native services behind the bridge MUST use the host's SQLite and file modules. Book bytes, covers and other large payloads MUST use a route other than whole-file WebView text messages (OD-10). Only in Expo Go development mode (FR-017k), book bytes MAY use size-capped chunks over WebView messages; a release build MUST NOT have this route.
- **FR-017c**: The first release MUST support Android and iOS 18.2 or newer, and MUST provide: Library; import from the device; reading EPUB, PDF, TXT and Markdown; saved position; highlights, notes and bookmarks stored in the app. TXT opens read-only.
- **FR-017g**: Import on Mobile MUST copy the picked file into the app's private storage, hash it, reject a duplicate by `sha256`, and only then create the book row. A failed or cancelled import MUST leave no partial file or row. After import, the book MUST open without the original file or a network connection.
- **FR-017h**: Removing a book on Mobile MUST delete the app's copy and its data, and MUST NOT touch the original. If space runs out during import, the user MUST see a clear error and the library MUST stay unchanged.
- **FR-017i**: The first release MUST install and run on real or simulated Android and iOS targets. Publishing to Google Play or the App Store is not required.
- **FR-017j**: All Mobile code, configuration and scripts MUST be written to build and run from a MacBook and on iOS 18.2+, from the start, even though iOS testing happens later in a separate task. Android-only or Windows-only solutions MUST NOT be used without an iOS and macOS equivalent in the same change.
- **FR-017k**: Running `npx expo start` in `apps/reading-book-mobile` and opening the project in Expo Go MUST show the Readmate UI in the WebView, with no Android build. In this mode the host MUST NOT load the native local server, and the UI comes from a development server on the developer's computer, reachable by the phone over the local network. This mode is for development only, and does not satisfy the offline requirement of FR-016 or SC-004.
- **FR-017l**: The native local server MUST be kept for the real app. An Android build that passes the offline journey is deferred until UI and bridge development are finished, and MUST pass before the first release counts as complete.
- **FR-017m**: M2 MAY pass provisionally on Expo Go results for rendering of all 4 formats, page turns, text selection, the PDF.js worker and SQLite. Offline running, the local server, 100 MB books and `localStorage` after a restart MUST be recorded as unverified until they pass on the Android build of FR-017l. A failure there MUST be reported to the user, and may reopen M2 decisions.
- **FR-017d**: The first release MUST NOT write to any book file, and MUST NOT include audiobooks, cloud, translation, transcription, annotation sync with PDF files, tray, reminders or update checks.

**Workspaces**

- **FR-017e**: `source/` MUST keep npm Workspaces, with one `source/package-lock.json` and one root `node_modules` as the target. The separate Desktop and Mobile lockfiles are removed when the change is shown not to break Desktop.
- **FR-017f**: A package may be nested under one app only when versions truly conflict. React is the known case: Desktop stays on 18 and Expo 57 needs 19.2.3. Every exception MUST be listed and justified, and only one React copy may load in each runtime.

**Ports**

- **FR-018**: Existing ports MUST be reused where suitable. A new port needs a recorded need that no existing port meets. `AnnotationStore` and `ReadingStateStore` MUST NOT be added alongside `OverlayStore` without that record.
- **FR-019**: Every port Mobile relies on MUST have a conformance suite, runnable against any implementation, and Desktop's implementation of it MUST pass.
- **FR-020**: Known port gaps MUST be recorded and each resolved before Mobile relies on that port: narrow `LibraryStore` and `OverlayStore`; whole-file `FileSystemAdapter`; copy-oriented `DocumentImporter`; no atomic transaction on `SqlDatabase`; untyped `LocationCodec`.

**Data and persistence**

- **FR-021**: Desktop's stored formats MUST be the canonical data contract.
- **FR-022**: The contract MUST be captured as versioned fixtures covering every `note_json` kind, reading state and the portable annotation file.
- **FR-023**: `persistence/sql-notes.ts` MUST be marked as incompatible until it is reconciled with the contract, and MUST NOT be used for Mobile before then.
- **FR-024**: Database drivers and filesystem access MUST stay platform-specific.
- **FR-025**: No Desktop schema change or new Desktop migration is permitted in this feature.
- **FR-026**: Any shared migration approach MUST be verified on the Mobile driver, not assumed from shared SQL text.
- **FR-027**: Cross-device identity MUST rely on portable values (`books.sha256` and book-independent locators), never on device-bound path columns.

**Formats and dependencies**

- **FR-028**: Mobile MUST reuse Desktop's web renderers (epub.js, PDF.js, TXT, Markdown) in the WebView unless evidence shows one cannot work.
- **FR-029**: EPUB, PDF, TXT and Markdown are required on Mobile. Audiobook and CBZ are not.
- **FR-030**: A rendering library other than Desktop's, or a native dependency beyond the ones a plan justifies, MUST NOT be added to Mobile without a decision record covering alternatives, Expo and React Native compatibility, trade-offs, licence and maintenance status.

**Governance**

- **FR-031**: CI MUST add Mobile typecheck, the Mobile UI build and the new boundary checks, and those additions MUST NOT weaken any existing check. Device runs stay manual.
- **FR-032**: CLAUDE.md, the SDK README and the SDS MUST be corrected for the mismatches in audit §12. SDK source comments that are wrong MUST be corrected or flagged.
- **FR-033**: No secret file may enter any app bundle, and this MUST be checked.

### Key Entities

- **Shared Core**: `book-reader-sdk/src`; platform-free rules, models, ports and pure format logic.
- **Port**: a contract in the core implemented per platform.
- **Adapter**: one platform's implementation of a port.
- **Mobile Host**: the Expo + React Native app around the WebView.
- **Mobile Bridge**: Mobile's implementation of `DesktopApi`, spanning the WebView and the host.
- **Data Contract**: the canonical shapes of stored reading data, represented by versioned fixtures.
- **Boundary Rule**: a dependency constraint tied to an automated check.
- **Decision Record**: the evidence required before a library or architecture choice.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of checks passing in the recorded baseline still pass, with 0 removed or weakened; the 2 known gate failures are resolved or explicitly accepted in the baseline before work begins.
- **SC-002**: A library created before this work opens with 100% of its books, positions, annotations, bookmarks and Notes intact, and 0 new migrations.
- **SC-003**: 100% of the forbidden-dependency cases in the audit probe table are rejected by automated checks, including the 5 that compile today.
- **SC-004**: On at least one Android target and one iOS 18.2 or newer target, with networking off, the first-release journey passes for all 4 formats.
- **SC-005**: 0 Desktop UI or SDK files are copied into Mobile, and 0 files import `window.api` outside `src/bridge/*`.
- **SC-006**: 100% of contract fixtures pass against Desktop's stores with no Desktop code change.
- **SC-007**: A developer places 10 of 10 sample capabilities correctly using the matrix alone.
- **SC-008**: 100% of documented mismatches in audit §12 are corrected or annotated.
- **SC-010**: After a restart, 100% of positions, highlights, notes and bookmarks created in the Mobile journey are intact, and 0 book files have changed.
- **SC-011**: `npm ci` in `source/` from one lockfile gives working Desktop and Mobile installs, with every nested package listed as an exception.
- **SC-009**: Every Open Decision has an owner milestone, and none of them blocks a later milestone without saying so.

## Assumptions

- **Direction is given**: Expo host with the existing React UI in a WebView.
- **Delivery order**: Android is verified first because it needs no Apple tooling. iOS is still required for the first release.
- **The data contract is Desktop's**, because that is the only real user data that exists.
- **SDK source for Desktop stays as is**: Desktop keeps consuming source via alias. How the Mobile UI build and any host use consume the SDK is OD-1.
- **Capabilities beyond the first release** each get their own spec.
- **External facts** in the audit (§13) come partly from secondary sources and are rechecked at decision time.

---

## Existing Architecture Assessment

Details and evidence are in the [audit](./architecture-audit.md).

**Strengths [EXISTS]**

- The SDK has no platform API or undeclared package usage, and an automated self-containment check on `dist/`.
- 998 SDK tests exist, along with spike scripts and 32 E2E spec files on Desktop.
- `window.api` appears only in `src/bridge/*`, and Electron is contained in `electron/`.
- Much pure logic is truly shared: annotation models, audio rules, TXT, Markdown, ink, typewriter, PDF sync planning.
- The workspace layout already fits the target.

**Gaps and risks**

- Two parallel application layers (§4).
- Partial compile-time enforcement (§3).
- SDK persistence does not match Desktop (§6).
- Ports narrower than Desktop's real behaviour (§5).
- Renderer stores mix rules with DOM and bridge use (§7).
- The Mobile build is not wired to the SDK, and the SDK has never run on Hermes (§3, §9).
- CI does not cover Mobile or config (§2).

## Target Architecture

```
┌─────────────────────────┐   ┌────────────────────────────────┐
│ reading-book-desktop    │   │ reading-book-mobile            │
│ Electron window         │   │ WebView                        │
│  src/ React UI ◀────────┼───┼─ same src/, Mobile web build   │
│  src/bridge → window.api│   │  src/bridge → window.api       │
│ ─────── IPC ──────      │   │ ─────── Mobile Bridge ──────   │
│ Main: handlers, SQLite, │   │ RN host: SQLite, files,        │
│ fs, workers, adapters   │   │ import, lifecycle, permissions │
└───────────┬─────────────┘   └───────────────┬────────────────┘
            ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│ book-reader-sdk/src (existing): rules, models, ports         │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ packages/config: formats, feature flags, shared constants    │
└──────────────────────────────────────────────────────────────┘
```

**Boundary between React web UI and React Native**: DOM, CSS, zustand UI stores, routing and readers live in the WebView. Native modules live in the host. Only the Mobile Bridge crosses between them, and React Native components never render reading screens.

**Reuse limits**: `src/` and the SDK are reused. `electron/` is not reusable at runtime, so first-release behaviour behind the bridge is new Mobile code that MUST match Desktop's data contract. Pure rules worth sharing between Main and the host go into the existing SDK only when needed.

## Shared vs Platform-Specific Responsibility Matrix

| Capability | Shared core | Desktop | Mobile | Status |
|---|---|---|---|---|
| Screens, components, CSS, UI stores | Never | Owns `src/` | Reuses `src/` in the WebView | [EXISTS] / Mobile [PROPOSED] |
| `window.api` implementation | Never | Preload + IPC | Mobile Bridge | [EXISTS] / Mobile [PROPOSED] |
| Domain models, value objects | Owns | Uses | Uses | [EXISTS] / Mobile [PROPOSED] |
| Annotation models, rules, query, history | Owns | Uses | Uses | [EXISTS] |
| Annotation transfer: file format, plan, content key | Owns | File dialogs, transaction | Not in the first release | [EXISTS] / Mobile [FUTURE] |
| Reading position rules, `Location` | Owns | Uses | Uses | [EXISTS] |
| EPUB CFI strings, comparison | Owns | epub.js integration | Same epub.js in WebView | [EXISTS] / Mobile [PROPOSED] |
| Reading-state logic | Partly in SDK, partly in UI stores | Stores, autosave, Main writes | Same UI stores, host writes | [EXISTS] / Mobile [PROPOSED] |
| Library rules: dedupe, collections | Duplicated risk (SDK services vs `sqlite-library-store`) | Current authority | Must match Desktop | OD-2 |
| Audio timeline, Notes, chapter rules | Owns | Player on DOM `Audio`, `rb-audio://` | Not in the first release | [EXISTS] / Mobile [FUTURE] |
| Text search rules, chunking | Owns | FTS queries, workers | Own queries | [EXISTS] / Mobile [INVESTIGATE] |
| Stored data shapes | Owns via contract fixtures | Conforms | Must conform | [PROPOSED] |
| Ports | Owns | Implements | Implements | [EXISTS], gaps per FR-020 |
| Schema, migrations | Contract only for now | Owns migrations | OD-3 | [INVESTIGATE] |
| SQLite driver, file access | Never | better-sqlite3, `fs` | Host modules | Required separation |
| Rendering | Never | pdf.js, epub.js, DOM | Same code in WebView; OD-4 if one fails | [EXISTS] / Mobile [INVESTIGATE] |
| Selection and gesture handling | Never (pure geometry may be shared) | DOM, mouse | DOM, touch | Mobile [PROPOSED] |
| PDF write-back to file | Pure planning only | Writer, watcher, verify | Excluded from the first release | [EXISTS] / [FUTURE] |
| IPC, Preload, tray, login item | Never | Owns | N/A | [EXISTS] |
| Navigation | Never | `HashRouter` in `src/` | Same | [EXISTS] / Mobile [PROPOSED] |
| App lifecycle, permissions | Never | Own | Host | Required separation |
| App preferences storage | Default values and models only | `localStorage`, Main JSON | `localStorage` in WebView; durability to verify | [EXISTS] / [INVESTIGATE] |
| Cloud clients, OAuth | Never in `src` | `host-adapters`, token vault | Own; OD-7 | [EXISTS] / [FUTURE] |
| Translation, transcription engines | Port and text rules only | Transformers.js, Whisper, FFmpeg | Not planned | [EXISTS] / [FUTURE] |
| Formats, flags, redirect constants | `packages/config` | Uses | Uses | [EXISTS] / [PROPOSED] |

## Dependency Rules and Boundaries

| # | Rule | Enforced today? | Enforcement [PROPOSED] |
|---|---|---|---|
| R1 | SDK `src` uses no Node or DOM globals | **Yes**, `lib`/`types: []` | Keep |
| R2 | SDK `src` imports no forbidden packages (Electron, React, RN, drivers, engines) | **No**, partly by accident (§3) | Import check with an allowlist: only `zustand/vanilla` and relative paths. The exact tool is a planning choice |
| R3 | SDK never imports an app or config | **No**, compiles today | Same import check; relative paths must stay inside `src` |
| R4 | `dist/` is self-contained | **Yes**, `build.mjs`; it does not catch inlined code | Keep; R2 closes the gap |
| R5 | Workspace graph is acyclic: apps → config → SDK | Convention | Graph check over manifests and imports |
| R6 | Adapters implement core ports | **Partly**, `implements` where used | Conformance suites for ports Mobile relies on |
| R7 | Desktop and Mobile never import each other | Convention | Import check |
| R8 | Mobile host uses no Electron or DOM libraries; the Mobile UI build includes no `electron/` runtime code | Vacuous today | Import check, plus Mobile typecheck in CI |
| R9 | Only `src/bridge` touches `window.api` on Desktop | Holds, not checked | ESLint `no-restricted` style rule: low cost, but must keep lint green |
| R10 | Shared code runs in supported WebViews, and on Hermes if the host imports it | **No** | Manual journey check on a device |
| R11 | `host-adapters` not imported by Mobile | Nothing imports it there today | Import check, until OD-7 |

## Data and Persistence Strategy

| Item | Decision | Status |
|---|---|---|
| Domain data models | Share. Already in the SDK | [EXISTS] |
| Repository contracts | Share, after closing gaps (FR-020) | [PROPOSED] |
| Serialization of `note_json`, reading state | Share. One codec, tested on contract fixtures. Today Desktop's codec in `sqlite-overlay-store.ts` is the authority, and the SDK's differs | [PROPOSED] |
| Drivers, file access | Never share | Required |
| Schema, migration definitions | Not shared now. Desktop's 30 files carry history a new install doesn't need, are loaded through a Vite-only mechanism, and include table rebuilds. See OD-3 | [INVESTIGATE] |
| Required SQLite features | Documented list: FTS5 with `unicode61 remove_diacritics 2`, JSON functions in `CHECK` and index expressions, triggers, foreign keys, atomic multi-statement transactions. Verified on Mobile's driver at runtime | [PROPOSED] |
| Cross-platform moves | Not required: the apps do not communicate. `.readmate-notes.json` remains a possible later route | [EXISTS] for Desktop; Mobile [FUTURE] |
| Database file interchange | Not supported: device-bound paths | Excluded |

Sharing SQL text would not guarantee equal behaviour. SQLite version, compile options, tokenizer behaviour and transaction semantics can all differ, so compatibility is shown by **running the fixtures on each driver**.

## Cross-Platform Compatibility Requirements

- Supported runtimes: Desktop's Electron and Node; Android WebView at the minimum version the plan records and iOS 18.2 or newer; Hermes only for code the host runs.
- Newer JavaScript used by the UI and its engines must be shown to run on the minimum WebView, or be provided by a legacy build or polyfill. PDF.js 5.4.624 contains `Promise.try` and `Uint8Array.fromBase64`; Safari on iOS gains both at 18.2 (§14).
- Hash, IDs and timers are injected where the platform lacks them [EXISTS].
- File references are opaque strings [EXISTS in `FileRef`].
- The Mobile UI build keeps Desktop's React 18, and the host uses React 19. They run in separate runtimes.
- Android is verified first, then iOS; both are required for the first release.

## Incremental Path

Each step can stop safely. Later steps need their own plan and tasks.

| Step | Outcome | Touches Desktop? | Exit check |
|---|---|---|---|
| **M0 Baseline** | Settle the gate failures; record check results; correct docs | Flags only, if that is the decision | SC-001 baseline, SC-008 |
| **M1 Workspace** | One lockfile target; exceptions listed; Mobile config fixed | Install layout only; Desktop checks rerun | SC-011 |
| **M2 WebView feasibility** | Provisional pass on Expo Go: UI, PDF.js, epub.js and workers run on Android, with the serving route chosen and the items in FR-017m recorded as unverified; the choice avoids Android-only APIs where possible | No | OD-10 provisionally closed; finally closed by the Android build of FR-017l |
| **M3 Boundaries and contracts** | Rules automated; fixtures; `sql-notes` flagged | Lint and tests only | SC-003, SC-006 |
| **M4 Mobile Bridge and data** | First-release channels on host SQLite and files; other channels answer "not available" | No | SC-010 |
| **M5 Phone UI** | First-release journey usable on a phone, with a separate Mobile Reader UI | Small additive changes; wiring moved out of `ReaderScreen.tsx` in small steps (FR-012c) | SC-002, SC-004 |
| **M6 iOS** | Separate task at the user's request: iOS test environment set up (OD-11), WebView feasibility rechecked; same journey on iOS 18.2 or newer; required for the first release | No | SC-004 on iOS |

## Migration and Backward Compatibility

- No data migration, no schema change, no IPC change, and no change to the `.readmate-notes.json` format.
- Desktop continues to consume SDK source through its aliases.
- New SDK exports may be added; removing or changing one used by Desktop requires its callers to be updated in the same change.
- Unused SDK modules are kept (no deletions).
- Any later Mobile schema must be able to read contract fixtures from the Desktop version current at that time.

## Testing and Regression Requirements

| Layer | What | When |
|---|---|---|
| SDK unit and integration | Existing suite, plus contract fixtures | CI |
| Boundary | R2–R9 checks, including negative cases that prove each check fails | CI |
| Port conformance | Shared suites; Desktop stores run against the migrated schema, where the driver allows | Locally; CI if the native driver can run there (OD-8) |
| Desktop | `typecheck`, `lint`, `e2e:typecheck`, `npx vite build`, spikes related to any touched area | Local and CI as today |
| Desktop E2E | Manual, only when the user asks, per CLAUDE.md | Before any release that extracts logic (M6) |
| Mobile | Typecheck and UI build in CI; device journey manual on Android and iOS; Android first | Per step |

## Risks, Constraints and Open Decisions

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The two application layers drift further apart | Mobile adopts a layer that differs from real behaviour | OD-2; contract fixtures |
| Mobile host behaviour drifts from Main | Same UI, different data results | Contract fixtures; conformance suites |
| WebView memory limits on large PDFs or EPUBs | Crashes, blank screens | M2 measurements; size limit in the plan |
| Phone changes destabilize Desktop | Regressions in the main product | FR-011, FR-012; additive changes |
| Moving wiring out of `ReaderScreen.tsx` changes Desktop's Reader | Lost positions, broken highlights, changed effect order | FR-012c: one area per step, Desktop checks between steps; risks listed in `contracts/phone-ui.md` |
| The Mobile Reader copies logic or grows its own stores | Two Readers that drift apart | FR-012a: reuse stores and hooks; any Mobile-only store has a recorded reason |
| React 18 / 19 in one workspace | Broken hooks; Desktop lockfile changes | FR-017f; review lockfile changes |
| Mobile config changes alter root install | Desktop build breaks | Run Desktop checks after each change |
| Thin ports get widened to fit Desktop's stores | Large, leaky contracts | Add only what Mobile needs (FR-018) |
| Whole-file reads on phones | Crashes on large books | FR-020 |
| Text selection and touch conflict in the WebView | Annotation unusable on phones | M2 and M5 device tests |
| Stale docs mislead later work | Wrong decisions | FR-032 |
| Feature flags committed on | The gate's protection is bypassed | M0 |

### Constraints

One monorepo; exactly one Desktop and one Mobile app; no new SDK; no copied UI; no premature Desktop rewrite; no unnecessary infrastructure, backend, paid service or cloud dependency; no unnecessary restructuring; Desktop functionality and data preserved.

### Open Decisions

None of these can be settled from the code. None blocks M0 or M1. OD-10 must be provisionally closed before M4, and finally closed before the first release (FR-017m). OD-11 blocks only M6.

| # | Decision | Options | Recommended start | Close at | Status (2026-11-05) |
|---|---|---|---|---|---|
| OD-1 | How does the host consume the SDK, if at all? (The UI build uses source, as Desktop does) | Not at all; built `dist/`; source through Metro | Avoid until a host need appears, then try `dist/` | M4 | **Closed (plan)**: the host does not import the SDK in the first release (`plan.md`) |
| OD-2 | Which SDK services, if any, should the Mobile host use behind the bridge? | SDK services after reconciling; new host code; a mix | Assess per channel against contract fixtures | M4 | **Closed (M4)**: new stores in `web/src/stores`, reusing SDK pure rules; SDK `services/*` and `sql-notes` not used |
| OD-3 | Mobile schema source | Shared consolidated baseline generated from Desktop; shared migration files moved to a neutral location; or a separate Mobile schema tested against the contract | Separate, contract-tested, until a need for more appears | M4 | **Closed (M4)**: separate Mobile baseline (`web/src/db/`), contract-tested |
| OD-4 | Fallback if PDF.js or epub.js fails in a WebView | Legacy build or polyfill; raise minimum OS; another library with a record (FR-030) | Legacy build or polyfill first | M2 | **Closed (M2)**: pdf.js legacy build on Mobile; epub.js needed no fallback (`m2-results.md`) |
| OD-5 | Hermes `Intl` and Unicode behaviour | Only matters if the host imports the SDK | Close with OD-1 | M4 | **Closed with OD-1**: Hermes does not run SDK code |
| OD-6 | Atomic transaction contract across drivers | Add a port method; adapter-level batch operations | Check Mobile driver semantics first | M4 | **Closed (M4)**: host `sql.transaction` runs a statement batch atomically |
| OD-7 | Mobile cloud clients | Refactor `host-adapters` to injected I/O; separate implementation; not at all | Defer: not in scope for early Mobile | Mobile cloud spec | **Deferred**: out of the first release; a Mobile cloud spec decides |
| OD-8 | Can Desktop's native SQLite stores run in CI? | Electron-ABI wrapper as local spikes do; a Node-ABI build; local only | Local first | M3 | **Closed (M3)**: Mobile stores on `node:sqlite`; Desktop stores through a local Electron-ABI script |
| OD-9 | What happens to spec 003? | Mark superseded by this spec; leave it as is | Mark superseded | M0 | **Closed (M0)**: spec 003 marked superseded (T003) |
| OD-11 | How is the iOS environment shared, built and signed? | A shared Docker environment, set up later at the user's request. Whether it covers the Xcode build, which needs macOS, and signing is checked then | Decide when the user starts this work; it does not block current Mobile adaptation | Before M6 | **Open**: blocks only M6 |
| OD-10 | How does the WebView load the UI and large book bytes? | Local HTTP server in the host; custom scheme; file URLs with inlined workers | Test on devices; do not assume `file://` | M2 provisionally; Android build of FR-017l finally | **Provisionally closed (M2)**: local server on `127.0.0.1`; final close on the Android build (T093) |

### Format Reuse Boundary

| Format | Reused in WebView | Host work | First-release position |
|---|---|---|---|
| EPUB | epub.js renderer, CFI, annotations | Import, metadata, bytes | Required; compatibility unverified |
| PDF | PDF.js renderer, annotations in the app | Import, metadata, bytes | Required; no write to the file; compatibility unverified |
| TXT | Text surface, offsets, annotations | Import, text storage | Required, read-only |
| Markdown | `react-markdown` surface, anchors | Import, bytes | Required |
| CBZ | Nothing exists | Nothing | Not required |
| Audiobook | Screens and SDK rules exist | Streaming route, tags | Excluded |

## Out of Scope

- Rewriting the SDK, creating a new shared SDK, or migrating Desktop to SDK stores or `createBookReaderSdk`.
- Replacing or reshaping Electron IPC.
- Rebuilding reading screens in React Native.
- Direct communication between Desktop and Mobile.
- Writing to book files on Mobile; audiobooks, translation and transcription on Mobile.
- Desktop schema changes or new Desktop migrations.
- Cloud sync, accounts, a backend, or paid services.
- AI functionality.
- Deleting existing modules.
- Moving directories without written justification.
- CBZ support.
- Shipping to app stores.
