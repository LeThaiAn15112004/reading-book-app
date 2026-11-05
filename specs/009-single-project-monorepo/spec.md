# Feature Specification: One Project for Desktop and Mobile

**Feature Branch**: `009-single-project-monorepo` (spec directory only; no git branch was created)

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description (translated from Vietnamese): "Turn the whole repository into one single project instead of three separate projects (SDK, desktop, mobile): shared UI, shared logic, one monorepo. `npm run dev` at the repository root starts the desktop app by default; running `npx expo start` there starts the mobile app. Instead of two to four `node_modules` folders, have one shared folder for the whole repository to save disk space."

## Clarifications

### Session 2026-11-05

- Q: After the move, does the `source/` folder stay, or is everything flattened to the repository root? → A: Keep
  `source/`; only the manifest, lock file, install folder and tool-required root entries move to the root (FR-013).
- Q: Is the reading core's portable `dist/` bundle kept? → A: No, drop it; nothing outside the repository uses it
  (FR-012).
- Q: Inside `source/`, do the current folder names stay, or does the shared UI move out of the desktop folder? → A:
  New layout given by the user: `source/core/` (`src/`, `tests/`: the reading core) and `source/app/` (`components/`,
  `screens/`, `platforms/` with one adapter file per runtime, for example `storage.*.ts`, `window.*.ts`) (FR-010,
  FR-013).
- Q: Do the `platforms/` adapter files mean rewriting the UI in React Native, or keeping the mobile app's WebView? →
  A: Keep the WebView (spec 008); the shared UI is not rewritten. Adapter files keep the user's names,
  `*.electron.ts` and `*.native.ts`, and the UI build picks one per host (FR-010a).
- Q: Where do the native hosts and the real SQLite / file code go? → A: Exactly the user's layout, with no extra
  `source/desktop/` or `source/mobile/` (this replaces an earlier answer of the same session): runtime code, including
  the Electron Main/Preload process, the React Native host and its Kotlin/Swift modules, lives under
  `source/app/platforms/`; `source/core` holds the database and file *logic* (schema, migrations, SQL, stores,
  parsers) written against an injected driver, and the drivers themselves live in `platforms/` (FR-011, FR-013).

## Relationship to Earlier Specs

- **Spec 003** asked the same question ("one project?") and was superseded by spec 008.
- **Spec 008** decided to *keep* three workspaces (`apps/book-reader-sdk`, `apps/reading-book-desktop`,
  `apps/reading-book-mobile`) and move nothing, with the Mobile app running the Desktop UI inside a WebView. That
  architecture stays: one UI, one reading core, two hosts (Electron and Expo). **This spec changes only how the code
  is packaged, installed and started**, and it overrides spec 008's "Structure Decision: keep the current workspaces;
  move nothing" (`specs/008-shared-core-architecture/plan.md`).
- Spec 008's guarantees remain requirements here: Desktop users notice nothing, the core stays free of platform code,
  and the dependency rules R1–R11 stay enforced.

## Current State (measured 2026-11-05)

- **Five install folders**: `node_modules` at the repository root (24 entries, 11 MB, only the tool that starts both
  apps together), `source/node_modules` (754 entries, 950 MB), `source/apps/reading-book-desktop/node_modules`
  (126 entries, 480 MB), `source/apps/reading-book-mobile/node_modules` (84 entries, 1.6 GB, which includes native
  build output) and an empty `source/apps/book-reader-sdk/node_modules`. In total about **3.0 GB**.
- **Two separate entry points**: the repository root only starts both apps together (`npm run dev` starts desktop
  *and* mobile); everything else runs from `source/` or from each app folder.
- **Two UI-library generations**: Desktop uses the previous major version of its UI library (React 18), Mobile the
  current one (React 19, required by its framework, React Native 0.86). This difference is why a package must be
  installed twice today, and it is the main obstacle to a single install folder.
- **Already shared**: the Mobile app runs the Desktop screens unchanged (spec 008), and both apps use the same reading
  core and configuration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start the desktop app from the repository root (Priority: P1)

A developer clones the repository, installs once at the root, and runs one command at the root to work on the desktop
app, without changing folder.

**Why this priority**: It is the daily workflow; today it needs either both apps at once or a change of folder.

**Independent Test**: On a fresh clone: one install command at the root, then `npm run dev` at the root opens the
desktop app with hot reload; no mobile process starts.

**Acceptance Scenarios**:

1. **Given** a fresh clone, **When** the developer installs at the repository root, **Then** every dependency of
   desktop, mobile and the reading core is installed by that single command.
2. **Given** an installed repository, **When** the developer runs `npm run dev` at the root, **Then** the desktop app
   starts, exactly as `npm run dev` in the desktop folder did before, and no mobile tooling starts.
3. **Given** the desktop app is running, **When** the developer edits a screen or a core file, **Then** the change
   appears without a restart, as today.

---

### User Story 2 - Start the mobile app from the same root (Priority: P1)

The same developer, in the same folder, starts the mobile development server and opens the app on a phone or
emulator, as they do today from the mobile folder.

**Why this priority**: The mobile app must stay usable during the move; the user is actively testing it.

**Independent Test**: At the root, `npx expo start` (and an equivalent `npm run dev:mobile`) shows the QR code; the
app opens in Expo Go with the Readmate UI; an Android build started from the root produces an installable app.

**Acceptance Scenarios**:

1. **Given** an installed repository, **When** the developer runs `npx expo start` at the root, **Then** the mobile
   development server starts and the app opens in Expo Go with the same UI as before.
2. **Given** the mobile server is running, **When** the developer edits a screen, **Then** the mobile UI shows the
   change after its usual rebuild or reload.
3. **Given** the Android tooling is installed, **When** the developer starts an Android build from the root, **Then**
   it produces an installable app with the same behaviour as before.
4. **Given** both apps are wanted at once, **When** the developer runs one documented root command, **Then** both
   start together (the behaviour of today's root `npm run dev`).

---

### User Story 3 - One install folder for the whole repository (Priority: P2)

The developer has one dependency folder for the whole repository, so the repository takes less disk space and an
install, an update or a clean-up happens in one place.

**Why this priority**: The direct disk saving the user asked for; it depends on Stories 1–2 working first.

**Independent Test**: After a fresh install, list every dependency folder in the repository and measure its size.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the developer lists dependency folders, **Then** there is exactly one at the top
   level of the repository and none at the top of any app or core folder.
2. **Given** that install, **When** the total size is measured, **Then** it is smaller than the recorded 3.0 GB
   baseline by the amount in SC-004.
3. **Given** the repository is installed, **When** a package is used by both apps, **Then** it is installed once.

---

### User Story 4 - One project, one place for each kind of code (Priority: P2)

A developer sees one project: one manifest, one set of commands, one configuration for shared tooling, with the UI,
the reading logic, the desktop host and the mobile host as folders of that project rather than separate packages.

**Why this priority**: The structural part of "one project"; the boundaries that keep Desktop safe must survive it.

**Independent Test**: Count project manifests; run every check from the root; break a dependency rule on purpose and
see it fail.

**Acceptance Scenarios**:

1. **Given** the repository, **When** a developer looks for project manifests, **Then** there is one, at the root
   (apart from any the mobile framework or a native module strictly requires; each such exception is listed with its
   reason).
2. **Given** the root, **When** the developer runs the documented check command, **Then** it runs the same checks as
   today (core type check and tests, desktop type check and lint, mobile type checks and tests, dependency rules) and
   all pass.
3. **Given** the reading core, **When** a file in it imports platform code (desktop host, mobile host, UI library),
   **Then** the dependency check fails, as it does today.

---

### User Story 5 - Desktop and mobile users notice nothing (Priority: P1)

People using the desktop app, and the user testing the mobile app, see no change in features, data or behaviour.

**Why this priority**: The move is internal; any regression is a failure of this feature.

**Independent Test**: The Desktop baseline check of spec 008 and a mobile smoke test, before and after the move.

**Acceptance Scenarios**:

1. **Given** the Desktop baseline from spec 008, **When** it runs after the move, **Then** every check passes and an
   existing library opens with all its books, positions and annotations.
2. **Given** a packaged desktop build, **When** it is installed and started, **Then** it starts and reads an existing
   library, as before.
3. **Given** the mobile app, **When** it is started in Expo Go after the move, **Then** the Library, import and the
   Reader work as before the move.

---

### Edge Cases

- A package needs different versions for desktop and mobile (the UI library above, or native modules built for
  different runtimes): the install may hold both versions inside the single folder, but never in a second top-level
  install folder; each such case is listed with its reason.
- Native modules built for two runtimes (the desktop's database driver is built for the desktop runtime; mobile native
  modules are built by the mobile tooling): one install must not break the other's build.
- A developer still has the old per-app folders and lock files from before the move: the documented clean-up removes
  them, and the old commands give a clear pointer to the new ones rather than a confusing error.
- Continuous integration installs from the root lock file only; a stale per-app lock file must not be used.
- Paths that external tools hard-code (desktop packaging config, mobile native project generation, the path-length
  limit on Windows found in spec 008 M5) must keep working after files move; a longer path must not reintroduce the
  Windows build failure.
- Running `npx expo start` in a sub-folder (old habit): it either works the same or tells the developer to run it at the
  root.
- The desktop app's packaged build must not include mobile-only code or dependencies, and the mobile bundle must not
  include desktop-host code.

## Requirements *(mandatory)*

### Functional Requirements

**Starting the apps**

- **FR-001**: Running `npm run dev` at the repository root MUST start the desktop app in development mode, and only
  the desktop app.
- **FR-002**: Running `npx expo start` at the repository root MUST start the mobile development server for the same
  app as today; `npm run dev:mobile` at the root MUST do the same.
- **FR-003**: One documented root command MUST start both apps together (today's root `npm run dev` behaviour).
- **FR-004**: Every command developers use today (desktop build, packaging, end-to-end tests, the spike scripts, the
  core's tests and build, mobile web build, mobile Android build, mobile tests, dependency checks, Desktop baseline)
  MUST be runnable from the repository root under a documented name. A command that is retired MUST be listed with
  its replacement.

**One install**

- **FR-005**: A single install command at the repository root MUST install everything needed by desktop, mobile and
  the reading core.
- **FR-006**: After that install there MUST be exactly one top-level dependency folder in the repository; no app or
  core folder may have its own. Versions that must differ MUST live inside that one folder, each listed with its
  reason.
- **FR-007**: The repository MUST have exactly one lock file, at the root; the other lock files MUST be removed.
- **FR-008**: The desktop app MUST move to the same major version of the UI library as the mobile app (React 19), so
  that the shared UI is installed once. Any Desktop dependency that does not support it MUST be upgraded or replaced,
  and each change MUST be recorded.

**One project**

- **FR-009**: The repository MUST have one project manifest at the root. Additional manifests are allowed only where
  the mobile framework or a native module requires one, each listed with its reason.
- **FR-010**: The UI (screens, components, stores, renderers), the reading core, the desktop host and the mobile host
  MUST each live in one clearly named folder of that project; nothing is duplicated between them.
- **FR-010a**: Platform differences in the UI MUST live in `source/app/platforms/`, one file per runtime for each
  concern (`<concern>.electron.ts` for the desktop host, `<concern>.native.ts` for the mobile WebView), selected when
  the UI is built for that host; screens and components import the concern without a runtime suffix and never test
  the platform themselves for what an adapter covers. These adapters replace today's two `window.api` wrappers
  (Desktop's `src/bridge` and Mobile's `web/src/bridge`). The mobile app keeps running the shared UI in its WebView;
  no screen is rewritten in React Native.
- **FR-011**: The reading core MUST keep its platform independence: the dependency rules of spec 008 (R1–R11) MUST
  still be enforced by an automated check that fails on a violation.
- **FR-012**: The reading core's portable bundle (the self-contained build that can be copied anywhere,
  `book-reader-sdk/dist`) MUST be dropped: both apps use the core's source, nothing outside this repository uses the
  bundle. Its build step, its package entry points and the checks that only exist for it (for example "the bundle is
  self-contained") are removed; the checks that protect the core's platform independence (FR-011) stay.
- **FR-013**: The `source/` folder MUST stay; only the project manifest, the lock file, the single install folder,
  the shared `tsconfig.json` (path aliases to `source/core` and `source/app`) and the root-level entries the tools
  require (the mobile framework's `app.json`, `metro.config.js` and similar) live at the repository root. Inside
  `source/`:
  - `source/core/` (`src/`, `tests/`): the reading core, today's `apps/book-reader-sdk`.
  - `source/app/`: the shared UI and platform adapters, today's `apps/reading-book-desktop/src`:
    `components/`, `screens/` and `platforms/` (one adapter file per runtime for each platform-specific concern, such
    as storage and window).
  - `source/app/platforms/` also holds each runtime's own code: the desktop host (today's
    `apps/reading-book-desktop/electron`: Main and Preload, workers, packaging, spikes, end-to-end tests) and the mobile
    host (today's `apps/reading-book-mobile`: React Native host, host services, the Kotlin/Swift local-server module,
    config plugins, WebView entry), with the database and file drivers of each runtime.
  - `source/core` holds the database and file logic shared by both runtimes (schema, migrations, SQL, stores,
    parsers) written against injected driver ports; it never imports a driver, a runtime or a UI library (FR-011).
  There is no `source/desktop/` or `source/mobile/` folder.
  The old folders `source/apps/*` and `source/packages/*` no longer exist once their content has moved.
- **FR-014**: Shared tool configuration (type checking, linting, test runner, path aliases) MUST be defined once
  where the tools allow it; where a host needs its own (for example the mobile host's bundler), it MUST extend the
  shared one rather than repeat it.

**Behaviour preserved**

- **FR-015**: Desktop features, stored data and the packaged desktop app MUST behave as before; the Desktop baseline
  of spec 008 MUST pass after the move.
- **FR-016**: The mobile app MUST behave as before in Expo Go and in an Android build.
- **FR-017**: The packaged desktop app MUST NOT contain mobile-only code or dependencies, and the mobile bundle MUST
  NOT contain desktop-host code.
- **FR-018**: Continuous integration MUST install from the root and run the same checks as today, all green.

**Migration and docs**

- **FR-019**: The move MUST be done in steps, each leaving the repository installable and both apps startable, so a
  failed step can be reverted on its own.
- **FR-020**: A documented clean-up MUST remove the old per-app dependency folders and lock files from a developer's
  existing checkout.
- **FR-021**: `CLAUDE.md`, the README files, the SDS and spec 008's documents that name paths or commands MUST be
  updated to the new layout and commands.

### Key Entities

- **Project manifest**: the single description of the project's dependencies and commands.
- **Install folder**: the one folder holding every installed dependency.
- **Lock file**: the single record of exact installed versions.
- **Area folder**: one of UI, reading core, desktop host, mobile host; each has rules about what it may import.
- **Command**: a named entry in the project manifest that a developer runs from the root.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a fresh clone, a developer reaches a running desktop app with 2 commands at the root (install,
  then `npm run dev`), and a running mobile development server with 2 commands (install, then `npx expo start`).
- **SC-002**: After a fresh install there is exactly 1 top-level dependency folder and 1 lock file in the repository.
- **SC-003**: 100% of the commands in the current developer documentation have a root equivalent, or are listed as
  retired with their replacement.
- **SC-004**: The installed dependencies take at least 25% less disk space than the 3.0 GB baseline measured on
  2026-11-05 (same machine, fresh install, native build output excluded from both measurements).
- **SC-005**: The Desktop baseline check of spec 008 passes with 0 removed or weakened checks, and an existing library
  opens with 100% of its books, positions and annotations.
- **SC-006**: The dependency-rule check passes, and each of its negative tests (a rule broken on purpose) still fails.
- **SC-007**: The mobile app opens in Expo Go and imports, opens and annotates a book as before the move.
- **SC-008**: Every intermediate step of the migration leaves both apps startable (checked at each step).

## Assumptions

- "One project" means one manifest, one install and one set of commands, with the UI, the reading core and the two
  hosts as folders of that project. It does not mean merging the desktop host and the mobile host into one program:
  they run on different platforms and stay two hosts of one UI (spec 008).
- The mobile framework requires its own entry and configuration at the project root (for `npx expo start` to work
  there); placing them at the root is acceptable.
- React 19 for Desktop is required by FR-008; the Desktop's own code and dependencies are assumed upgradeable, and any
  that is not is reported before the step that needs it.
- npm workspaces may still be used internally if a tool requires it, as long as FR-006, FR-007 and FR-009 hold from
  the developer's point of view.
- Desktop E2E runs only with the user's agreement, as today.
- The Android build fixes of spec 008 (short native build folder, no parallel Gradle while another IDE syncs) carry
  over.

## Out of Scope

- New features, UI changes, or changes to the mobile first-release scope of spec 008.
- iOS builds (spec 008 M6).
- Replacing Electron or Expo, or changing the stored data format.
