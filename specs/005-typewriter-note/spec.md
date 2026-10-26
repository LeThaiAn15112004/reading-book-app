# Feature Specification: Typewriter Note for PDF

**Feature Branch**: `005-typewriter-note`

**Created**: 2026-10-27

**Revised**: 2026-10-27 (full editing experience: rich text, Hand Mode editing, properties sidebar, Unicode in the file)

**Status**: Draft

**Input**: User description: "Implement the typewriter function as a kind of note in text-based books." Scope narrowed to PDF only. Revised to the complete Typewriter editing experience: text boxes with caret, move and resize, rich text (font, size, colour, bold, italic, underline, strikethrough, alignment), Hand Mode selection and editing, a right-hand properties sidebar, and reliable saving into the PDF with Vietnamese and other Unicode text.

## Clarifications

### Session 2026-10-27

- Q: In EPUB, Markdown and TXT, how should a typewriter note appear? → A: Superseded. Scope narrowed to PDF only: reflowable formats have no fixed position, so the feature is not offered there.
- Q: Is Vietnamese / Unicode text in the saved PDF optional? → A: No. It is mandatory. A note whose text cannot be written faithfully into the file is never silently dropped from the file and never silently reduced; the reader gets a clear message and the content is kept.
- Q: Which modes select a note, and how is text editing started? → A: In Select Mode one click selects a note at once. In Hand Mode a single click does not select (it stays a pan / tap on the page); a double-click selects the note. Once a note is selected (either mode), text editing starts with a double-click on it, Enter or F2 (in Select Mode a second single click also works).
- Q: Should the work be split into an "in-app first, file later" release? → A: No. Release is one coherent deliverable (see Delivery). Internal milestones exist, but nothing ships until typing, resizing, Hand Mode editing, rich text, the sidebar and saving into the file all work.

## Scope

A Typewriter note is a text box the reader places directly on a PDF page and types into. The page is fixed, so the box sits at an exact place on the page and is saved into the PDF as text that other readers can show.

| Format | Typewriter |
|--------|-----------|
| PDF | Yes |
| EPUB, Markdown, TXT | No (no fixed position; out of scope) |
| Audiobooks | No |

Out of scope: importing text boxes made by other readers into editable Typewriter notes (they stay read-only graphic objects as today), text from system-installed fonts, bullet/numbered lists, images in the box, text effects (shadow, outline), box fill or border, rotation of a box, mobile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a text box and type (Priority: P1)

A reader activates Typewriter, then either clicks a spot on a page or drags out a rectangle. A text box appears with a blinking caret. They type multi-line text, including Vietnamese with diacritics. Long lines wrap inside the box. They finish by clicking outside or pressing Escape, and the text stays where it was placed.

**Why this priority**: Without this nothing else exists.

**Independent Test**: Activate Typewriter, drag a box, type "Xin chào, đây là ghi chú tiếng Việt" plus a second line, press Escape. Close and reopen the book; the box, position and text are unchanged.

**Acceptance Scenarios**:

1. **Given** Typewriter is active, **When** the reader clicks an empty point on a page, **Then** a text box of a default width opens at that point with a caret and accepts typing at once.
2. **Given** Typewriter is active, **When** the reader drags a rectangle larger than the minimum size, **Then** the text box takes exactly that rectangle (clamped inside the page).
3. **Given** a text box is being edited, **When** the reader types text longer than a line, **Then** it wraps at the box width and the box grows taller so no text is hidden.
4. **Given** the reader types or pastes Vietnamese text (precomposed or with combining marks), **When** it is shown, **Then** every letter and diacritic is displayed correctly.
5. **Given** a new, empty text box, **When** the reader presses Escape or clicks outside, **Then** the box is discarded and no note is created.
6. **Given** a text box with text, **When** the reader presses Escape or clicks outside, **Then** the text is saved as one note, the box is deselected, and the tool stays active for the next box.
7. **Given** a click lands on an existing Typewriter note while Typewriter is active, **When** the reader clicks, **Then** that note is selected (not a new box on top of it).

---

### User Story 2 - Select, move, resize and edit in Hand Mode (Priority: P1)

In Select Mode the reader clicks a text box once to select it; in Hand Mode the reader double-clicks it to select it. Then they drags it to move it, drags its edge or corner handles to resize it, and double-clicks (or presses Enter) to edit the text. The four actions are clearly distinct and never trigger each other by accident.

**Why this priority**: A text box that cannot be corrected or repositioned is not usable.

**Independent Test**: In Hand Mode, select a saved note, move it, resize it from a corner and from an edge, double-click to edit one word, click outside; reopen the book and verify the final position, size and text.

**Acceptance Scenarios**:

1. **Given** Hand Mode or Select Mode, **When** the pointer rests over a Typewriter note, **Then** a hover outline appears.
1a. **Given** Select Mode, **When** the reader clicks the note once, **Then** it becomes selected at once (outline + 8 resize handles) and its quick toolbar appears.
1b. **Given** Hand Mode, **When** the reader clicks the note once, **Then** nothing is selected and the page behaves as it does today; **When** the reader double-clicks it, **Then** it becomes selected with the same outline, handles and quick toolbar.
2. **Given** a selected note, **When** the reader presses on its body and drags more than 4 px, **Then** the box moves with the pointer, stays inside the page, and the move is one undo step.
3. **Given** a selected note, **When** the reader drags an edge handle or a corner handle, **Then** the box resizes from that edge or corner; width and height never go below the minimum and the height never goes below what the text needs.
4. **Given** a selected note, **When** the reader double-clicks it (in Select Mode a second single click also works), or presses Enter or F2, **Then** it enters text editing with the caret at the click point (Enter: at the end).
5. **Given** a note in text editing, **When** the reader places the caret, selects a range (mouse or Shift+arrows), types, deletes, or pastes, **Then** the text changes accordingly; Ctrl/Cmd+Z undoes typing inside the session.
6. **Given** a note in text editing, **When** the reader clicks outside, **Then** the edit is committed as one undo step and the note remains selected; a second click on empty space deselects it.
7. **Given** a selected note (not editing), **When** the reader presses Delete or Backspace, **Then** the note is deleted (undoable); **When** the reader presses Escape, **Then** it is deselected.
8. **Given** a pointer press on empty page area in Hand Mode, **When** the reader drags, **Then** the page pans as before; pressing on a note never pans, and PDF text selection is not started while pressing on a note.
9. **Given** the box is resized or the font size is raised so the text no longer fits, **When** the change is applied, **Then** the box grows taller instead of cutting text; if the box cannot grow because it would leave the page, the change is refused with a short message and the text is unchanged.

---

### User Story 3 - Format text (Priority: P1)

The reader changes font family, size, colour (picker or HEX), bold, italic, underline, strikethrough and alignment (left, centre, right, justified). With a text range selected the change applies to that range; with no range it applies to the whole box. One box can mix styles, and the mix survives reopening, restart, saving into the PDF and export.

**Why this priority**: Rich formatting is part of the requested core experience.

**Independent Test**: In one box make one word bold red, another italic underlined, set the first paragraph centred; close the book, restart the app, reopen: the mix is identical. Export the PDF and compare.

**Acceptance Scenarios**:

1. **Given** text is selected in the editor, **When** the reader applies bold, **Then** only that range becomes bold; applying it again removes it; if the range is partly bold, the first click makes all of it bold.
2. **Given** the caret is collapsed in the editor, **When** the reader turns on italic, **Then** text typed next is italic, and moving the caret elsewhere discards that pending style.
3. **Given** a note is selected but not being edited (or the editor has no range), **When** the reader changes colour, font family or size, **Then** the whole box changes, replacing any per-range value of that property.
4. **Given** a HEX value such as `#1E88E5` or `1e88e5` is entered, **Then** it is accepted; an invalid value is rejected with the field marked and the previous colour kept.
5. **Given** alignment is changed, **Then** it applies to the paragraphs touched by the selection (or all paragraphs when nothing is selected); justified stretches every line except the last of a paragraph.
6. **Given** a font family has no italic or bold face, **Then** the matching control is disabled with a reason, never faked.
7. **Given** mixed formatting, **When** the book is reopened, the app restarted, or the PDF exported, **Then** every range keeps its formatting.

---

### User Story 4 - Properties sidebar (Priority: P1)

Right-clicking the Typewriter tool in the toolbar opens the reader's right sidebar in **defaults** mode: the font, size, colour and styles used by newly created boxes. Right-clicking a note (or choosing Properties in its quick toolbar) selects it and opens the same sidebar in **note** mode, showing and editing that note. Changes show immediately on the page.

**Why this priority**: It is the main way to see and change formatting precisely.

**Independent Test**: Right-click the tool, set Serif / 18 pt / blue; create a box (it uses those). Right-click a different old note: sidebar switches to it with its own values and none of the previous note's.

**Acceptance Scenarios**:

1. **Given** the sidebar is closed, **When** the reader right-clicks the Typewriter tool, **Then** the right sidebar opens in defaults mode with the current defaults, without arming or disarming the tool.
2. **Given** defaults mode, **When** the reader changes a default, **Then** it applies only to boxes created afterwards, is remembered across books and restarts, and is restored by Reset App Settings.
3. **Given** a note, **When** the reader right-clicks it, **Then** it is selected and the sidebar shows note mode with that note's values.
4. **Given** note mode with a note being edited and a range selected, **When** the reader clicks a formatting control, **Then** the on-page selection and caret are kept and the range is formatted.
5. **Given** note mode, **When** the reader selects another note, **Then** the sidebar shows the new note's values; nothing from the previous note (selection, pending style, unsaved field text) is carried over.
6. **Given** a note is selected and the sidebar is open, **When** the reader deselects the note, **Then** the sidebar returns to defaults mode.
7. **Given** the sidebar is closed with the close button or by opening another panel, **Then** all committed edits remain; an open text edit is committed first.
8. **Given** the sidebar is open, **When** the page area narrows, **Then** the selected note is scrolled into view if the sidebar would cover it.
9. **Given** note mode, **Then** the sidebar offers an "Edit text" action that puts the note into text editing on the page.

---

### User Story 5 - Saved into the PDF, readable elsewhere (Priority: P1)

Typewriter notes are written into the PDF file (when the app is allowed to write to it) and exported. Other PDF readers show the text at the same place with the same fonts, colours, styles and alignment, including Vietnamese.

**Why this priority**: The value of a fixed-page tool is that the text really is on the page.

**Independent Test**: Place a Vietnamese, multi-style note, open the file in at least two other PDF readers (checked with the compatibility kit); text, position and styling match.

**Acceptance Scenarios**:

1. **Given** a writable PDF, **When** a note is saved, **Then** the file gains the note in one incremental update and is read back and verified; the original bytes are untouched.
2. **Given** a note with Vietnamese text and mixed styles, **When** the PDF is opened in another reader, **Then** the text, diacritics, colours, bold/italic/underline/strikethrough, alignment and position are shown correctly.
3. **Given** a note's text can be selected and searched in another reader, **Then** the characters are the Vietnamese letters (not images).
4. **Given** a PDF that cannot be written (encrypted, read-only, signed without confirmation, changed by another program), **Then** the note is kept in the app, marked "not in the file", and the reason is shown.
5. **Given** a note uses a character the available fonts cannot draw, **Then** nothing is dropped: the note stays in the app, is marked "not in the file", and a message names the characters and what to do (remove them or choose another font).
6. **Given** "Export PDF with annotations…", **Then** Typewriter notes are included with the same fidelity.
7. **Given** a note is edited or deleted in the app, **Then** the file follows (two-way sync); **Given** the file's text for a note is changed by another reader, **Then** the existing conflict flow is used and the reader chooses; formatting is never half-merged.
8. **Given** undo, redo, delete or restart, **Then** no note is lost or resurrected incorrectly (same guarantees as shapes).

---

### Edge Cases

- Press near the page edge or drag outside the page: the box is clamped inside the page.
- Very long text: capped at 10 000 characters; typing past the cap is blocked with a message, existing text is kept.
- Paste: rich clipboard content is reduced to plain text with line breaks; styles from the source are not imported.
- Text with combining marks is normalised to precomposed form; a sequence with no precomposed form that the fonts cannot place correctly is treated as an unsupported character (US5-5).
- Right-to-left or complex scripts (Arabic, Indic, Thai) are not supported in v1 and are reported as unsupported characters when written to the file; they are still kept.
- Two notes overlap: the topmost (last created) is hit first; clicking a selected note keeps it selected.
- A note sits on a page with `/Rotate` or a crop box: it is displayed and written at the same visual place.
- Zoom, fit-page, continuous scroll, window resize: position, wrapping and size stay the same relative to the page.
- Switching tools while editing: the edit is committed first.
- Closing the book or quitting the app while editing: the edit is committed first.
- Existing tools (Shape, Freehand, Eraser, Highlight family, text selection, Search) keep their current behaviour.
- Signed PDFs: same confirmation rule as other annotations.

## Requirements *(mandatory)*

### Functional Requirements

**Create and edit**

- **FR-001**: The reader MUST offer a Typewriter tool in PDF books and MUST NOT offer it in any other format.
- **FR-002**: With the tool active, a click MUST create a text box at the point (default width, auto height) and a drag MUST create a text box of the dragged rectangle; both open an editor with a caret.
- **FR-003**: The editor MUST support multi-line text, wrapping at the box width, caret placement, range selection, insert, delete, copy, cut, paste (as plain text) and Vietnamese input including diacritics.
- **FR-004**: Escape or a click outside MUST commit non-empty text as one note and discard an empty new box.
- **FR-005**: Text MUST NOT be cut off: the box height MUST always be at least the height of its text; resizing or enlarging the font beyond what the page allows MUST be refused with a message and leave the text unchanged.
- **FR-006**: The box MUST stay inside its page and have a minimum size (width ≥ 4 % of the page width, height ≥ one line of its text).
- **FR-007**: Text length MUST be limited to 10 000 characters.

**Hand Mode and selection**

- **FR-008**: Hovering a Typewriter note in Hand Mode, Select Mode and while Typewriter is active MUST show a hover outline; selecting it (one click in Select Mode and with the Typewriter tool, double-click in Hand Mode) shows an outline, eight resize handles and a quick toolbar (Properties, Delete).
- **FR-009**: The four actions MUST be distinct: one click = select (Select Mode, Typewriter tool); double-click = select (Hand Mode); on a selected note, double-click (or a second single click in Select Mode), Enter or F2 = edit; in Select Mode a press on a note wins over starting PDF text selection, a press elsewhere is unchanged; press-and-drag the body of the selected note beyond 4 px = move; drag a handle = resize; double-click or Enter = edit text.
- **FR-010**: Move, resize, edit-commit, format change, create and delete MUST each be exactly one undo/redo step in the existing annotation history.
- **FR-011**: Delete/Backspace on a selected (not editing) note deletes it; Escape deselects; Enter or F2 edits.
- **FR-012**: Pressing on a note MUST NOT start page panning or PDF text selection; pressing on empty page MUST behave as today.

**Rich text**

- **FR-013**: Users MUST be able to set font family, font size, colour (picker and HEX), bold, italic, underline, strikethrough, and paragraph alignment (left, centre, right, justified).
- **FR-014**: With a selected range a change MUST apply to that range only; with a collapsed caret it MUST set the style for text typed next; with no editor range it MUST apply to the whole box.
- **FR-015**: A note MUST be able to hold different styles in different ranges, and all of it MUST persist across editing sessions, restart, reopening, sync and export.
- **FR-016**: Font families offered MUST be limited to those the app can both show and write into a PDF with Vietnamese coverage; a style the family lacks MUST be disabled with a reason.

**Sidebar**

- **FR-017**: The sidebar MUST be the existing reader right sidebar frame; opening it MUST NOT create a second sidebar implementation.
- **FR-018**: Right-click on the Typewriter tool MUST open it in defaults mode; right-click on a note (or Properties in its quick toolbar) MUST select the note and open it in note mode.
- **FR-019**: Defaults MUST apply only to new notes, persist across books and restarts, and be reset by Reset App Settings.
- **FR-020**: Formatting controls MUST NOT take the selection away from the on-page editor; changes MUST be visible on the page immediately.
- **FR-021**: Switching the selected note MUST fully refresh the sidebar; closing the sidebar MUST keep committed edits and commit an open edit first.

**Persistence, file and export**

- **FR-022**: Typewriter notes MUST persist as first-class annotations (list, jump, delete, undo) and survive restart and reopening.
- **FR-023**: For a writable PDF, notes MUST be written as one incremental update per write, with the original bytes untouched, verified by reading back.
- **FR-024**: Text in the file MUST be real text in an embedded font covering the characters used, including Vietnamese; it MUST NOT be reduced to a substitute font, dropped characters or an image.
- **FR-025**: The file MUST carry the text, position, size, per-range font, size, colour, bold, italic, underline, strikethrough and paragraph alignment so that other readers show the same result.
- **FR-026**: If a note cannot be written safely (unsupported character, font problem, ineligible file), the note MUST be kept in the app, marked "not in the file", with a message that says why and what to do; the user's content MUST never be lost.
- **FR-027**: Typewriter notes MUST take part in two-way sync and in "Export PDF with annotations…" with the same fidelity; a foreign change to a note's text MUST go through the existing conflict flow.
- **FR-028**: Compatibility with other readers MUST be stated only for readers actually tested; untested readers MUST be listed as untested.

**Consistency**

- **FR-029**: Hover, selection, handles, move, resize, delete and Escape MUST follow the conventions of the existing Shape and Ink selection (same outline/handle look, 4 px drag threshold, Escape order).
- **FR-030**: Shape, Freehand, Eraser, markup tools, PDF text selection, Search and zoom MUST show no behaviour change.

### Key Entities

- **Typewriter Note**: One text box on one page. Has plain text, a box (position and size on the page), a base text style, optional style ranges, and per-paragraph alignment.
- **Style Range**: A span of the note's text with its own overrides of font family, size, colour, bold, italic, underline, strikethrough. Spans never overlap.
- **Text Style**: Font family, size, colour, bold, italic, underline, strikethrough.
- **Typewriter Defaults**: The text style and alignment used for newly created notes; one set per reader profile.
- **Editing Session**: The period from entering text editing to commit; yields one undo step.
- **Embedded Font Face**: A font file the app ships (family + regular/bold/italic/bold-italic) used both to show and to write text.
- **Properties Target**: What the sidebar currently edits: the defaults, or one note.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can create a box, type a short Vietnamese sentence and commit in under 15 seconds from choosing the tool.
- **SC-002**: 100 % of committed notes are identical (text, ranges, position, size) after closing and reopening the book and after restarting the app.
- **SC-003**: In a test set of at least 30 Vietnamese sentences covering all tone and vowel-mark combinations, 100 % of letters and diacritics display correctly in the app and in the written file as read back by the app's own PDF engine.
- **SC-004**: For a writable PDF, every note appears at the correct place with correct text and styling in every other reader that was tested; the tested readers and results are recorded, and no reader is claimed without a recorded test.
- **SC-005**: No text is ever lost or silently truncated: in 100 % of resize, font-size and unsupported-character cases the full text remains stored and visible in the app.
- **SC-006**: Moving, resizing, editing and formatting each undo and redo in a single step in 100 % of tested cases.
- **SC-007**: After switching between at least 10 different notes and the defaults, the sidebar never shows another note's values in 100 % of tested sequences.
- **SC-008**: Existing Shape, Freehand, Eraser, markup and text-selection checks show no change in behaviour.
- **SC-009**: Written notes render within 1 px at 100 % zoom (and under 0.5 % of the page width) of the position and wrapping shown in the app for the same text and fonts.

## Assumptions

- Offered fonts are a curated set shipped with the app (initially sans, serif and monospace families with Vietnamese coverage and bold/italic faces where they exist). System-installed fonts are not offered, because they cannot be shown identically everywhere or embedded safely. The final list and licences are fixed by the font spike.
- Layout (wrapping, justification, line height) is computed by the app from the shipped fonts' metrics, with kerning and ligatures off, so that the page and the file wrap alike. A different line break in another reader's own re-layout is not expected because the file contains the already broken lines.
- Notes made or later edited by other readers are not editable here; a foreign change to the text goes through the conflict flow; formatting in the file is app-authoritative.
- Colour is opaque (no alpha); box has no fill or border.
- The Notes list shows the plain text of each note.
- "Edit text" in the sidebar starts on-page editing; there is no second text editor inside the sidebar (a deliberate simplification of "edit the annotation's text" in the sidebar, open to change).
- Right-click on the tool opens the sidebar without arming the tool; keyboard users reach the same sidebar through the Properties button in the note's quick toolbar.
- The only external reader engine already tested in this repository is Chromium's built-in PDF viewer (rendering of other annotations); Foxit, Acrobat and SumatraPDF are untested, so compatibility with them is a goal to verify, not a fact.
- Desktop only.

## Delivery

One release, with internal milestones that each have acceptance criteria, but only the last is shippable:

1. **M0 Font and writing spike (gate)**: prove an embedded Unicode font can be written and read back, and that wrapping in the app matches the file. Pass criteria in `plan.md`. No feature code ships.
2. **M1 Editing core**: creation, editor, Hand Mode selection/move/resize/edit, rich-text model, sidebar, defaults, persistence in the app, undo/redo, Notes list. Acceptance: User Stories 1–4 and the app-side half of 5 (notes kept and marked "not in the file").
3. **M2 File, sync, export**: writing, read-back, two-way sync, export, compatibility checks. Acceptance: User Story 5.

The feature is released only when M2 passes; M1 alone is not released because it would leave the core promise (text really on the page) unmet.
