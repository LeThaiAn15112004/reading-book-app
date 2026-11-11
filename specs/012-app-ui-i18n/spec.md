# Feature Specification: App interface in Vietnamese and English (i18n)

**Feature Branch**: `012-app-ui-i18n`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: "hiện tại app đã có chức năng i18n (chuyển ngữ) chưa, nếu chưa, bạn hãy làm nhé" (does the app
already have i18n — switching the interface language? If not, please build it)

## Context (current behaviour)

The app has **only the setting, not the translation**:

- Settings → Appearance has an **App Language** choice with three options: *System Default*, *Tiếng Việt*,
  *English*. It is saved with the other appearance preferences and *System Default* resolves to Vietnamese when the
  device language starts with `vi`, otherwise English.
- The choice only changes the document's declared language. **Every visible text stays in English**: menus,
  toolbars, Library, Reader, Audiobook player, Settings, dialogs, error messages, empty states, tooltips.
- Texts produced outside the window — the system tray menu, native open / save dialogs, desktop notifications and
  Reading Reminders — are also English only and ignore the setting.
- Dates, times, durations, file sizes and numbers are formatted in one fixed way regardless of the setting.

This feature makes the existing App Language setting actually translate the interface. The two languages are the
ones already offered: Vietnamese and English. Book content is never translated by it (that is the Reader's
Translate tool, spec 011).

## Clarifications

### Session 2026-11-11

- Q: Must the first release translate the whole app at once, or may it ship screen by screen with English on the
  rest? → A: Built screen by screen, but released only when 100 % of interface texts (main window, tray, dialogs,
  notifications) have Vietnamese; the completeness check fails — not warns — on any missing text.
- Q: Should app terms (Library, Highlight, Note, Bookmark…) be fully Vietnamese or keep some English? → A: Fully
  Vietnamese, following one fixed glossary; brand and format names (Readmate, EPUB, PDF, MP3…) unchanged; neutral,
  concise tone without addressing the user as "bạn".
- Q: Should the readable Markdown export's fixed headings follow the app language or always be English? → A: Follow
  the app language active at export time (e.g. "Chương 3", "Trang 12"); no language picker in the export dialog.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use the whole app in Vietnamese (Priority: P1)

A Vietnamese reader opens Settings → Appearance, picks *Tiếng Việt*, and from that moment every screen they use —
Library, Reader (all formats), Audiobook player, Settings, Import, every dialog and message — shows Vietnamese text.
The change happens at once, without restarting the app and without losing the open book or the current position.

**Why this priority**: This is the feature. Without it the existing setting is a promise the app does not keep.

**Independent Test**: Switch to Tiếng Việt, walk through each screen and its menus, dialogs and messages; no English
interface text remains (except the allowed exceptions in FR-009). Switch back to English; no Vietnamese remains.

**Acceptance Scenarios**:

1. **Given** the app is in English with a book open in the Reader, **When** the user picks Tiếng Việt in Settings
   and returns to the Reader, **Then** the toolbar, sidebars, menus and panels are in Vietnamese and the book is still
   open at the same position.
2. **Given** the language is Tiếng Việt, **When** the user triggers any confirmation dialog (e.g. remove a book,
   delete an annotation), **Then** its title, message and buttons are in Vietnamese.
3. **Given** the language is Tiếng Việt, **When** an operation fails (e.g. a book file is missing, an import is
   refused), **Then** the message the user sees is in Vietnamese and still states the same reason as the English one.
4. **Given** the language is Tiếng Việt, **When** the user hovers a toolbar button or reads an empty state ("no books
   yet", "no notes"), **Then** the tooltip / empty-state text is in Vietnamese.
5. **Given** the user picked a language, **When** the app is closed and opened again, **Then** it starts directly in
   that language (no flash of the other language on the first screen).

---

### User Story 2 - "System Default" follows the device (Priority: P2)

A user who never touched the setting gets the interface in their device's language: Vietnamese on a Vietnamese
system, English on any other.

**Why this priority**: Most users never open Settings; the first impression should already be in their language.

**Independent Test**: With the setting on System Default, start the app on a device set to Vietnamese and on one set
to another language (e.g. French); the first is Vietnamese, the second English.

**Acceptance Scenarios**:

1. **Given** a fresh install on a device whose language is Vietnamese, **When** the app starts, **Then** the
   interface is in Vietnamese and the setting shows *System Default*.
2. **Given** a device language that is neither Vietnamese nor English, **When** the app starts with System Default,
   **Then** the interface is in English.
3. **Given** System Default is selected, **When** the user explicitly picks English, **Then** the explicit choice
   wins over the device language from then on.

---

### User Story 3 - Texts outside the window follow the language (Priority: P2)

The system tray menu, the native file pickers / save dialogs the app opens, desktop notifications and Reading
Reminder notifications use the chosen language too.

**Why this priority**: A Vietnamese interface with an English tray menu and English reminders looks unfinished, but
these surfaces are seen less often than the main window.

**Independent Test**: With Tiếng Việt chosen, open the tray menu, open "Add file", export annotations (save dialog),
and wait for a Reading Reminder; all texts the app supplies are Vietnamese.

**Acceptance Scenarios**:

1. **Given** the language is Tiếng Việt, **When** the user opens the tray menu, **Then** its items are in Vietnamese.
2. **Given** the user changes the language while the app runs in the background, **When** they open the tray menu
   next, **Then** it is already in the new language (no restart).
3. **Given** the language is Tiếng Việt, **When** a Reading Reminder fires, **Then** its title and body are Vietnamese.
4. **Given** the language is Tiếng Việt, **When** the app opens a file picker or save dialog, **Then** the dialog
   title, button label the app sets and file-type names are Vietnamese (buttons drawn by the operating system itself
   keep the OS language).

---

### User Story 4 - Dates, numbers and sizes look native (Priority: P3)

Dates ("added on…", last read), times, durations, percentages, counts and file sizes are written the way the chosen
language writes them, and counted words read naturally ("1 book" / "3 books"; Vietnamese has no plural form).

**Why this priority**: Correct but secondary polish; untranslated formats are readable, untranslated words are not.

**Independent Test**: Compare the Library details, Settings → Storage and the Audiobook player in both languages;
date order, decimal separator and unit words follow the language.

**Acceptance Scenarios**:

1. **Given** the language is Tiếng Việt, **When** the user views a book's added date, **Then** it is shown in
   Vietnamese order (day / month / year) with Vietnamese month wording where words are used.
2. **Given** the language is English, **When** a count is 1, **Then** the singular form is used; when it is 0 or more
   than 1, the plural form.
3. **Given** either language, **When** a file size like 1.5 MB is shown, **Then** the decimal separator follows that
   language (1,5 MB in Vietnamese).

---

### Edge Cases

- **A text is missing in Vietnamese** (e.g. a newly added message): the English text is shown instead — never an
  empty label, an internal key or a placeholder.
- **Texts with values inside** (book title, count, file name, page number): the value is inserted at the right place
  for each language's word order; a book title containing characters like `{`, `<` or `%` is shown literally.
- **User content is never translated**: book titles, authors, genres, collection names, note text, file names and
  book content stay exactly as stored, in either language.
- **Longer Vietnamese labels**: buttons, tabs, menus and narrow sidebars do not clip or overlap at the minimum window
  width and on the phone layout; long labels wrap or truncate with the full text available on hover.
- **Language changed while a dialog or panel is open**: the open dialog may keep its current language until it is
  closed; everything opened afterwards uses the new language. Nothing in progress (import, transcription, save) is
  interrupted.
- **Reset App Settings**: resets the language to System Default along with the other appearance preferences, and the
  interface switches immediately.
- **Built-in reader messages coming from engines or the operating system** (e.g. a text the OS speech voice or a
  system error provides): shown as received; the app's own wrapper text around them is translated.
- **Keyboard shortcut names** (Ctrl, Shift, key letters) stay as printed on the keyboard; their descriptions are
  translated.
- **Mobile app**: it runs the same interface, so it follows the same setting; on the phone, System Default follows the
  phone's language.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The App Language setting MUST change every interface text the app itself supplies in the main window —
  Library, Reader for every format, Audiobook player, Settings, Import, splash / loading screens, menus, toolbars,
  sidebars, tooltips, accessible labels, dialogs, confirmations, notifications inside the window, empty states and
  error messages — to the chosen language.
- **FR-002**: Supported languages MUST be Vietnamese and English; English is the reference language and is complete.
- **FR-003**: A language change MUST take effect immediately, without restarting the app, without reloading the open
  book and without losing unsaved work or the reading / listening position.
- **FR-004**: The app MUST start in the saved language with no visible switch from another language on the first
  screen.
- **FR-005**: *System Default* MUST resolve to Vietnamese when the device language is Vietnamese and to English
  otherwise, re-evaluated at each start.
- **FR-006**: The system tray menu, the titles / labels / file-type names the app supplies to native open and save
  dialogs, desktop notifications and Reading Reminder notifications MUST use the chosen language, and MUST follow a
  language change without a restart.
- **FR-007**: When a text has no translation in the chosen language, the English text MUST be shown; an internal key
  or empty text MUST never be shown to the user.
- **FR-008**: Texts containing values (names, counts, page numbers, sizes) MUST place the values correctly for each
  language and MUST use the correct singular / plural form where the language has one.
- **FR-009**: User content and data MUST NOT be translated: book content, titles, authors, genres, collections,
  notes, comments, file names, language names shown as their own native name (e.g. "Tiếng Việt", "English"), and the
  contents of exported files' user data.
- **FR-010**: Dates, times, durations, numbers, percentages and file sizes shown in the interface MUST be formatted by
  the conventions of the chosen language.
- **FR-011**: Error messages MUST keep the same meaning in both languages; the underlying reason a feature reports
  (e.g. "file missing", "file not writable") MUST be the same regardless of language — only its wording changes.
- **FR-012**: Fixed headings the app writes into files it generates for the user to read (e.g. the readable Markdown
  copy of annotations) MUST use the language active at export time; the restorable annotations file MUST stay
  language-independent so a file exported in one language imports in the other. The export dialog offers no separate
  language choice; a file exported in English and one exported in Vietnamese differ only in those fixed headings and
  labels (e.g. "Chapter 3" / "Chương 3", "Page 12" / "Trang 12"), never in the user's quotes or comments.
- **FR-013**: The layout MUST remain usable in both languages at the minimum supported window width and on the phone
  layout: no clipped, overlapping or hidden controls.
- **FR-014**: The Mobile app MUST follow the same setting and show the same translations as Desktop for the shared
  interface.
- **FR-015**: The project MUST have an automated check that fails when an English interface text has no Vietnamese
  counterpart, or when a Vietnamese entry no longer matches any English one, so new features cannot ship untranslated
  silently. The check is part of the project's standard quality gate and is a hard failure (not a warning); the
  feature is released only when it passes for every surface in FR-001 and FR-006. Work may be merged screen by screen
  before that: the check accepts only an explicit, written list of areas still pending (covered meanwhile by the
  English fallback, FR-007), and the release requires that list to be empty.
- **FR-016**: Vietnamese texts MUST be fully Vietnamese and use ONE glossary of app terms (e.g. Library → Thư viện,
  Highlight → Tô sáng, Note → Ghi chú, Bookmark → Dấu trang, Collection → Bộ sưu tập), the same term on every screen;
  brand, product and file-format names (Readmate, EPUB, PDF, TXT, Markdown, MP3…) stay unchanged. The tone is neutral
  and concise: the user is not addressed as "bạn" in every sentence.
- **FR-017**: The Reader's Translate tool (source / target languages) and the speech / transcription languages MUST
  remain independent of the App Language setting.

### Key Entities

- **App Language preference**: the user's choice — System Default, Vietnamese or English. Already exists; this
  feature gives it effect. Reset by Reset App Settings.
- **Effective language**: the concrete language used for the interface (Vietnamese or English), derived from the
  preference and, for System Default, the device language.
- **Interface text catalogue**: for each language, the set of interface texts keyed by a stable identifier, including
  values to insert and plural forms. English is the complete reference; Vietnamese must cover it.
- **Glossary**: the fixed English → Vietnamese mapping of app terms (FR-016) that every Vietnamese text follows.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With Tiếng Việt chosen, a walk-through of every screen, menu, dialog and message in the Desktop app finds
  0 English interface texts outside the allowed exceptions (FR-009, keyboard key names).
- **SC-002**: 100 % of English interface texts have a Vietnamese translation at release (verified by the check in
  FR-015).
- **SC-003**: Switching language updates the visible interface in under 1 second, with the open book, its position and
  any in-progress job unchanged.
- **SC-004**: On 10 consecutive cold starts with a saved language, the first screen never shows the other language.
- **SC-005**: Tray menu, file dialogs the app opens, and Reading Reminders appear in the chosen language in 100 % of
  checks after a language change, without restart.
- **SC-006**: At the minimum window width and on the phone layout, 0 controls are clipped or overlapping in either
  language.
- **SC-007**: App start time does not increase by more than 5 % because of the feature.

## Assumptions

- Only Vietnamese and English are in scope (the two already offered). Adding a third language later should only
  require a new catalogue, but no third language is delivered now.
- English is the source language: developers write texts in English first; Vietnamese is provided for every English
  text in this feature (machine-assisted drafts are acceptable but reviewed by a Vietnamese speaker).
- The preference keeps its current storage and key; existing users keep their saved choice. No database change.
- Texts drawn by the operating system itself (standard OS dialog buttons, OS permission prompts) follow the OS
  language and are out of scope.
- Store listing, privacy policy, installer, documentation and developer-facing logs are out of scope; only the running
  app's interface is translated.
- Internal error codes passed between parts of the app stay in English / code form; only what is shown to the user is
  translated.
- Right-to-left languages are out of scope.
- Desktop is the primary target; Mobile gets the translations through the shared interface, and its native-host
  texts (if any) are translated where they exist.
