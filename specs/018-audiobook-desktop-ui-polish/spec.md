# Feature Specification: Audiobook player on Desktop — readable, keyboard-friendly, part of the system

**Feature Branch**: `018-audiobook-desktop-ui-polish`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "hãy cho tôi task mới về giao diện audio book desktop mà ui ux pro max đã preview nhé" — turn the
UI/UX review of the Desktop audiobook player (2026-11-23) into a feature (Vietnamese description, summarised).

## Context (current behaviour)

A listener opens an audiobook on the computer. The player shows the cover, the current chapter / track, a whole-book
progress line, the seek timeline (Book / Chapter scope), the transport (previous, −15, play, +30, next) and a row with
speed, sleep timer, "Add note" and volume. The left rail opens Contents, Notes and (when enabled) Transcript. The
review found:

- **Unreadable warnings in the light theme**: the notice shown when a track cannot be played, the notice about a Note
  action, and the "can't play" label in Contents use fixed pale-yellow colours meant for a dark background. In the
  Paper (light) theme the text is close to invisible (about 1.1:1 against its background) — precisely when the
  listener needs it.
- **No visible keyboard focus** on the transport buttons and the "Add note" button: a keyboard user cannot see which
  control is current.
- **Progress shown twice**: in Book scope the whole-book progress line sits right above a timeline that shows the
  same position.
- **Few keyboard controls**: only Space (play / pause), which is not listed in Settings → Keyboard Shortcuts and cannot
  be changed. There is no key to skip back / forward, change volume, mute or change speed.
- **Not part of the operating system's media controls**: the system media panel / lock screen does not show the
  book, the chapter or the cover, and the keyboard's or headset's Next / Previous keys do not change chapter.
- **Visual inconsistencies**: the rail tabs are emoji (shared with the text reader, so they look different on every
  system and ignore the theme); the volume control is labelled with the abbreviation "Vol" and cannot be muted in one
  action; −15 / +30 are digits without a symbol.
- **Note markers overlap the seek handle**: a marker sits on the upper half of the timeline's handle, so pressing the
  handle where a Note is can open the Note's menu instead of seeking; markers are 16 px targets.
- **Translated text is changed after translation**: one timeline label is lower-cased in code after it was translated.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Warnings and focus are readable in every theme (Priority: P1)

A listener using the Paper (light), Sepia or Night theme meets a track that cannot be played, or a refused Note
action. The message and its buttons are clearly readable. A keyboard user moving with Tab always sees which control
of the player is focused.

**Why this priority**: today an error message is effectively invisible in one of the three themes, and keyboard users
cannot operate the player with confidence. This is an accessibility defect, not polish.

**Independent Test**: open a multi-track audiobook with a damaged track in each theme; check the notice's text and
button contrast, then Tab through every control of the player and check each shows a visible focus indicator.

**Acceptance Scenarios**:

1. **Given** the Paper theme and a track that cannot be played, **When** the player shows the track notice, **Then**
   its text and its "Try again" / "Skip" buttons are readable (contrast at least 4.5:1) and visibly a warning.
2. **Given** any of the three themes, **When** a Note action is refused, **Then** the Note notice is readable with the
   same contrast and has a Dismiss control.
3. **Given** Contents lists a track marked "can't play", **When** shown in any theme, **Then** that label is readable.
4. **Given** the keyboard, **When** the listener presses Tab repeatedly, **Then** every interactive control of the
   player (transport, scope selector, timeline, note markers, speed, sleep, Add note, volume, mute, Transcribe, rail)
   shows a focus indicator that contrasts at least 3:1 with its surroundings; a mouse click does not leave a
   focus ring behind.

---

### User Story 2 - Control playback from the keyboard (Priority: P1)

A listener with the player open controls it without the mouse: play / pause, skip back 15 s, skip forward 30 s,
previous / next chapter (or track), volume up / down, mute, speed down / up, add a Note. The keys are listed in
Settings → Keyboard Shortcuts, in the interface language, and can be changed there like the reader's shortcuts.

**Why this priority**: a desktop player is commonly driven from the keyboard while the listener works in another
part of the screen; it also completes the accessibility fix of Story 1.

**Independent Test**: with the player focused and no text field focused, press each default key and observe the
action; change one key in Settings and check the new key works and the old one no longer does.

**Acceptance Scenarios**:

1. **Given** the player and no text field focused, **When** the listener presses Space, **Then** playback toggles
   (unchanged behaviour), and the shortcut now appears in Settings → Keyboard Shortcuts.
2. **Given** the player, **When** the listener presses the skip-back / skip-forward keys, **Then** the position moves
   by −15 s / +30 s, clamped to the start / end.
3. **Given** the player, **When** the listener presses the volume keys, **Then** volume changes by 5 % steps between
   0 and 100 %; the mute key mutes, and pressing it again restores the previous level.
4. **Given** the player, **When** the listener presses the speed keys, **Then** speed moves to the next lower / higher
   supported rate and the speed control shows it.
5. **Given** focus is in a text field (Note text, Transcript search) or on a control that uses the same key itself
   (the timeline or volume slider uses the arrow keys; a button uses Space), **When** that key is pressed, **Then**
   the control's own behaviour wins and the player shortcut does not also run.
6. **Given** the listener changes a player shortcut in Settings, **When** they return to the player, **Then** the new
   key works and the button's tooltip names it.

---

### User Story 3 - The system's media controls know the audiobook (Priority: P2)

While an audiobook plays, the operating system's media panel (and the lock screen where the system has one) shows
the book title, the current chapter or track, the author and the cover. The keyboard's / headset's media keys play,
pause, and go to the previous / next chapter (or track); the panel's seek or skip controls work where the system
offers them.

**Why this priority**: valuable and expected of a desktop audiobook app, but the player is usable without it.

**Independent Test**: on Windows, start playback, open the system media panel and check the title, chapter, author,
cover and the play / pause and next / previous buttons; press the keyboard media keys.

**Acceptance Scenarios**:

1. **Given** playback has started, **When** the listener opens the system media panel, **Then** it shows the book
   title, the current chapter / track title, the author and the cover (or no image when the book has no cover).
2. **Given** the chapter or track changes, **When** the panel is shown, **Then** its text follows within 2 seconds.
3. **Given** the panel or a media key, **When** the listener presses play / pause / next / previous, **Then** the
   player does the same as its own buttons (next / previous change chapter or track; unavailable when the book has
   no chapters, as for the player's own buttons).
4. **Given** the listener leaves the player (Library, another book), **When** playback stops, **Then** the system
   panel no longer shows the audiobook.

---

### User Story 4 - A calmer, consistent player layout (Priority: P3)

The player shows each piece of information once and uses the same visual language as the rest of the app.

**Why this priority**: improves clarity and perceived quality; no function is blocked today.

**Independent Test**: open a single-file audiobook with chapters; compare the Book and Chapter scopes, the rail, the
skip buttons, the volume control and the note markers with the acceptance scenarios.

**Acceptance Scenarios**:

1. **Given** Book scope, **When** the player is shown, **Then** the whole-book progress is shown once (the timeline),
   with the "x % · time left" summary next to it; **Given** Chapter scope, **Then** the separate whole-book progress
   line is shown in addition to the chapter timeline.
2. **Given** the left rail (in the player AND in the text reader, which share it), **When** shown in any theme,
   **Then** each tab uses a vector icon of the app's icon style that follows the theme's colours, with its translated
   name as tooltip and accessible name.
3. **Given** the skip buttons, **When** shown, **Then** each has a skip-back / skip-forward symbol together with its
   number of seconds.
4. **Given** the volume control, **When** shown, **Then** it has a speaker symbol (not an abbreviation) that mutes /
   unmutes on press and reflects the muted state, next to the volume slider.
5. **Given** a Note at the current position, **When** the listener presses and drags the timeline handle, **Then**
   the seek works; note markers are drawn clear of the handle and each marker can be pressed on an area of at least
   24 × 24 px.
6. **Given** reduced motion is requested by the system, **When** the sidebar opens / closes or a button is pressed,
   **Then** no sliding or scaling animation is played.

### Edge Cases

- A book with no chapters: next / previous keys and the system panel's next / previous are unavailable (not
  silently doing something else), as are the player's own buttons today.
- A multi-track book on its last track: "next" is unavailable everywhere, consistent with the player's button.
- A shortcut key changed in Settings to a key already used elsewhere: the existing Settings conflict rule applies.
- The listener mutes, then drags the volume slider: muting is lifted and the slider's level is used.
- Volume or mute set by keys is kept like the slider's volume is kept today.
- A book without a cover: the system panel shows no image (never a broken one).
- The system has no media panel (or it is disabled): nothing fails; the player works as before.
- Two Notes very close together: each marker stays pressable; overlapping markers do not hide the handle.
- The interface language changes while the player is open: shortcut names, tooltips and the system panel's texts
  that the app provides follow it; book / chapter titles are never translated.

## Requirements *(mandatory)*

### Functional Requirements

**Readability and focus (Story 1)**

- **FR-001**: Warning notices of the player (track cannot be played, Note action refused) and the "can't play" label in
  Contents MUST use the theme's colours so that text and buttons reach at least 4.5:1 contrast in Night, Sepia and
  Paper.
- **FR-002**: The themes MUST provide one shared "warning" colour set (background, border, text) used by these notices,
  so a future notice reuses it instead of fixed colours.
- **FR-003**: Every interactive control of the player and its sidebar MUST show a keyboard focus indicator with at
  least 3:1 contrast against its surroundings in all three themes; the indicator appears for keyboard focus only.

**Keyboard (Story 2)**

- **FR-004**: The player MUST offer these actions as shortcuts with defaults: play / pause (Space), skip back 15 s
  (←), skip forward 30 s (→), previous / next chapter or track (Shift+← / Shift+→), volume up / down 5 % (↑ / ↓),
  mute toggle (M), speed down / up ([ / ]), add a Note (B).
- **FR-005**: These shortcuts MUST be listed in Settings → Keyboard Shortcuts in their own group, translated into
  every interface language, changeable and resettable like the existing shortcuts.
- **FR-006**: A shortcut MUST NOT run while focus is in a text field, or when the focused control uses the same key
  itself (sliders and their arrow keys, buttons and Space / Enter, open menus).
- **FR-007**: Tooltips of the player's buttons MUST name the current key of their shortcut.

**System media controls (Story 3)**

- **FR-008**: While an audiobook is loaded in the player, the app MUST publish to the system's media controls the book
  title, the current chapter or track title, the author and the cover, and keep them current on chapter / track
  change.
- **FR-009**: The system's play, pause, previous and next controls (and media keys) MUST perform the player's own
  actions; previous / next MUST be unavailable exactly when the player's buttons are.
- **FR-010**: Where the system offers seek / skip controls, they MUST map to the player's seek and −15 / +30 actions;
  the system MUST be told the playback position, duration and speed so its progress display is correct.
- **FR-011**: Leaving the player MUST remove the audiobook from the system's media controls.

**Layout and consistency (Story 4)**

- **FR-012**: In Book scope the whole-book progress MUST appear once; the separate whole-book progress line MUST be
  shown only in Chapter scope. The "x % · time left" summary stays visible in both scopes for single-file books.
- **FR-013**: The left rail's tabs (shared by the player and the text reader) MUST use vector icons in the app's icon
  style that follow the theme's colours; emoji MUST NOT be used as icons.
- **FR-014**: The skip buttons MUST show a skip-back / skip-forward symbol plus their number of seconds.
- **FR-015**: The volume control MUST have a speaker symbol that toggles mute and shows the muted state; the
  abbreviation "Vol" MUST be replaced. The muted state and the level before muting MUST be kept with the other
  player preferences.
- **FR-016**: Note markers MUST not overlap the timeline's handle and MUST have a press area of at least 24 × 24 px;
  pressing the handle MUST always seek.
- **FR-017**: The player's sidebar and button animations MUST be turned off when the system asks for reduced motion.
- **FR-018**: No interface text MAY be altered after translation (e.g. upper- or lower-cased in code); each wording
  needed MUST have its own translated message in every interface language, following the Vietnamese glossary.

### Key Entities

- **Player shortcut**: an action of the player, its default key, the key the listener chose, its translated name.
- **Player preferences**: volume (already kept on this computer), plus muted state and the level before muting.
  Speed keeps its current behaviour.
- **Now-playing information**: book title, chapter / track title, author, cover, position, duration, speed — what
  the system media controls show.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In each of the three themes, 100 % of the player's warning texts and their buttons measure at least
  4.5:1 contrast (today: about 1.1:1 in Paper).
- **SC-002**: A keyboard-only listener can do every player action of Story 2 and reach every control of the player
  with a visible focus indicator, without touching the mouse — checked control by control.
- **SC-003**: Every player shortcut appears in Settings → Keyboard Shortcuts in English and Vietnamese, and a changed
  key takes effect without restarting the app.
- **SC-004**: On Windows, within 2 seconds of playback starting or of a chapter / track change, the system media panel
  shows the correct book, chapter / track, author and cover; its play / pause and next / previous work on the
  first press.
- **SC-005**: In Book scope the player shows exactly one whole-book progress indicator.
- **SC-006**: No emoji remains as an icon in the player or the text reader's rail.
- **SC-007**: Pressing the timeline handle seeks in 100 % of attempts, including when a Note sits at the handle's
  position.

## Assumptions

- Scope is the **Desktop** player of single-file and multi-track audiobooks; the phone player is not changed (it has
  its own layout; the rail icons it does not use).
- A mini-player / playback that continues after leaving the player is **out of scope** (a separate product decision);
  this feature keeps "leaving the player stops playback".
- Whole-book progress and totals for multi-track books stay out of scope (planned separately, "Stage C").
- The system media controls are those Chromium provides inside the Desktop app on Windows; macOS / Linux behave
  according to what their systems show, and nothing fails where there is no media panel.
- The default keys of FR-004 follow common desktop players; where one collides with an existing app shortcut while
  the player is open, the player's key applies only on the player screen.
- The rail icons change in the text reader too, because the rail is shared; no other part of the reader changes.
- No new stored data beyond the muted state / previous level; no change to how listening progress or Notes are saved.
