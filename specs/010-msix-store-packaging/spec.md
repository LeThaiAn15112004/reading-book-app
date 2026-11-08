# Feature Specification: Microsoft Store Package for the Desktop App

**Feature Branch**: `010-msix-store-packaging` (spec directory only; no git branch was created)

**Created**: 2026-11-08

**Status**: Draft

**Input**: User description (translated from Vietnamese): "Package the Readmate Reader desktop app as an MSIX file to submit to the Microsoft Store, including: creating the app manifest, Store-standard icons, certificate signing, a release build, and a submission checklist."

## Clarifications

### Session 2026-11-08

- Q: Existing direct-build users: what happens to their data when they start the Store build (whose app data is
  stored privately per package by Windows)? → A: Offer a one-time import on first launch that copies (never moves or
  deletes) the direct build's data into the Store build (FR-014, User Story 6).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Store-ready package is produced from the repository (Priority: P1)

The maintainer runs one documented release command at the repository root and gets a Microsoft Store package of
Readmate Reader (Windows, x64). The package carries the app identity reserved in Partner Center (package name,
publisher, publisher display name), a valid Store version number, the app's display name and description, and the
declarations the app really needs (full-trust desktop app, the `readmate-reader` link used to come back from cloud
sign-in, start at login). The existing direct installer keeps being produced as before.

**Why this priority**: Without a valid package nothing can be submitted; every other story depends on it.

**Independent Test**: Run the release command on a clean clone; check that a package file appears in the release
folder, that its identity and version match the values recorded for the Store, and that the direct installer is
still produced and unchanged.

**Acceptance Scenarios**:

1. **Given** a clean clone with the Store identity values filled in, **When** the maintainer runs the Store release
   command, **Then** one Store package for x64 is produced, named with the product name and version, next to the
   direct installer.
2. **Given** the Store identity values are missing or still placeholders, **When** the release command runs,
   **Then** it stops before building, names each missing value, and produces no package.
3. **Given** a version number that the Store does not accept (for example `0.0.0`, or a fourth segment other than
   0), **When** the release command runs, **Then** it stops with a message saying which version format is required.
4. **Given** the package is produced, **When** it is inspected, **Then** it contains the bundled FFmpeg that matches
   its recorded hash, the typewriter fonts, and none of the Mobile host code (the same content rules as the direct
   installer).

---

### User Story 2 - The package installs and the app works like the direct build (Priority: P1)

Before submitting, the maintainer installs the package on a Windows 10/11 test machine (signed with a local test
certificate) and verifies that Readmate Reader behaves as the direct build does: library import (referenced files
stay in place), reading every format, PDF annotations written back into the user's own PDF, audiobooks, cloud
sign-in returning to the app, system tray / run in background, notifications and reading reminders, start at login,
and uninstall.

**Why this priority**: The Store reviews the running app; a package that installs but breaks a core feature is
rejected or ships broken.

**Independent Test**: Install the locally signed package on a machine with no previous Readmate install, follow the
documented smoke-test list, uninstall.

**Acceptance Scenarios**:

1. **Given** the test certificate is trusted on the test machine, **When** the maintainer installs the package,
   **Then** it installs without warnings, the app appears in Start with the Store icons, and it launches.
2. **Given** the installed package, **When** the user imports a local PDF from their Documents folder and adds a
   highlight, **Then** the book stays at its original path and the highlight is written into that file, exactly as in
   the direct build.
3. **Given** the installed package, **When** the user links a cloud account, **Then** the browser sign-in returns to
   the running app and the account appears as linked.
4. **Given** the installed package, **When** the user turns Start at Login on and signs out and back in to Windows,
   **Then** the app starts hidden in the tray; when the user turns it off (in the app or in Windows Settings →
   Startup), it no longer starts, and the app's toggle shows the real state.
5. **Given** the installed package, **When** the user opens Settings → Advanced → Updates, **Then** the app says that
   updates come from the Microsoft Store and does not offer or invent any other update source.
6. **Given** the installed package, **When** a reading reminder is due, **Then** a Windows notification is shown with
   the app's name and icon.

---

### User Story 3 - Store-standard icons are generated from one source image (Priority: P2)

The maintainer keeps one master app icon in the repository; the release step generates every logo the Store and
Windows need (Start tiles, taskbar / title bar sizes including the unplated variants, Store listing logo, every scale
factor) and the desktop app's own window / installer icon from it.

**Why this priority**: Missing or blurry logos are a common certification failure and make the app look unfinished,
but packaging can be tested with placeholder logos first.

**Independent Test**: Replace the master icon, rerun the icon step, check that every required logo file exists at
the exact pixel size, is not blank, and shows the new image.

**Acceptance Scenarios**:

1. **Given** the master icon (square, at least 1024 × 1024 px, transparent background), **When** the icon step runs,
   **Then** every logo required by the package is produced at its exact size and referenced by the package.
2. **Given** a master icon that is too small or not square, **When** the icon step runs, **Then** it stops and says
   why, instead of producing stretched or upscaled logos.
3. **Given** the installed package, **When** the app is pinned to Start and the taskbar in light and dark Windows
   themes, **Then** the icon is sharp and readable in both.

---

### User Story 4 - Signing for local testing, and for the Store (Priority: P2)

The maintainer can sign the package with a local test certificate whose subject matches the publisher identity, so
the package can be sideloaded for testing; the private key and its password never enter the repository or the build
logs. The package uploaded to the Store is the one the Store accepts for its own signing.

**Why this priority**: Windows refuses to install an unsigned package, so local testing (Story 2) needs it; the
Store re-signs the submission itself, so no paid code-signing certificate is required.

**Independent Test**: Create the test certificate with the documented steps, sign, install on the test machine;
search the repository and build output for the certificate file and password: neither is found.

**Acceptance Scenarios**:

1. **Given** a test certificate whose subject equals the package publisher, **When** the package is signed and
   installed on a machine that trusts it, **Then** installation succeeds.
2. **Given** a certificate whose subject does not equal the package publisher, **When** signing runs, **Then** it
   stops and reports the mismatch.
3. **Given** no certificate is provided, **When** the Store release command runs, **Then** it still produces the
   unsigned package meant for upload and says clearly that this package cannot be sideloaded.
4. **Given** the repository after signing, **When** it is searched, **Then** no certificate file, private key or
   password is tracked, and `.gitignore` covers the certificate location.

---

### User Story 5 - A submission checklist the maintainer can follow end to end (Priority: P3)

The maintainer follows one checklist in the repository from "nothing reserved" to "submitted for certification":
Partner Center account and name reservation, copying the identity values into the project, version bump, build,
local certification test (Windows App Certification Kit), smoke tests, Store listing content (description,
screenshots, privacy policy, age rating, category, pricing and markets), the justification for the restricted
full-trust capability, and the upload itself. Each item says where the answer comes from and how to check it.

**Why this priority**: The package is useless without a submission, but the checklist is documentation and can be
finished last.

**Independent Test**: A person who did not build the feature follows the checklist on a clean clone and reaches the
Partner Center "Submit for certification" step without asking anything.

**Acceptance Scenarios**:

1. **Given** the checklist, **When** each item is followed, **Then** every Partner Center field required for a
   first submission has a prepared answer or a named source in the repository.
2. **Given** the local certification test is run on the package, **When** it finishes, **Then** the result is
   recorded in the checklist, and every failure is either fixed or written down with a reason.
3. **Given** a later release, **When** the maintainer follows the "update submission" part of the checklist,
   **Then** only the version bump, build, tests, release notes and upload are needed.

---

### User Story 6 - Moving from the installer version keeps the user's library (Priority: P2)

A reader who already used the installer (direct) version of Readmate Reader installs the Store version. On its
first launch the app finds the installer version's data and offers once to bring it over. Choosing Import copies the
library, collections, annotations, reading positions, covers and preferences; the installer version keeps working with
its own data, untouched.

**Why this priority**: Without it an existing reader loses months of highlights and positions on switching, but
the package can ship and be tested for new users first.

**Independent Test**: On a test machine, use the direct build to import books, add highlights and set preferences;
install the Store package, accept the import, compare library, annotations, positions and settings; then start the
direct build and check its data is byte-for-byte unchanged.

**Acceptance Scenarios**:

1. **Given** direct-build data on the same Windows account and an empty Store build, **When** the Store build starts
   the first time, **Then** it offers Import / Start empty once.
2. **Given** the user chooses Import, **When** it finishes, **Then** every book, collection, annotation, reading
   position, cover and preference of the direct build is present in the Store build, and referenced books open from
   their original paths.
3. **Given** the import is interrupted (app closed, disk full), **When** the Store build starts again, **Then** it has
   no partial data and offers the import again.
4. **Given** the user chose Start empty, **When** the app restarts, **Then** the offer does not appear again; it can
   still be run from Settings while the Store library is empty.
5. **Given** any import, **When** the direct build is started afterwards, **Then** its data is unchanged.
6. **Given** linked cloud accounts in the direct build, **When** the import finishes, **Then** the accounts are shown
   as needing sign-in again, not silently missing.

### Edge Cases

- The Store package and the direct installer are installed on the same machine: both appear in Start under
  recognisable names, and after the one-time import (FR-014) each keeps its own data; changes in one never reach
  the other.
- A user goes from the Store build back to the direct build: no reverse import is offered; the direct build still has
  its own data from before the switch (annotations can be moved with the existing annotation import / export).
- The direct build is running while the Store build imports: the import reads a consistent snapshot or asks the user
  to close the installer version first; it never reads a half-written database.
- The direct build's data is from a newer app version (newer schema): no import, with the FR-014a message.
- Uninstalling the Store package: Windows removes the app's private data. The user's own book files (referenced) and
  PDF annotations already written into them stay untouched; the uninstall never touches files outside the package's
  own data.
- A book on a removable or network drive, or under a folder the packaged app can reach only through a picker: opening,
  relinking and PDF write-back behave as in the direct build, or fail with the existing "file unavailable" messages.
- The user disables Start at Login in Windows Settings → Startup: the in-app toggle shows "off" and cannot force it
  back on (Windows forbids it); the app says so instead of pretending.
- The `readmate-reader` link is opened while the app is closed: the app starts and finishes the sign-in, or the
  sign-in fails cleanly with the existing message.
- The bundled FFmpeg or the speech model download inside the packaged app: transcription stays behind its feature
  flag; when it is on, the FFmpeg hash check passes inside the package.
- A build on macOS / Linux or in CI on Ubuntu: the Store package step is skipped with a message (Windows-only), and
  `npm run check` stays green.
- The version is not increased between two submissions: the release command or the checklist catches it before
  upload.

## Requirements *(mandatory)*

### Functional Requirements

**Package and manifest**

- **FR-001**: The project MUST produce a Microsoft Store package (MSIX, x64) of the desktop app through one
  documented command run at the repository root, in addition to — not instead of — the existing direct installer.
- **FR-002**: The package identity (package name, publisher, publisher display name) MUST come from the values
  reserved in Partner Center, kept in one place in the repository; placeholders (including the current `YourAppID`)
  MUST make the build stop with a message naming each missing value.
- **FR-003**: The package version MUST be a Store-valid four-part version whose last part is 0, derived from one
  version source; versions the Store rejects (including the current packaged `0.0.0`) MUST stop the build. Raising
  the version MUST NOT change the user-data identity of the direct build.
- **FR-004**: The package MUST declare the app's display name ("Readmate Reader"), description, minimum supported
  Windows version (Windows 10 version 1809 or later) and language(s), and only the capabilities the app uses: the
  full-trust desktop capability, the `readmate-reader` link used by cloud sign-in, and the start-at-login task.
  No other capability is declared.
- **FR-005**: The package contents MUST follow the same rules as the direct installer: Main's entry and externals
  present, no Mobile host code, the bundled FFmpeg present and matching its recorded hash, the typewriter fonts and
  their licence files present, no OAuth secret files.

**Behaviour inside the package**

- **FR-006**: Every feature of the direct build MUST work in the packaged app, as listed in the smoke-test list
  (FR-019); where Windows packaging forces a different mechanism (start at login, sign-in link, notifications'
  identity), the user-visible behaviour MUST stay the same.
- **FR-007**: Start at Login in the packaged app MUST use the Windows mechanism for packaged apps, start the app
  hidden in the tray as today, and report the real state — including "disabled by the user in Windows Settings",
  which the app MUST show and MUST NOT try to override.
- **FR-008**: In the packaged app, Settings → Advanced → Updates MUST identify the Microsoft Store as the update
  channel; the app MUST NOT offer, download or install updates by any other route.
- **FR-009**: The reference-based library and the read-only / overlay invariant MUST be unchanged: books picked from
  the user's disk stay where they are, only the user's own PDFs receive annotation updates, and nothing is written next
  to a book file.
- **FR-010**: Uninstalling the package MUST leave the user's own book files and folders untouched.

**Icons**

- **FR-011**: One master icon in the repository (square, ≥ 1024 × 1024 px, transparent) MUST be the source of every
  logo in the package (all sizes and scale factors Windows and the Store require, including unplated taskbar sizes)
  and of the desktop window / installer icon; the generation step MUST be repeatable and refuse a master that is too
  small or not square.
- **FR-012**: The generated logos MUST be readable on both light and dark Windows themes.

**Signing**

- **FR-013**: The project MUST support signing the package with a local test certificate whose subject equals the
  package publisher, for sideload testing; a subject mismatch MUST stop signing. The certificate, its private key and
  its password MUST be supplied from outside the repository (file path and secret given at build time), MUST never be
  tracked, printed or written into build output, and the certificate location MUST be ignored by git. The package
  uploaded to the Store MAY be unsigned, since the Store signs it.

**Data continuity**

- **FR-014**: When the Store build starts with no data of its own and finds data left by the direct build on the same
  Windows account, it MUST offer once to bring that data over ("Bring over your library from Readmate Reader
  (installer version)?" with Import / Start empty). Import MUST **copy** the library database, annotations, reading
  state, covers, app-owned book copies, TXT edited copies and preferences, and MUST never move, change or delete the
  direct build's data. The import MUST be all-or-nothing: if it fails or is interrupted, the Store build starts empty
  with a message and offers the import again on the next launch. Book file references MUST stay valid (the user's own
  files are not copied; app-owned copies MUST be re-pointed to the Store build's own folder). Cloud sign-in tokens are
  NOT copied (the user signs in again), because they are protected per app. After either choice the offer MUST NOT
  appear again, except from a Settings entry that runs the same import while the Store build's library is still empty.
- **FR-014a**: Data whose schema is newer than the Store build understands MUST NOT be imported; the app MUST say
  that the installer version is newer and that the Store build has to be updated first.

**Release and submission**

- **FR-015**: The Store build MUST run only on Windows; on other systems and in the Ubuntu CI it MUST be skipped with a
  message, and `npm run check` MUST stay green.
- **FR-016**: Before the package is accepted for upload, the release process MUST run the local Windows App
  Certification Kit test on it and record the result; a failure MUST block the upload until fixed or written down with
  a reason.
- **FR-017**: The repository MUST contain a submission checklist covering: Partner Center account and name
  reservation; copying identity values; version bump; build; signing for testing; certification test; smoke tests;
  Store listing (description in each listing language, at least the required screenshots, privacy policy URL, age
  rating questionnaire, category, pricing and markets, support contact); the written justification for the
  full-trust capability; upload and submission; and the shorter "update submission" path.
- **FR-018**: The checklist MUST state the privacy facts reviewers ask about, consistent with the app's real
  behaviour: books and annotations stay on the device; the network is used only for user-started cloud sign-in /
  download, URL import, and the optional speech-model download; no telemetry.
- **FR-019**: The repository MUST contain a smoke-test list for the installed package (one line per feature: import,
  each format, PDF write-back, audiobooks, cloud sign-in, tray / background, notifications and reminders, start at
  login, updates screen, uninstall), with a place to record pass / fail per release.

### Key Entities

- **Store identity**: package name, publisher (certificate subject form), publisher display name, reserved app name —
  issued by Partner Center, stored once in the project.
- **Release version**: the single version the direct installer and the Store package are built from, in Store-valid
  four-part form.
- **Master icon**: the one source image for every logo.
- **Test certificate**: a local, untracked signing certificate whose subject equals the publisher; used only for
  sideload testing.
- **Store package**: the MSIX produced by the release command; unsigned for upload, or test-signed for sideloading.
- **Submission checklist / smoke-test record**: the documents the maintainer follows and fills in for each release.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a clean clone with the identity values filled in, one command produces the Store package and the
  direct installer, with no manual steps in between.
- **SC-002**: The local Windows App Certification Kit test on the package ends with no failed required test.
- **SC-003**: 100 % of the smoke-test list passes on a test-signed package installed on a Windows 10 or 11 machine
  that never had Readmate installed.
- **SC-004**: Every logo the package references exists at its exact pixel size; zero are upscaled from a smaller image.
- **SC-005**: Zero certificate files, private keys or passwords are found in the repository, its history added by
  this feature, or the build logs.
- **SC-006**: A person who did not build the feature reaches "Submit for certification" in Partner Center by
  following only the checklist.
- **SC-007**: The first submission passes Store certification, or every reason it was rejected is recorded in the
  checklist with the fix, and the next submission passes.
- **SC-008**: The direct installer and every existing check (`npm run check`, `check:desktop-package`,
  `check:desktop-baseline`) are unchanged and green.
- **SC-009**: After the one-time import, 100 % of the direct build's books, collections, annotations, reading
  positions and preferences are present in the Store build, and the direct build's data is unchanged (same file
  hashes before and after).

## Assumptions

- The maintainer has, or will create, a Microsoft Partner Center developer account and reserves the app name there;
  the Store identity values exist only after that, so the build works with placeholders that block it (FR-002) until
  then.
- The Store signs the submitted package with its own certificate, so no paid code-signing certificate is needed; the
  local certificate is a self-signed test certificate, for sideloading only.
- Only Windows x64 is targeted, because the bundled FFmpeg exists only for win32-x64; ARM64 and x86 are out of scope.
- The app is free, offered in all markets, with listings in English and Vietnamese; in-app purchases, Store ads and a
  trial are out of scope.
- Opening `.epub` / `.pdf` / audio files from Explorer ("Open with Readmate Reader" file associations) is not part of
  this feature, because the direct build does not offer it either.
- The 1024 × 1024 px app icon already used by the Mobile app (`source/app/platforms/native/assets/images/icon.png`) is
  the master icon unless a dedicated desktop icon is added later.
- Store-delivered updates are enough; in-app querying of pending Store updates stays out of scope (it needs a native
  Windows Store bridge, as `updates/update-service.ts` already notes).
- Existing feature flags keep their current values in the Store build (audiobook ZIP import and transcription stay
  off until their own release gates pass).
- The privacy policy page is hosted by the maintainer at a public URL; writing and hosting it is a checklist item,
  not code in this repository.
- E2E stays manual-only; the smoke tests are run by hand on the installed package.
