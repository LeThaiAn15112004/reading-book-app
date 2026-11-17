# Feature Specification: Mobile Settings screen layout (shell only)

**Feature Branch**: `014-mobile-settings-layout`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "tôi cần cải thiện giao diện màn setting ở mobile, chỉ là khung thôi" (improve the look of
the Settings screen on the phone app — only the frame / shell of the screen, not the content of each section).

## Context (current behaviour)

The phone app runs the same Settings screen as the desktop app, with phone adjustments (spec 008):

- The screen is split in two: a narrow **icon-only rail** of sections on the left (always collapsed on the phone, no
  labels, no way to expand it) and the section's content on the right, under a desktop-style header (section title +
  one-line description).
- The phone shows four sections: **Appearance, Privacy, Advanced, About** (Storage, Notifications and Keyboard
  Shortcuts are hidden, never disabled).
- The app's bottom tab bar (Library, Collections, Reading, Settings) is always visible below the screen.
- The section opened last in the session is opened again when the user comes back to Settings; it always starts on
  Appearance after a launch.

On a phone this shell is hard to use: the icons alone do not say what each section is, the rail takes width from the
content, tap targets are small, and there is no phone-style "list → detail" navigation. The Library screen was already
reworked as a proper phone screen (spec 013); Settings now needs the same treatment for its **frame**.

**Scope of "frame"**: how the user finds and moves between sections — the section list, the section page header, the
back navigation, spacing / grouping / safe areas and the visual style shared with the Mobile Library — **plus the shared
building blocks every section is made of** (group card, setting row with a switch, action button, destructive action
button, secondary text), which the frame brings up to phone standards on the phone only. The controls **inside** each
section (theme picker, accent colours, language, reset, clear data, about details…) are NOT redesigned, added, removed
or reordered by this feature; they are shown inside the new frame through those shared building blocks.

## Clarifications

### Session 2026-11-17

- Q: Does the frame also fix the shared building blocks all sections use (group card, switch row, destructive button),
  or must section content stay strictly untouched? → A: The frame owns the shared building blocks and brings them to
  phone standards on the phone only (whole switch row tappable, ≥ 48 dp targets, destructive actions always shown as
  destructive, secondary text ≥ 12 px); no control is added, removed or reordered inside a section. Section-specific
  issues (accent picker popover, About rows) stay out of scope for a later feature.
- Q: On a wide screen (phone in landscape or tablet, ≥ 900 px), list → detail or a two-pane layout? → A: Always list →
  detail; on wide screens the list and the section pages are limited to about 640 px wide and centred.
- Q: Are the dialogs opened from a section (Clear Data, Reset App Settings) part of the frame on the phone? → A: Yes,
  as shared building blocks: they stay centred dialogs, but on the phone their buttons are ≥ 48 dp, each choice row is
  tappable over its whole width, and the destructive button always looks destructive. No bottom sheet.
- Q: Is moving between the list and a section page animated? → A: A short directional slide (about 200–250 ms): a section
  slides in from the right, Back slides it out to the right; instant when the system asks for reduced motion; a tap or
  Back during the slide acts at once.
- Q: After leaving Settings from a section page (another tab) and coming back, list or that section? → A: Always the
  section list (also after a launch).
- Q: How should the Density option (Settings → Appearance) be handled on the phone? → A: Hidden on the phone (a stated
  exception to FR-011); the phone frame uses fixed phone sizes and ignores the density setting; the saved value is kept
  for Desktop, and Desktop is unchanged. Applying density to the whole app is not part of this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a setting from a readable list (Priority: P1)

A reader taps **Settings** in the bottom tab bar and sees a full-width list of the available sections, each row with
an icon, the section name and a short description, so they know where to go without guessing what an icon means.

**Why this priority**: This is the entry point of the whole screen; without a readable list the rest of the frame has
no value.

**Independent Test**: Open the phone app, tap Settings → a titled list with one row per visible section (icon + name +
description + a "go" chevron) fills the width; no icon rail is shown.

**Acceptance Scenarios**:

1. **Given** the phone app on any screen, **When** the user taps the Settings tab, **Then** a "Settings" page title and
   the list of visible sections (Appearance, Privacy, Advanced, About, in that order) are shown, each with its icon,
   name and short description.
2. **Given** the Settings list, **When** the user looks at it, **Then** no section that is hidden on the phone
   (Storage, Notifications, Keyboard Shortcuts) appears, and no disabled row is shown in its place.
3. **Given** the Settings list is taller than the screen (large text size), **When** the user scrolls, **Then** only
   the list scrolls; the bottom tab bar stays fixed.

---

### User Story 2 - Open a section and come back (Priority: P1)

The reader taps a row; the section opens as its own full-width page with a header that shows the section name and a
back button. Back (header button or the phone's system Back) returns to the list.

**Why this priority**: Opening and leaving a section is the core of the list → detail pattern; together with Story 1 it
is the MVP.

**Independent Test**: Tap "Appearance" → full-width Appearance page with a header (back + title); tap back → the list;
repeat with the Android system Back button.

**Acceptance Scenarios**:

1. **Given** the Settings list, **When** the user taps a row, **Then** that section's existing content is shown on a
   full-width page whose header shows a back control and the section name.
2. **Given** a section page, **When** the user taps the header back control, **Then** the Settings list is shown again,
   scrolled to where it was.
3. **Given** a section page on Android, **When** the user presses the system Back button, **Then** the Settings list is
   shown (the app is not left and no other screen is opened).
4. **Given** the Settings list on Android, **When** the user presses the system Back button, **Then** the app behaves
   as it does today when Back is pressed on a top-level tab.
5. **Given** a section page, **When** the user changes a setting and goes back, **Then** the change is kept exactly as
   it is today (the frame does not change how or when settings are saved).

---

### User Story 3 - A Settings screen that looks like the rest of the phone app (Priority: P2)

The Settings list and section pages use the same phone look as the Mobile Library (colours, header style, spacing,
rounded grouped rows, safe areas), in the app's light and dark themes and with the chosen accent colour.

**Why this priority**: Consistency matters, but the screen is usable once Stories 1–2 work.

**Independent Test**: Switch between light / dark themes and two accent colours; compare the Settings list and a
section page with the Library header and tab bar.

**Acceptance Scenarios**:

1. **Given** the dark (or light) theme, **When** the user opens Settings, **Then** the list, its header and the section
   pages use the same theme colours and header style as the Mobile Library.
2. **Given** a phone with a notch / gesture bar, **When** Settings is shown, **Then** no content sits under the status
   bar, the notch or the tab bar, and the tab bar is not covered.
3. **Given** the user changes the accent colour inside Appearance, **When** they go back to the list, **Then** the list
   uses the new accent colour right away.

---

### User Story 4 - Same screen in both languages (Priority: P3)

Every text of the new frame (page title, row descriptions, back control's accessible name) follows the app interface
language (English / Tiếng Việt).

**Independent Test**: Switch App Language to Tiếng Việt → the list title, row names / descriptions and back control are
in Vietnamese; switch back → English.

**Acceptance Scenarios**:

1. **Given** App Language = Tiếng Việt, **When** the user opens Settings, **Then** every text of the list and section
   headers is Vietnamese, following the project's Vietnamese glossary.

### Edge Cases

- **Long names / large system text**: a section name or description that does not fit on one line wraps (at most two
  lines for the description) instead of being cut off mid-word or overflowing the row; the header title truncates with
  an ellipsis.
- **Section content wider than the phone** (e.g. a wide control inside Advanced): the page never scrolls sideways; the
  content fits the width.
- **Dialogs opened from a section** (Reset App Settings, Clear Data): they still open as centred dialogs above the page
  and the tab bar, and system Back closes the dialog first, before leaving the section. On the phone they follow the
  shared building-block standards (FR-014).
- **Leaving Settings from a section page** (tapping another tab) and coming back: the user returns to the Settings
  list, not to the section page.
- **Only one visible section** on some future build: the list still shows (one row); it never jumps straight into the
  section.
- **Rotation / very small phones (320 px wide)**: the list and section pages stay usable without horizontal scrolling.
- **Wide screens (phone in landscape, tablet, ≥ 900 px)**: still list → detail (no two-pane layout); the list and the
  section pages are limited to about 640 px wide and centred, the header and tab bar keep the full width.
- **Fast repeated taps / Back during the slide**: the last action wins; the screen never ends between two pages or
  shows a section page under the list.
- **Density already set to Compact (or Comfortable) on the phone before this change**: the phone ignores the stored
  value and shows its fixed phone sizes; the Density option no longer appears, and the stored value is not reset.
- **Desktop**: nothing changes — the desktop Settings keeps its sidebar (expand / collapse) and content panel.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On the phone app, Settings MUST open on a **section list** page: a page title ("Settings") and one row per
  section visible on the phone, in the existing section order.
- **FR-002**: Each row MUST show the section's icon, its name, a short description of what it contains, and a forward
  indicator; the whole row MUST be the tap target, at least 48 × 48 dp high.
- **FR-003**: The phone app MUST NOT show the icon-only section rail any more; the list and the section pages use the
  full screen width.
- **FR-004**: Tapping a row MUST open that section on its own page with a header containing a back control (with an
  accessible name) and the section name; the section's content is the existing content, unchanged.
- **FR-005**: The header back control and the Android system Back button MUST both return from a section page to the
  section list; system Back MUST first close an open dialog of the section.
- **FR-006**: Returning to the list MUST keep the list's scroll position. Opening the Settings tab (from another tab
  or after a launch) MUST always show the section list, never the last section page.
- **FR-007**: Only the page body MUST scroll; the page header (title / back) and the app's bottom tab bar MUST stay
  fixed, and content MUST respect the device safe areas.
- **FR-008**: The frame MUST use the same phone visual language as the Mobile Library (theme colours, header style,
  spacing, grouped rounded rows) and follow the current theme (light / dark) and accent colour, updating immediately when
  they change.
- **FR-009**: Every text of the frame MUST come from the app's interface-language catalogue in English and Vietnamese;
  no literal interface text.
- **FR-010**: Sections hidden on the phone MUST stay hidden (not shown as disabled rows).
- **FR-011**: The frame MUST NOT change what any setting does, where it is stored, or when it is saved, and MUST NOT add,
  remove or reorder controls inside a section. Changing the look and touch size of the shared building blocks
  (FR-014) is allowed; changing a single section's own layout is not. Sole exception: the Density option is hidden on
  the phone (FR-017).
- **FR-012**: The desktop Settings screen MUST be unchanged (layout, sidebar collapse preference, behaviour).
- **FR-013**: The section pages MUST never scroll horizontally at widths down to 320 px.
- **FR-014**: On the phone app, the shared building blocks used by every section MUST meet phone standards: a setting
  row with a switch MUST be tappable over the whole row (label included) and at least 48 dp high; action buttons MUST be
  at least 48 dp high; a destructive action (e.g. Clear Data, Reset App Settings) MUST look destructive at rest (not
  only on hover) with its text at ≥ 4.5:1 contrast in every theme; secondary text MUST be at least 12 px. The
  confirmation dialogs opened from a section are shared building blocks too: they stay centred dialogs, with buttons at
  least 48 dp high and each choice row (e.g. a Clear Data checkbox and its label) tappable over its whole width. The
  desktop look of these building blocks MUST be unchanged.
- **FR-015**: The phone app MUST use the list → detail navigation at every screen width (no two-pane layout); at widths
  of 900 px and above, the list and section page content MUST be limited to about 640 px wide and centred.
- **FR-016**: Opening a section MUST slide its page in from the right and going back MUST slide it out to the right, in
  about 200–250 ms; when the system's reduced-motion setting is on, the change MUST be instant. The slide MUST never
  block input: a tap or Back during it takes effect immediately and leaves the screen in the right final state.
- **FR-017**: The phone app MUST NOT show the Density option in Appearance, and the phone frame and shared building
  blocks MUST use fixed phone sizes that do not change with the density setting. The stored density value MUST be left
  as it is (Desktop keeps using it), and the Desktop Density option MUST be unchanged.

### Key Entities

- **Settings section**: an existing group of settings (Appearance, Privacy, Advanced, About on the phone) with an icon,
  a name, a short description and its existing content. This feature adds no new data; the descriptions are the
  existing per-section descriptions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can name what each Settings section contains from the list alone (without opening it)
  for 4 of 4 sections.
- **SC-002**: From the Settings tab, a user reaches any section in 1 tap and returns to the list in 1 tap or 1 system
  Back press, 100 % of the time.
- **SC-003**: On a 360 × 800 phone and on a 320 px-wide phone, no Settings page scrolls horizontally and no row text
  overflows its row, in both languages and both themes.
- **SC-004**: Every tap target of the frame (rows, back control) and of the shared building blocks (switch rows, action
  and destructive buttons, dialog buttons and dialog choice rows) measures at least 48 dp high on the phone.
- **SC-005**: Every setting behaves exactly as before the change (same values kept after changing a setting, leaving
  and reopening the app), checked for all controls in the four phone sections.
- **SC-006**: The desktop Settings screen shows no visible or behavioural difference.

## Assumptions

- "Chỉ là khung thôi" is read as: rework the screen's shell, navigation and the shared building blocks of every
  section (see Clarifications); each section's own controls and layout are kept as they are (a later feature may
  redesign them one by one, starting with the accent colour picker popover and the About rows). The Density option is
  the one exception: it is hidden on the phone (FR-017).
- Phone navigation pattern is the usual list → detail (as in iOS / Android system settings), not tabs or an
  accordion.
- Confirmed (Clarifications): when the user leaves Settings from a section page (another tab) and comes back, Settings
  opens on the list. After a launch it also opens on the list (today it opens on Appearance).
- Row descriptions reuse the existing per-section descriptions (already translated); new texts are only the page title
  if needed and the back control's accessible name.
- The section icons are the existing section icons.
- Only the Mobile host is in scope; iOS follows when the iOS app exists, with the same rules (system Back = swipe-back
  gesture is not required in this release).
- No advertising, no new settings and no new sections are part of this feature.
