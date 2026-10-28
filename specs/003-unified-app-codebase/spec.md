# Feature Specification: One Codebase for Desktop and Mobile

**Feature Branch**: `003-unified-app-codebase` (spec directory only; no git branch was created)

**Created**: 2026-10-26

**Status**: Draft — awaiting three decisions (see Clarifications needed)

**Input**: User description (translated from Vietnamese): "For the current project: would it be OK to merge everything into one repository/project, instead of three separate projects under `source`? One repo; the desktop app is the main interface, and the mobile app (Android and iOS) is cloned from that desktop project."

## Current State (verified in the repository, 2026-10-26)

- It is **already one Git repository**. Under `source/` there are three npm workspaces plus one shared folder: the shared reading core (`apps/book-reader-sdk`, ~267 files, platform-neutral logic and tests), the desktop app (`apps/reading-book-desktop`, ~740 files: an Electron shell plus a React screen layer of ~370 files), a mobile app (`apps/reading-book-mobile`, ~61 files) and a small shared configuration folder (`packages/config`).
- The **mobile app is only a fresh Expo/React Native starter**: its screens and assets are the template's; none of the reader, library, audiobook or Notes features exist there. Its UI technology (native components) is **different** from the desktop's (web components in a browser engine), so desktop screens cannot be copied into it as they are.
- The desktop screens already reach the "outside world" (database, files, import, cloud, audio streaming) through one narrow bridge used by about 18 of the ~370 screen files; the rest is plain screen logic and state. The shared core already contains much of the reading logic (formats, positions, annotations, audio rules).
- Desktop-only capabilities live in the Electron shell: SQLite storage, file access and path safety, PDF/EPUB/TXT/audio importers, ZIP import, cloud sign-in, the system tray, notifications, PDF write-back and background workers.
- All current desktop features and behaviour (including audiobook Notes) are shipping-quality work that must not regress.

## Clarifications needed (answer before planning)

1. **How should the mobile app get the desktop screens?** The two realistic ways differ in cost and result: (A) wrap the *same* desktop screen layer in a phone container so Android and iOS run the same screens; (B) keep a native phone app and rebuild the screens for it, sharing only the reading core. See Question 1.
2. **What does "one project" mean to you?** One repository with one place per platform (like today, reorganised), or literally a single project folder where desktop and mobile are built from the same source tree? See Question 2.
3. **What must the first mobile release do?** See Question 3.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One place to work on the app (Priority: P1)

A developer opens the repository and finds one obvious home for the screens, one obvious home for the reading logic, and one small, clearly named place for each platform's specific code (desktop shell, phone shell). A change to a screen is made once.

**Why this priority**: It is the point of the request — less duplication and less confusion than three projects that look alike but cannot share screens.

**Independent Test**: Make a visible change to a shared screen (for example a Library label), and confirm it appears in both the desktop app and the phone app without editing a second copy.

**Acceptance Scenarios**:

1. **Given** the repository after the change, **When** a developer looks for the screens of the Library, **Then** there is exactly one copy of them.
2. **Given** a shared screen is edited, **When** the desktop app and the phone app are both run, **Then** both show the change.
3. **Given** a capability that exists on only one platform (for example the system tray on desktop), **When** a developer looks for it, **Then** it lives in that platform's own place and is not mixed into shared screens.

---

### User Story 2 - The desktop app keeps working exactly as today (Priority: P1)

Everything the desktop app does today — importing, reading PDF/EPUB/TXT, audiobooks including multi-track audiobooks and their Notes, annotations, search, cloud sources, settings, background mode — keeps working with identical behaviour and stored data after the reorganisation. No user data has to be migrated.

**Why this priority**: The desktop app is the product that exists. A restructure that breaks it has negative value.

**Independent Test**: Run the existing automated checks and open a library that was created before the change; every book, position, annotation and Note is present and behaves the same.

**Acceptance Scenarios**:

1. **Given** a library created by the current version, **When** the reorganised desktop app opens it, **Then** all books, positions, annotations, bookmarks and audiobook Notes are intact.
2. **Given** the existing automated checks, **When** they run after the reorganisation, **Then** they all pass without being weakened.
3. **Given** the build used today to produce the desktop app, **When** it runs, **Then** it still produces a working installable app.

---

### User Story 3 - The phone app runs the app on Android and iOS (Priority: P2)

A user installs the phone app on Android or iOS and sees the same app (the Library and the reader screens that are in the first mobile release), laid out for a phone, using the same logic as the desktop app.

**Why this priority**: It is the second half of the request, but it depends on the structure from Story 1 being right.

**Independent Test**: Install the phone app on an Android device and an iOS device (or their simulators), import or open a book, and confirm the first-release features in Question 3 work.

**Acceptance Scenarios**:

1. **Given** the phone app on Android, **When** it is launched, **Then** the Library appears with the same look and terminology as the desktop app, adapted to a small screen.
2. **Given** the phone app on iOS, **When** it is launched, **Then** the same screens appear and behave the same way.
3. **Given** a feature that the first mobile release does not include, **When** the user looks for it, **Then** it is absent or clearly marked unavailable, never half-working.

---

### User Story 4 - Phone-specific needs are handled properly (Priority: P2)

On a phone, things that differ from a desktop — touch input, small screens, how files are picked and stored, background audio, safe areas — are handled by the phone shell, so the shared screens do not contain "if phone" branching everywhere.

**Why this priority**: Without it, sharing the screens would trade duplication for a tangle of special cases.

**Independent Test**: Review the shared screens for platform checks; each platform difference resolves through one defined seam, not scattered conditions.

**Acceptance Scenarios**:

1. **Given** a screen needs to pick a file, **When** it runs on the desktop and on a phone, **Then** each uses its own file picker through the same call from the screen's point of view.
2. **Given** the phone is rotated or a notch is present, **When** a screen is shown, **Then** content is not hidden.

---

### User Story 5 - The two apps share the reading logic, not copies of it (Priority: P1)

Rules such as how positions are saved, how audiobook Notes are validated, and how annotations are modelled exist once and are used by both apps.

**Why this priority**: Two copies would drift, and the reading data would stop being interchangeable.

**Independent Test**: Change one shared rule (for example a Note's maximum text length) and confirm both apps follow it with no second edit.

**Acceptance Scenarios**:

1. **Given** a rule in the shared logic, **When** it changes, **Then** desktop and phone behave the same afterwards.
2. **Given** the shared logic, **When** it is tested, **Then** it needs neither the desktop shell nor a phone to run.

---

### Edge Cases

- **A desktop-only feature on a phone** (PDF write-back, system tray, background workers, ZIP import, cloud OAuth windows): it is either given a phone equivalent or explicitly excluded from the first mobile release; it never appears broken.
- **Different storage on each platform**: reading data written by the desktop app and by the phone app use the same data shape; moving data between devices is **not** part of this feature (no sync).
- **Large files on a phone**: very large audiobooks and PDFs must not exhaust memory or freeze the screen.
- **Build tooling differences**: the desktop and phone builds need different toolchains; one failing build must not prevent the other from building.
- **Developer without a Mac**: iOS builds need Apple tooling; the desktop and Android work must remain possible without it.
- **Existing unfinished work in the working tree** (uncommitted changes) must not be lost or overwritten by the reorganisation.

## Requirements *(mandatory)*

### Functional Requirements

**Structure**

- **FR-001**: The repository MUST have exactly one home for the screens and their logic that are shared by desktop and phone, with no duplicated copy.
- **FR-002**: The repository MUST have exactly one home for the platform-neutral reading logic (positions, formats, annotations, audiobook rules), used by both apps.
- **FR-003**: Capabilities that exist on only one platform MUST live in that platform's own place and MUST NOT be mixed into shared screens.
- **FR-004**: The structure MUST be understandable from the repository's top-level layout and its guidance file, without reading build scripts.

**Desktop**

- **FR-005**: The desktop app MUST keep every feature and behaviour it has today, with identical stored data and no migration.
- **FR-006**: Every existing automated check MUST still pass and MUST NOT be weakened or removed to make the reorganisation pass.
- **FR-007**: The desktop app MUST still be buildable into the same kind of installable package as today.

**Phone**

- **FR-008**: A phone app for Android MUST exist and be installable from the repository's build instructions.
- **FR-009**: A phone app for iOS MUST exist and be installable from the repository's build instructions.
- **FR-010**: The phone app MUST present the first-release features chosen in Question 3 using the shared screens, adapted to a phone-sized, touch-driven layout.
- **FR-011**: Features outside the first mobile release MUST be absent or clearly marked unavailable.
- **FR-012**: Phone-specific differences (files, storage, touch, safe areas, background audio) MUST be isolated in the phone shell behind the same calls the shared screens already use.

**Data and boundaries**

- **FR-013**: Reading data written by either app MUST use the same shape, so the same book data could be read by the other.
- **FR-014**: This feature MUST NOT add cloud sync, accounts or any transfer of data between devices.
- **FR-015**: This feature MUST NOT change any user-visible behaviour of the desktop app other than what is needed to make screens shareable.
- **FR-016**: Work already present in the working tree MUST NOT be lost, reverted or overwritten.

### Key Entities

- **Shared screens**: the Library, reader and audiobook screens and their state, written once.
- **Reading core**: platform-neutral rules and models (already largely present).
- **Platform shell**: the part that talks to the operating system for one platform (desktop shell, Android shell, iOS shell).
- **Platform bridge**: the single set of calls the shared screens use to reach storage, files, import and audio; implemented once per platform.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A change to a shared screen reaches both the desktop app and the phone app with exactly one edit (0 duplicated copies of any shared screen).
- **SC-002**: 100% of the automated checks that pass today still pass after the reorganisation, with none removed or weakened.
- **SC-003**: A library created before the change opens in the reorganised desktop app with 100% of books, positions, annotations and Notes intact.
- **SC-004**: The phone app installs and starts on both Android and iOS and completes the first-release task list (Question 3) with no crash.
- **SC-005**: A developer new to the repository can name where the shared screens, the reading logic and each platform's code live after reading only the top-level layout and the guidance file.
- **SC-006**: Platform checks inside shared screens are limited to the single bridge: 0 scattered "if phone/desktop" conditions outside it.

## Assumptions

- **Already one repository**: "merge into one repo" is interpreted as *reorganise the existing single repository*, because it is already one Git repository with several packages inside; this is flagged in Question 2.
- **No sync, no accounts, no export** are introduced (consistent with earlier features).
- **Data compatibility, not data transfer**: the two apps use the same data shape; moving data between devices is out of scope.
- **Desktop remains the primary product** and keeps shipping; the phone app grows from it.
- **iOS needs Apple tooling**; this is a build-environment fact, not a feature requirement.
- **Dependencies**: relies on the existing shared reading core and the existing desktop feature set.

---

## Questions (3)

## Question 1: How does the phone app get the desktop screens?

**Context**: "the phone app is cloned from the desktop project", FR-001, FR-010. Today the desktop screens are web-style components; the existing phone starter uses native components, which cannot reuse them.

**What we need to know**: [NEEDS CLARIFICATION: reuse the same desktop screens inside a phone container, or rebuild screens natively for phones?]

| Option | Answer | Implications |
|--------|--------|--------------|
| A | Reuse the same screens in a phone container (Android + iOS) | One set of screens (matches "clone from desktop"); about 370 screen files reused; the 18 bridge files need a phone version; look and feel is "web in an app", heavy features (PDF/EPUB rendering, audio) must be re-proven on phones. The existing native starter is replaced. |
| B | Keep a native phone app and rebuild screens natively | Truly native feel; **screens are written twice** (desktop and phone), only the reading core is shared; a much larger build; contradicts "clone from desktop". |
| C | Reuse screens for most areas, native screens only where a phone needs them | Best of both, most complex to organise and test. |
| Custom | Describe your own answer | |

## Question 2: What does "one project" mean?

**Context**: "gộp thành 1 repo duy nhất, không tách 3 project", FR-001–FR-004. The repository is already single; what you have are three packages inside it.

**What we need to know**: [NEEDS CLARIFICATION: keep one repository with a clear folder per concern, or flatten everything into one single package?]

| Option | Answer | Implications |
|--------|--------|--------------|
| A | One repository, reorganised: shared screens + shared core + one small folder per platform shell | Keeps the safe separation (desktop and phone toolchains do not collide), removes the duplication. Recommended direction. |
| B | One single package/folder for everything | Simplest to look at, but desktop and phone toolchains (different build tools and dependency sets) are forced into one install and one build; higher risk of breaking the desktop build. |
| Custom | Describe your own answer | |

## Question 3: What must the first phone release do?

**Context**: FR-010, FR-011, SC-004. The desktop app has far more than a phone needs on day one.

**What we need to know**: [NEEDS CLARIFICATION: which features must the first Android/iOS release include?]

| Option | Answer | Implications |
|--------|--------|--------------|
| A | Library + reading EPUB/TXT + audiobooks (single and multi-track, with Notes) | Core reading experience; PDF annotations, ZIP import, cloud, tray excluded. |
| B | Library + audiobooks only | Smallest first release, fastest to prove the approach. |
| C | Everything the desktop has | Very large; includes features that do not map to phones. |
| Custom | Describe your own answer | |
