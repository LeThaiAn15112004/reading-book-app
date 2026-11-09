# Feature Specification: Translate in every text format

**Feature Branch**: `011-translate-all-text-formats`

**Created**: 2026-11-09

**Status**: Draft

**Input**: User description: "chức năng translate phải có tác dụng ở tất cả các định dạng text" (the Translate feature must work in every text format)

## Context (current behaviour)

The Reader opens four text formats: EPUB, PDF, TXT (editable plain text) and Markdown. Translation has two entry
points:

1. **Selection menu → "Translate"** (right-click / selection menu on selected text). Present on all four formats.
2. **Translate tool on the Reader toolbar** ("Translate mode": every finished selection opens the translation panel
   with no extra click). Today it only works on EPUB:
   - PDF: the tool is not offered at all.
   - TXT and Markdown: the tool is shown, but finishing a selection does not open the translation panel.

Also, on PDF, TXT and Markdown the selection carries no language, so the source language always starts from a fixed
default instead of the book's language.

This feature makes both entry points behave the same in all four text formats. Audiobooks are not text formats and are
not covered.

## Clarifications

### Session 2026-11-09

- Q: While the Translate tool is on in a TXT book, should the user still be able to edit the text? → A: No — the text
  is read-only while Translate mode is on (select and scroll still work); turning the tool off makes it editable again.
- Q: If the user picks a book's source language by hand, should the app remember it the next time that book is
  opened? → A: Yes — remembered per book and reused every time that book is opened, in every text format (EPUB
  included).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Translate mode works in TXT and Markdown (Priority: P1)

A reader opens a TXT or Markdown book, turns on the Translate tool and selects a sentence. The translation panel opens
with that sentence translated, exactly as it does in an EPUB. Each new selection replaces the previous one. Turning the
tool off (or pressing Escape) goes back to normal selection.

**Why this priority**: The tool is already visible in these formats but does nothing — that is a broken feature the
user can see today. Fixing it is the smallest change with the most visible value.

**Independent Test**: Open a TXT book and a Markdown book, turn on Translate, select text; the panel opens and shows a
translation. Works without any PDF change.

**Acceptance Scenarios**:

1. **Given** a Markdown book is open and the Translate tool is on, **When** the user finishes selecting a phrase,
   **Then** the translation panel opens with that phrase as the source text and starts translating.
2. **Given** a TXT book is open and the Translate tool is on, **When** the user selects text in the text area,
   **Then** the translation panel opens for that text and the text itself is not changed.
3. **Given** Translate mode is on and the panel shows a translation, **When** the user selects a different phrase,
   **Then** the panel shows the new phrase and the previous request is cancelled.
4. **Given** Translate mode is on, **When** the user presses Escape or turns the tool off, **Then** the mode ends and the
   next selection behaves as an ordinary selection (selection menu, no automatic panel).
5. **Given** Translate mode is on in a TXT book, **When** the user clicks without making a selection or presses a key
   that would type or delete, **Then** no translation panel opens and the text does not change (the text is read-only
   while Translate mode is on).
6. **Given** Translate mode was on in a TXT book, **When** the user turns it off, **Then** the text is editable again
   immediately, with no reload.

---

### User Story 2 - Translate mode on PDF (Priority: P2)

A reader of a PDF turns on the Translate tool from the toolbar and selects text on the page's text layer. The
translation panel opens for the selected text.

**Why this priority**: PDF readers can already translate from the selection menu, so this is a convenience gap rather
than a broken tool, but PDF is a main format and should match EPUB.

**Independent Test**: Open a PDF with a text layer, the toolbar offers Translate; turn it on and select text; the panel
opens with a translation.

**Acceptance Scenarios**:

1. **Given** a PDF with selectable text is open, **When** the user looks at the Reader toolbar, **Then** the Translate
   tool is offered in the same place and with the same label as in an EPUB.
2. **Given** the Translate tool is on in a PDF, **When** the user selects text across one or more lines (or across two
   pages), **Then** the panel opens with the selected text in reading order.
3. **Given** the Translate tool is on in a PDF, **When** the user picks a markup, ink, shape, typewriter or
   file-attachment tool, **Then** Translate mode turns off (only one tool is active at a time), as in EPUB.
4. **Given** a scanned PDF page with no text layer, **When** Translate mode is on and the user drags on the page,
   **Then** no panel opens and nothing else breaks.

---

### User Story 3 - Sensible source language in every format (Priority: P3)

When translation starts from a PDF, TXT or Markdown book, the source language starts from the book's language (from its
metadata when known), not from a fixed default. The user can still change the source language by hand; that choice is
remembered for that book and used again every time the book is opened, in every text format (EPUB included).

**Why this priority**: The translation already runs; a wrong starting source language only costs one extra click to fix,
but it makes non-EPUB formats feel second-class.

**Independent Test**: Open a non-English PDF / TXT / Markdown book whose language is known, translate a selection; the
source language shown is the book's language.

**Acceptance Scenarios**:

1. **Given** a PDF whose metadata names its language, **When** the user translates a selection, **Then** the source
   language starts as that language.
2. **Given** a TXT or Markdown book with no known language, **When** the user translates a selection, **Then** the
   source language starts from the same default as an EPUB with no language, and the user can change it.
3. **Given** the user has picked the source language by hand, **When** they translate another selection in the same
   book, **Then** their choice is kept.
4. **Given** the user picked a source language by hand for a book and closed it, **When** they open that book again
   (after a restart too) and translate a selection, **Then** the source language starts as their choice, even if the
   book's metadata names another language.
5. **Given** the user picked a source language for book X, **When** they open book Y, **Then** book Y starts from its
   own remembered choice, or its metadata language, or the default — never from book X's choice.

---

### Edge Cases

- A selection longer than the translation limit (20,000 characters today): refused with the same "Selection is too
  long" message in every format, as in EPUB; nothing is truncated.
- An empty or whitespace-only selection: no panel opens.
- A selection that is only part of a Markdown code block, table cell or link text: the selected characters are
  translated as plain text; markup symbols that are not displayed are not included.
- TXT book opened read-only (text too large to edit): Translate mode and the selection menu still work.
- A PDF selection across two pages: the text from both pages is joined in reading order.
- Translate mode on, then the user switches to another book (any format): the mode and the panel close, as today.
- Translation model not yet downloaded or the device offline: same download prompt and same errors as in EPUB.
- Mobile host: translation is not offered on Mobile in the first release; this feature does not change that.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Reader MUST offer the Translate toolbar tool in every text format: EPUB, PDF, TXT and Markdown.
- **FR-002**: When Translate mode is on, finishing a non-empty text selection in any text format MUST open the
  translation panel for exactly the selected text, with no extra click.
- **FR-003**: The selection menu's "Translate" action MUST remain available and open the same panel in every text
  format.
- **FR-004**: Translate mode MUST end the same way in every format: turning the tool off, pressing Escape, choosing
  another exclusive tool, or leaving / switching the book.
- **FR-005**: Translate mode MUST never change the book content. In TXT the text MUST be read-only while Translate
  mode is on (selecting and scrolling still work; typing, deleting, pasting and cutting do nothing; no revision is
  saved) and editable again as soon as the mode ends. In PDF it must not create annotations or write to the file.
- **FR-006**: A new selection while the panel is open MUST replace the source text and cancel the earlier request, in
  every format.
- **FR-007**: The starting source language MUST be, in this order: the source language the user last chose by hand for
  that book; else the book's language when the app knows it from metadata; else the existing default. This applies to
  every text format (EPUB included).
- **FR-007a**: A source language chosen by hand MUST be remembered per book and survive closing the book and
  restarting the app. Choosing a target language does not change it. Removing the book from the library removes it.
  It MUST NOT affect any other book.
- **FR-008**: The translation panel, its language choices, model download, progress, errors, read-aloud of the result,
  panel position and size MUST be the same in every format (one shared panel, not one per format).
- **FR-009**: The text sent for translation MUST be the text the user sees as selected, in reading order (PDF: text
  layer order; Markdown: rendered text, not raw markup).
- **FR-010**: Where a format cannot provide selectable text (for example a PDF page without a text layer), Translate
  mode MUST simply not open the panel, without an error.
- **FR-011**: Translation MUST remain fully on the device, as today: enabling it for more formats MUST NOT send book
  text anywhere.
- **FR-012**: The EPUB behaviour MUST stay unchanged.

### Key Entities

- **Translation selection**: the selected text plus an optional language hint; the same shape for every format.
- **Book language**: the language from the book's metadata, when known; used as the starting source language when the
  user has not chosen one for that book.
- **Remembered source language**: the source language the user last chose by hand for one book; belongs to that book,
  persists across sessions, takes precedence over the book language.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In each of the four text formats, turning on Translate and selecting a phrase opens the translation panel
  in 100% of attempts on text that can be selected (checked on at least one sample book per format).
- **SC-002**: The steps to translate a selection with the Translate tool on are the same in all four formats: select →
  panel opens (one action, zero extra clicks).
- **SC-003**: After a translation with Translate mode on in a TXT book, the book's saved text is byte-identical to before
  (no revision created).
- **SC-004**: For a book whose language is known, the source language shown at the first translation matches it in
  every format.
- **SC-006**: After choosing a source language by hand, closing the book and restarting the app, the first translation
  in that book starts with the chosen language in 100% of attempts, in every text format.
- **SC-005**: No regression in EPUB: every existing EPUB translation check still passes.

## Assumptions

- "Text formats" means the formats the Reader shows as text today: EPUB, PDF, TXT, Markdown. Audiobooks (and their
  transcripts) are out of scope.
- Desktop only. Mobile keeps translation hidden in its first release (existing gating); bringing translation to Mobile
  would be a separate feature.
- The existing on-device translation engine, models, language list and panel are reused as they are; no new language
  or engine is added.
- Translating annotation comments, typewriter notes, the table of contents or search results is out of scope; only text
  selected in the book's page/text surface.
- Whole-page or whole-book translation is out of scope; translation stays per selection.
- When a format has no language in its metadata (typical for TXT / Markdown), automatic language detection is not
  added; the existing default and the user's manual choice are used.
