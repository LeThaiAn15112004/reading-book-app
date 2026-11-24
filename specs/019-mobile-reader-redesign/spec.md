# Feature Specification: Phone reader — a reading screen made for the phone

**Feature Branch**: `019-mobile-reader-redesign`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "specify cho mình" — turn the UI/UX review of the phone reading screen (2026-11-23: "rất chắp vá
tạm bợ") into a feature (Vietnamese description, summarised).

## Context (current behaviour)

The phone reader (spec 008, first release) is a thin shell around the same reading engine as the computer: the engine is
solid, the screen around it was built as a minimum. The review found:

- **No swipe to turn pages.** Pages turn only with two invisible tap strips along the left / right edges (14 % of the
  width each, from 18 % to 82 % of the height) and ‹ › buttons in the bottom bar. The strips sit over the text, so a
  long press to select text near an edge turns the page instead, and they get in the way of panning a zoomed PDF.
- **Android Back leaves the book while a panel is open.** Contents, Bookmarks / Notes, Appearance and the mark panel do
  not close on Back (the phone Library and Settings screens do).
- **Bars cover the text and pop in / out.** Both bars are shown when a book opens, cover the first and last lines, and
  appear / disappear with no transition. The bottom bar has two rows (‹ slider % › and Contents / Notes / Aa), about
  110 px plus the system area. In Markdown / TXT the bars hide on scroll and can only come back with a tap on a narrow
  margin.
- **The Appearance panel is the computer's panel in a sheet.** It shows keyboard-shortcut hints (Ctrl + = …), offers a
  1-page / 2-page layout, has 36 px controls and 11 px titles, and has no theme (Night / Sepia / Paper) choice — the
  theme can only be changed in the app's Settings.
- **Text glyphs instead of icons**: ‹ › − + and "Aa" are characters; Contents / Notes / Aa are text-only; the bookmark is
  an icon of another style.
- **Marking text takes two steps**: after selecting, "Mark" must be pressed before the colours appear.
- **Little sense of place**: the top bar shows only the book title; the bottom bar a percentage. No chapter name, no
  page or time left in the chapter.
- **Small defects**: releasing the progress slider outside it loses the jump; arrow keys on the slider jump on every
  press; the toast is placed at a fixed 64 px.
- **Placeholder chapter names in real books**: the "current chapter" of an EPUB is taken from the reader's demo content
  ("Dynamic Systems", …) instead of the book's own contents, so a bookmark can be saved under a chapter name the book
  does not have. The computer's reader shares the same lookup.
- **The screen is the computer's reader with features switched off** (code review, 2026-11-24): one 670-line screen
  passes empty actions to the computer's editing / undo / translation hooks, repeats a per-format choice (EPUB / PDF /
  Markdown / TXT) in at least seven places (progress, place label, marks list, jump, open a mark, selection), opens a
  mark's panel by handing it a fake on-screen position, and keeps the bars / panels / toast as unrelated local states,
  so there is no single place where Back, auto-hide or the layer order can be decided.

## Clarifications

### Session 2026-11-24

- Q: What does the Appearance panel show for a PDF, whose font, size and spacing cannot change? → A: Only Theme + Zoom
  (fit width, −, +); zoom leaves the top bar.
- Q: In scrolling books (PDF, Markdown, TXT, EPUB scroll view), what does a tap near the left / right edge do? → A: No
  edge zones there; a tap anywhere not on a link or mark shows / hides the bars; reading moves only by scrolling.
- Q: What may a TXT book do on the phone after the fix — marking, bookmarks? → A: Marking in one step like the other
  formats (colour, underline, strike, note); no text editing; no bookmark button.
- Q: Does the phone Appearance panel offer EPUB "Page" vs "Scroll", and which is the default? → A: Yes; "Page" (swipe)
  is the default, "Scroll" is the alternative; the choice is per book, as today.
- Q: What does the bottom bar show next to the slider in each format? → A: EPUB: chapter name · "page x/y in chapter"
  (% while still counting); PDF: outline entry (if any) · "page x/y"; Markdown: current heading (if any) · %; TXT: book
  title · %. No "time left".

The reading screen after this feature, per format (summary of the requirements below; the requirements govern):

| | EPUB — Page (default) | EPUB — Scroll | PDF | Markdown | TXT |
|---|---|---|---|---|---|
| Opens | text, bars hidden | text, bars hidden | page, bars hidden | text, bars hidden | text, bars hidden |
| Move on | swipe; tap edge strip of the page | scroll | scroll; pinch zoom | scroll | scroll |
| Bars toggle | tap middle third | tap anywhere | tap anywhere | tap anywhere | tap anywhere |
| Top bar | Back · title · bookmark | Back · title · bookmark | Back · title · bookmark | Back · title · bookmark | Back · title |
| Bottom bar place | chapter · page x/y in chapter | chapter · % | outline entry · page x/y | heading · % | title · % |
| Contents | book contents | book contents | outline (if any) | headings | — (button hidden) |
| Aa panel | theme, size, font, spacing, margins, Page/Scroll | same | theme, zoom | theme, size, font, spacing, margins | theme, size, font, spacing, margins |
| Marking | one step | one step | one step (text) | one step | one step (no editing) |
| Back | closes the top layer, then leaves the book | same | same | same | same |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Back always does the expected thing (Priority: P1)

A reader with a panel open (Contents, Bookmarks / Notes, Appearance, a mark's panel, the text-selection bar) presses
Android Back (button or gesture): the panel closes and the book stays open. With nothing open, Back leaves the book as
today.

**Why this priority**: today Back throws the reader out of the book in the middle of a task; it is the most frequent
irritation and the cheapest to fix.

**Independent Test**: open each panel and press Back; the panel closes, the reading position is unchanged; press Back
again; the Library appears.

**Acceptance Scenarios**:

1. **Given** the Contents panel is open, **When** the reader presses Back, **Then** the panel closes and the book stays
   on the same page.
2. **Given** a mark's panel is open over the Notes panel, **When** Back is pressed twice, **Then** first the mark's panel
   closes, then the Notes panel, then (third press) the book is left.
3. **Given** text is selected and the selection bar is shown, **When** Back is pressed, **Then** the selection is
   cleared and the bar disappears.
4. **Given** nothing is open, **When** Back is pressed, **Then** the book is left exactly as today (position saved).

---

### User Story 2 - Turn pages by swiping (Priority: P1)

In a paginated book (EPUB in page view) the reader swipes left / right to go to the next / previous page; the page
follows the finger and settles. Taps near the edges still turn pages, but never steal a long press meant for text
selection. Books read by scrolling (PDF, Markdown, TXT, EPUB in scroll view) keep vertical scrolling.

**Why this priority**: swiping is the default way to read on a phone; without it the reader feels unfinished.

**Independent Test**: open an EPUB in page view, swipe through 20 pages both ways, select text near both edges, open a
PDF and zoom / pan near the edges.

**Acceptance Scenarios**:

1. **Given** a paginated EPUB, **When** the reader swipes left past a small threshold, **Then** the next page appears;
   a short or mostly vertical move does not turn the page.
2. **Given** the reader long-presses a word near the left or right edge, **When** the press is held, **Then** text is
   selected and no page turn happens.
3. **Given** a zoomed PDF, **When** the reader drags near an edge, **Then** the page pans; nothing turns.
4. **Given** the first / last page, **When** the reader swipes past it, **Then** the page springs back and nothing else
   happens.
5. **Given** the system asks for reduced motion, **When** a page is turned, **Then** it changes without a sliding
   animation.

---

### User Story 3 - Bars that stay out of the way (Priority: P2)

The book opens straight to the text with the bars hidden. A tap in the middle of the page shows them with a short fade;
another tap, a page turn or a few seconds without interaction hides them. The bottom bar is one slim row: the chapter
name (or heading) and the place in it, the progress slider, and three icon buttons (Contents, Notes,
Appearance). The text is never under a bar the reader did not ask for.

**Why this priority**: the reading area is the product; today a fifth of the screen is chrome when the bars show.

**Independent Test**: open a book (no bars), tap the middle (bars fade in), wait (they fade out), turn a page (they hide),
check that the bottom bar is one row and shows the chapter and place.

**Acceptance Scenarios**:

1. **Given** a book is opened, **When** its first page appears, **Then** no bar covers it.
2. **Given** the bars are hidden, **When** the reader taps the middle third of the page, **Then** both bars fade in
   within 200 ms; **When** they tap there again or turn a page, **Then** they fade out.
3. **Given** the bars are shown and nothing is touched for 4 seconds, **When** no panel or selection is open, **Then**
   they fade out.
4. **Given** the bars are shown, **When** the reader looks at the bottom bar, **Then** it shows the current chapter name,
   the place in it (as FR-010a gives per format) and the progress slider in one row, plus three
   icon buttons with their names for screen readers.
5. **Given** a Markdown / TXT book scrolled with the bars hidden, **When** the reader taps anywhere on the text that is
   not a link or mark, **Then** the bars show (not only on the margin).
6. **Given** the reader drags the progress slider and releases anywhere on the screen, **Then** the book goes to the
   released place once; arrow keys move the slider without jumping on every press.

---

### User Story 4 - Appearance made for the phone (Priority: P2)

The Appearance panel offers what a phone reader changes while reading: theme (Night / Sepia / Paper), font size, font,
line spacing and margins, each with controls at least 48 dp tall. Computer-only items (keyboard hints, 1 / 2-page
layout) are not shown. Changes apply live behind the panel.

**Why this priority**: changing to a dark theme at night is a frequent need that today requires leaving the book.

**Independent Test**: open Appearance on an EPUB, change theme, size, font, spacing; check the page behind updates and no
computer-only item is shown.

**Acceptance Scenarios**:

1. **Given** Appearance is open, **When** the reader picks Sepia, **Then** the whole app (bars, panels, page) switches
   to Sepia at once and stays so after leaving the book (the same setting as Settings → Appearance).
2. **Given** Appearance is open, **When** the reader looks at it, **Then** no keyboard-shortcut hint and no 1 / 2-page
   choice is shown; every control is at least 48 dp tall and every label at least 12 px.
3. **Given** the reader changes the font size, **When** the panel is open, **Then** the page behind re-lays out and the
   reading position is kept.

---

### User Story 5 - Marking text in one step and a consistent look (Priority: P3)

When the reader finishes selecting text the colour bar appears at once (no "Mark" first). Every control of the reader
uses vector icons from one icon style.

**Why this priority**: polish that makes the reader feel finished; the functions already exist.

**Independent Test**: select text in EPUB, PDF, Markdown and TXT and mark it with one tap; check every bar / panel control
for vector icons.

**Acceptance Scenarios**:

1. **Given** the reader lifts the finger after selecting text, **When** the selection is stable, **Then** the colour bar
   (colours, underline, strike, note, copy) appears within 300 ms.
2. **Given** any bar or panel of the reader, **When** it is shown, **Then** its controls use vector icons of the app's
   icon style (no ‹ › − + "Aa" characters), each with an accessible name.

---

### User Story 6 - The chapter shown is the book's own chapter (Priority: P1)

Wherever the reader names "the current chapter" — the bottom bar, a new bookmark's label, the Contents panel's current
entry — the name comes from the book's own contents (EPUB table of contents / section, PDF outline, Markdown heading).
A book without such a name shows its progress instead; a made-up name is never shown or saved.

**Why this priority**: today a bookmark can be stored with a wrong chapter name; it is wrong data, not only wrong
display, and Story 3's chapter name in the bottom bar depends on it.

**Independent Test**: open an EPUB with a table of contents, go to its third chapter, add a bookmark; its label is that
chapter's title. Open a book with no contents; the bookmark is labelled by its place (page / percentage).

**Acceptance Scenarios**:

1. **Given** an EPUB whose table of contents names the current section, **When** the reader adds a bookmark, **Then**
   the bookmark's label is that section's title, on the phone and on the computer.
2. **Given** a part of an EPUB that no contents entry names (e.g. the cover), **When** the reader adds a bookmark,
   **Then** the nearest preceding contents entry is used, else the book's place (percentage).
3. **Given** a PDF with an outline, **When** the bottom bar shows, **Then** it names the outline entry of the current
   page; without an outline it shows "page x of y".
4. **Given** bookmarks already saved with a placeholder chapter name, **When** they are listed, **Then** they still open
   at their place (their label is not rewritten silently).

### Edge Cases

- A swipe that starts as a text selection (long press) never turns the page; a swipe that starts on a mark opens nothing.
- A swipe while a panel or the selection bar is open closes / ignores — it never turns a page under a panel.
- Back while the opening screen is shown leaves the book (spec 017 behaviour unchanged).
- Back while a dialog of a panel is open (e.g. the confirmation to delete a mark) closes that dialog first.
- A book without chapters: the bottom bar shows the book's progress instead of a chapter name.
- Pages not known yet (still counting): the bottom bar shows the percentage until they are, never "page 0".
- Landscape phone and small phones (360 px wide): the single-row bottom bar keeps every control ≥ 44 dp; the chapter name
  truncates with an ellipsis.
- Theme changed in the reader while another screen is open in the background: every screen follows (one setting).
- TalkBack: the bars are reachable even while hidden (a "Show reading controls" control at the top of the reading order).

## Requirements *(mandatory)*

### Functional Requirements

**Back (Story 1)**

- **FR-001**: Android Back MUST close, in order, the innermost open layer of the phone reader — a panel's dialog, the
  mark panel, a bottom panel (Contents, Bookmarks / Notes, Appearance), the text-selection bar — before it leaves the
  book; with none open it leaves the book as today.
- **FR-002**: Closing a layer with Back MUST NOT change the reading position or the bars' visibility.

**Page turns (Story 2)**

- **FR-003**: In a paginated EPUB a horizontal swipe longer than a threshold (and more horizontal than vertical) MUST
  turn to the next / previous page, the page following the finger during the swipe and settling after it; past the
  first / last page it springs back.
- **FR-004**: A long press (text selection) or a touch that starts on a mark or link MUST NOT turn a page; swipes MUST be
  ignored while a panel, the selection bar or the opening screen is shown.
- **FR-005**: Edge taps MUST keep turning pages in paginated books, through tap handling on the page itself (not
  elements laid over the text), so long presses near the edges select text and a zoomed PDF pans.
- **FR-006**: Scrolling books (PDF, Markdown, TXT, EPUB scroll view) MUST keep vertical scrolling; swipes do not turn
  pages there, and they have NO edge tap zones: a tap anywhere that is not on a link or a mark shows / hides the bars
  (FR-008); the progress slider and Contents remain the jump controls.
- **FR-007**: With reduced motion requested, page turns MUST change without sliding.

**Bars (Story 3)**

- **FR-008**: A book MUST open with the bars hidden; a tap in the middle third of a paginated page (anywhere on plain
  text in a scrolling book) toggles them; a page turn, a scroll in a scrolling book, or 4 s without interaction (no
  panel or selection open) hides them. In a scrolling book (FR-006) a tap anywhere on the page that is not a link or a
  mark toggles them.
- **FR-009**: Showing / hiding the bars MUST use a fade of at most 200 ms (none with reduced motion) and MUST NOT move or
  re-lay out the text.
- **FR-010**: The bottom bar MUST be one row: chapter name, place in it (per format, FR-010a) and the progress slider, with Contents, Notes and Appearance as icon buttons (≥ 44 dp, accessible names).
  The top bar keeps Back, the book title and the bookmark (PDF zoom moves to Appearance, FR-013).
- **FR-010a**: The place shown next to the slider MUST be, per format: **EPUB** — the chapter name (FR-018) and "page
  x / y in chapter" (the book percentage while pages are still being counted); **PDF** — the outline entry of the current
  page when the PDF has an outline, and "page x / y" of the book; **Markdown** — the current heading when there is one,
  and the book percentage; **TXT** — the book title and the book percentage. No "time left" is shown in this release.
- **FR-011**: The progress slider MUST go to the released place exactly once, wherever the finger is lifted; keyboard
  changes go to the place after the key is released, not on every repeat.
- **FR-012**: Toasts MUST be placed below the top bar's actual height (or the top of the safe area when the bars are
  hidden).

**Appearance (Story 4)**

- **FR-013**: The phone Appearance panel MUST offer theme (Night / Sepia / Paper — the app's one theme setting), font
  size, font family, line spacing and margins; it MUST NOT show keyboard hints or the 1 / 2-page layout. It shows only
  controls that take effect in the open format: for a **PDF** it shows Theme and Zoom (fit width, −, +) only, and the
  PDF zoom control is removed from the top bar. For an **EPUB** it also offers the view: "Page" (paginated, swipe
  turns, FR-003) — the default for a book with no saved choice — or "Scroll" (FR-006); the choice is stored per book
  like the other reading settings and switching keeps the reading position.
- **FR-014**: Every control in the panel MUST be at least 48 dp tall, labels at least 12 px; changes apply live and keep
  the reading position.

**Marking and look (Story 5)**

- **FR-015**: When a text selection ends (finger lifted, selection stable), the colour bar MUST appear directly, without
  a separate "Mark" step, in EPUB, PDF, Markdown and TXT.
- **FR-015a**: A TXT book on the phone MUST allow marking (highlight colour, underline, strike, note), opening a mark's
  panel, changing and deleting a mark, stored as on the computer (the same TXT mark rows, saved with the book's text
  revision). The text itself stays read-only (no editing, undo / redo) and TXT has no bookmark button.
- **FR-016**: Every control of the phone reader's bars, panels and selection bar MUST use vector icons of the app's icon
  style with accessible names; no text glyph is used as an icon.

**Chapter names (Story 6)**

- **FR-018**: The current chapter's name MUST come from the open book's own contents (EPUB contents / section, PDF
  outline, Markdown heading), falling back to the place (page x of y, else percentage); the reader's demo content MUST
  NOT be used for any real book, on the phone or the computer.
- **FR-019**: New bookmarks MUST be labelled with that name; existing bookmarks keep their stored label and place.

**One reading screen for the phone (structure, all stories)**

- **FR-020**: The phone reader MUST describe the open book's surface (EPUB / PDF / Markdown / TXT) in ONE place that
  answers, for the open format: its marks and their store, the place and progress, how to jump to a mark, how to open a
  mark's panel and the current selection. Screen code MUST NOT repeat a per-format choice for these.
- **FR-021**: The phone reader's chrome state (bars shown / hidden, the open layer stack, the inactivity timer, the
  toast) MUST live in one session-only state holder per open book, which Back (FR-001), auto-hide (FR-008) and swipes
  (FR-004) all consult. It is reset when another book is opened.
- **FR-022**: The phone reader MUST NOT pass empty stand-in actions for features it does not offer (editing, undo / redo,
  translation, insert point, keyboard shortcuts); the shared reading engine MUST let those be absent, with the
  computer's reader unchanged.
- **FR-023**: A mark's panel MUST be opened by the mark's identity alone, the same way for every format; no fake
  on-screen position is passed to place a phone panel.

**Accessibility (all stories)**

- **FR-017**: While the bars are hidden, a screen-reader user MUST be able to reach a "Show reading controls" control as
  the first item of the reading order; page turns MUST be available as named controls in the bottom bar's reading order.

### Key Entities

- **Reader chrome state**: bars shown / hidden, the open layer stack (panel, mark panel, selection bar), the inactivity
  timer — session-only, per open book.
- **Place in chapter**: chapter name, page x of y (when pages are known), book percentage — per format as FR-010a; no time
  left in this release. The chapter name comes from the
  book's own contents (FR-018).
- **Reading surface**: the open book's format-specific answers — marks, place / progress, jump to a mark, open a mark,
  selection — given once for EPUB, PDF, Markdown and TXT (FR-020).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With any panel or the selection bar open, Back closes it in 100 % of tries and never leaves the book.
- **SC-002**: In a paginated EPUB, 20 swipes in a row turn exactly 20 pages; 20 long presses near the edges select text
  and turn no page.
- **SC-003**: On opening a book, 0 lines of the first page are covered by a bar.
- **SC-004**: With the bars shown, the bottom bar takes at most 64 dp plus the system gesture area (today about 110 dp).
- **SC-005**: Changing the theme takes 2 taps from the page (Appearance → theme), without leaving the book.
- **SC-006**: Marking a selected passage takes 1 tap after the selection (today 2).
- **SC-007**: No text glyph is used as an icon in the phone reader; every control is ≥ 44 dp (panel controls ≥ 48 dp).
- **SC-008**: 0 bookmarks created after this feature carry a chapter name the book does not contain (checked on 5 EPUBs
  and 3 PDFs with contents / outlines).
- **SC-009**: The phone reader screen makes the per-format choice in exactly one place (the reading surface), and passes
  0 empty stand-in actions to the shared engine.

## Assumptions

- Scope: the **phone** reader (Mobile host, `MobileReaderScreen` and its components); the computer's reader is not
  changed, except shared pieces a fix needs (e.g. the selection bar's timing) when Desktop behaviour stays the same.
- Swipe page turns are for paginated EPUB only; PDF stays one continuous vertical scroll on the phone (as today).
  Whether a swipe can be told from a selection on real WebViews (risk R2 of spec 008) is verified on a device first.
- The theme in the reader's Appearance panel is the app's single theme setting (Settings → Appearance), not a per-book
  one.
- "Time left" is not in this release (FR-010a): it would rest on a default reading speed; a later feature may add it.
- Search, read aloud, translation and annotation tools stay out of the phone reader (spec 008 first-release scope),
  except TXT text marking (FR-015a), which this feature adds: the phone's TXT bridge today only opens text read-only, so
  saving TXT marks needs the phone side of the TXT save (marks only, no text revision change).
- The 4 s auto-hide and the 200 ms fade are defaults that may be tuned during the plan.
- Story 6 and FR-022 are the scope exceptions on the computer's side: the chapter-name lookup is shared, so the
  computer's bookmarks also get the book's own chapter names; making stand-in actions optional must leave the
  computer's reader behaving exactly as today.
- The structure requirements (FR-020 – FR-023) come first in the plan: Back, auto-hide and swipes (Stories 1–3) are
  built on the one chrome state holder and the one reading surface, not added to the current screen.
