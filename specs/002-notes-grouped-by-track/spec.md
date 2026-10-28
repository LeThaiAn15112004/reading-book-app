# Feature Specification: Notes Grouped by Track

**Feature Branch**: `002-notes-grouped-by-track` (spec directory only; no git branch was created)

**Created**: 2026-10-25

**Status**: Draft — awaiting approval

**Input**: User description: "The Notes feature of a multi-chapter (multi-track) audiobook, as it is now: show only the tracks that contain Notes, each as a dropdown that reveals the Notes made in that track." (original wording in Vietnamese: "hiện những track có chứa notes, dropdown để hiện những chỗ được note trong chapter đó")

## Current State (verified in the repository, 2026-10-25)

- The Notes tab of a multi-track audiobook (left sidebar) shows ONE flat list of every Note, ordered by track, then by time in the track. Each Note card repeats its track as a small line ("12 · Track title") above its text.
- With many tracks (up to 68 in the reference audiobook, up to 5 000 supported) and up to 500 Notes, this flat list is long: the listener cannot see at a glance which tracks hold Notes, and must scroll past Notes of unrelated tracks.
- A Note card can be clicked to jump to the Note's track and exact second; it has an actions menu (edit text, seek, delete with confirmation); the timeline of the current track shows markers for that track's Notes. All of this already works and is **not** the subject of this feature.
- Notes of single-file audiobooks are a flat list too, but they have no tracks.

## Clarifications

### Session 2026-10-25

- Q: Does "chapter" in the request mean a track of a multi-track audiobook? → A: Yes — "chapter" means track (confirmed by the requester).
- Q: Which rows are open when the Notes tab is first shown? → A: Only the row of the track currently playing (if it has Notes); every other row is closed (the proposed default, confirmed by the requester).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which tracks have Notes (Priority: P1)

A listener opens the Notes tab of a multi-track audiobook. Instead of one long list, they see only the tracks that contain at least one Note, in playback order. Each track is one row showing its number, title and how many Notes it holds. Tracks without Notes are not shown.

**Why this priority**: This is the heart of the request: with 68 tracks and Notes in only a handful, the listener instantly sees where their Notes are.

**Independent Test**: Make Notes in tracks 3, 12 and 30 of a 68-track audiobook, open the Notes tab, and confirm exactly three track rows appear, in that order, each with the right number, title and Note count, and no row for any other track.

**Acceptance Scenarios**:

1. **Given** Notes exist in tracks 30, 3 and 12 (made in that order), **When** the listener opens the Notes tab, **Then** three track rows appear, ordered track 3, track 12, track 30.
2. **Given** track 12 holds two Notes, **When** its row is shown, **Then** the row shows "12", the track title, and the count 2.
3. **Given** two tracks share the same title, **When** both hold Notes, **Then** the track numbers still tell their rows apart.
4. **Given** the audiobook has no Notes at all, **When** the Notes tab is opened, **Then** the existing explanatory empty state is shown (no track rows).
5. **Given** Notes exist in only one track, **When** the Notes tab is opened, **Then** exactly one track row is shown.

---

### User Story 2 - Open a track to see its Notes (Priority: P1)

The listener opens (expands) a track row and sees the Notes made in that track, in time order, each with its timestamp inside the track and its text when it has one. Closing (collapsing) the row hides them again. Several rows can be open at once.

**Why this priority**: The second half of the request: the dropdown that reveals "the places that were noted" inside the track.

**Independent Test**: Expand the row of a track that holds three Notes and confirm the three Notes appear in time order with correct timestamps and text; collapse it and confirm they disappear while the row (and its count) remains.

**Acceptance Scenarios**:

1. **Given** a collapsed track row with three Notes at 01:00, 03:20 and 10:05, **When** the listener opens it, **Then** the three Notes appear beneath it ordered 01:00, 03:20, 10:05.
2. **Given** an open track row, **When** the listener closes it, **Then** its Notes are hidden and the row stays visible with its count.
3. **Given** two track rows, **When** the listener opens both, **Then** both stay open at the same time.
4. **Given** a Note without text, **When** it is shown in an open row, **Then** it appears as a plain marker with its timestamp, as it does today.
5. **Given** the Notes tab is opened for the first time for an audiobook, **When** it appears, **Then** the row of the track that is currently playing is already open and every other row is closed (so the listener sees "where I am" at once, with no extra click).
6. **Given** the listener pressed Enter or Space on a focused row, **When** the row was closed, **Then** it opens; pressing again closes it (the rows work without a mouse).

---

### User Story 3 - Work with a Note exactly as before (Priority: P1)

Inside an open track row, a Note behaves like the Notes of today: clicking it jumps to that track and exact second (keeping play or pause), its actions menu edits the text or deletes the Note after confirmation, and the highlight "Here" appears while playback is at it. The same Note menu is reachable from the timeline markers.

**Why this priority**: The regrouping must not take away anything the listener can already do with a Note.

**Independent Test**: In an open row, click a Note on another track (it plays that track at that second), edit one Note's text, delete another after confirming, and confirm the rows and counts update correctly.

**Acceptance Scenarios**:

1. **Given** an open row, **When** the listener clicks one of its Notes, **Then** the player goes to that Note's track and exact second, with the same results as today (including the failed-track message and the return to the previous track).
2. **Given** a Note is edited from an open row, **When** the text is saved, **Then** the row stays open, the Note keeps its track, second and place in the order, and the count is unchanged.
3. **Given** a track row holds two Notes, **When** one is deleted after confirmation, **Then** the count becomes 1 and the row stays.
4. **Given** a track row holds one Note, **When** it is deleted, **Then** the row disappears (a track without Notes is never listed).
5. **Given** playback is at one of the Notes of an open row, **When** the row is shown, **Then** that Note is highlighted as "Here", as today.

---

### User Story 4 - The list follows what the listener does (Priority: P2)

When the listener adds a Note, its track row is shown and open so the new Note is visible at once (and the Note's text editor opens as it does today). When playback moves to another track by any means (Contents, previous/next, auto-advance, a Note jump), rows the listener opened or closed by hand stay as they chose; the player's current track is marked on its row so it can always be found.

**Why this priority**: Makes the grouped list feel live, but the feature is useful without it.

**Independent Test**: Add a Note while playing a track that had no Notes, open the Notes tab, and confirm that track now has a row, open, with the new Note in it; then let playback move to the next track and confirm the open/closed state of rows did not change.

**Acceptance Scenarios**:

1. **Given** the listener adds a Note on a track that had no Notes, **When** the Notes tab is visible, **Then** a new row for that track appears in track order, open, showing the new Note.
2. **Given** the listener adds a Note on a track whose row is closed, **When** the Note is added, **Then** that row opens and shows the new Note.
3. **Given** playback is in track 12, **When** the Notes tab is visible, **Then** track 12's row (if it has Notes) is marked as the current track.
4. **Given** the listener had closed the row of the playing track, **When** playback moves to another track, **Then** no row opens or closes by itself.
5. **Given** a track fails to play and the player returns to the previous track, **When** the Notes tab is visible, **Then** every row remains and stays usable.

---

### User Story 5 - Single-file audiobooks stay as they are (Priority: P1)

Single-file audiobooks have no tracks, so their Notes tab is unchanged: one flat list, as today. PDF and EPUB annotations are not touched.

**Why this priority**: Regression protection for existing behaviour.

**Independent Test**: Open a single-file audiobook with several Notes and confirm the Notes tab looks and behaves exactly as before, with no track rows.

**Acceptance Scenarios**:

1. **Given** a single-file audiobook with Notes, **When** the Notes tab is opened, **Then** the list is the same flat list as before.
2. **Given** a PDF or EPUB with annotations, **When** this feature ships, **Then** nothing about them changes.

---

### Edge Cases

- **Many tracks and Notes:** 68 tracks with Notes in all of them, or 500 Notes in one track, still scroll smoothly; opening a row with hundreds of Notes does not freeze the tab.
- **Track with Notes that cannot be played:** its row is still listed and opens; only jumping to one of its Notes reports the problem (as today).
- **A Note whose track is unknown or foreign** (damaged data): it is not shown in any row and never breaks the list (as today: such entries are not shown).
- **Notes unavailable** (the saved Notes could not be read): the existing "could not be loaded" message is shown instead of rows; no empty list is shown.
- **Notes unavailable then fine again:** rows reappear in their default state.
- **Same-second Notes in one track:** both are listed, in creation order.
- **Switching between audiobooks:** the open/closed choices of one audiobook are not applied to another.
- **Closing and reopening the Notes tab (or the sidebar):** the rows the listener left open or closed stay as they were during the same listening session.
- **Restarting the app:** the rows return to the default state (only the current track's row open); open/closed choices are not remembered across restarts.
- **Counts:** the count on a row always equals the number of Notes in it, also while Notes are added, edited or deleted.

## Requirements *(mandatory)*

### Functional Requirements

**Which tracks are shown**

- **FR-001**: For a multi-track audiobook, the Notes tab MUST list one row per track that contains at least one Note, and MUST NOT list tracks that contain none.
- **FR-002**: Rows MUST be ordered by the tracks' playback order.
- **FR-003**: Each row MUST show the track number, the track title and the number of Notes in that track.
- **FR-004**: When no Note exists, the existing empty state MUST be shown instead of rows. When the Notes could not be read, the existing "could not be loaded" message MUST be shown instead of rows.

**Opening and closing**

- **FR-005**: A row MUST be openable and closable by the listener (mouse and keyboard); an open row MUST show that track's Notes and a closed row MUST hide them.
- **FR-006**: Several rows MUST be able to be open at the same time.
- **FR-007**: Notes inside an open row MUST be ordered by time inside the track, then by creation time for equal times.
- **FR-008**: Each Note inside an open row MUST show its timestamp inside the track and its text when present. A plain marker MUST be shown as it is today.
- **FR-009**: The first time the Notes tab is shown for an audiobook in a listening session, the row of the track currently playing (if it has Notes) MUST be open and every other row closed.

**Working with Notes**

- **FR-010**: Selecting a Note inside an open row MUST do exactly what selecting a Note does today (go to the Note's track and exact second, keeping the play state, with the same failure handling).
- **FR-011**: The Note actions (edit text, seek, delete with confirmation) and the "Here" highlight MUST work for Notes inside open rows exactly as they do today, and the same Note menu MUST remain reachable from the timeline markers.
- **FR-012**: Adding, editing or deleting a Note MUST update the rows and the counts at once: a track that gets its first Note gains a row; a track that loses its last Note loses its row.
- **FR-013**: When a Note is added, the row of its track MUST be shown and open so the new Note is visible.

**Following playback**

- **FR-014**: The row of the track currently playing MUST be marked as the current track.
- **FR-015**: A change of the playing track MUST NOT open or close any row by itself.

**Memory**

- **FR-016**: A row's open or closed state MUST be kept while the audiobook stays open, including when the Notes tab or sidebar is closed and reopened, and MUST NOT be applied to another audiobook. It MUST NOT be remembered across app restarts.

**Boundaries**

- **FR-017**: Notes of single-file audiobooks MUST be unchanged in behaviour and appearance.
- **FR-018**: This feature MUST NOT change how Notes are created, stored, limited (maximum count and text length), jumped to, or removed, nor the timeline markers, and MUST NOT change PDF or EPUB annotations.
- **FR-019**: This feature MUST NOT add cloud synchronisation, export, download, search or filtering of Notes, and MUST NOT introduce audiobook-wide progress, totals or a whole-book timeline.
- **FR-020**: The rows and their controls MUST be usable with a keyboard and be understandable to assistive technology (a row announces its track, its Note count and whether it is open).

### Key Entities

- **Audiobook (multi-track)**: owns its ordered tracks and its Notes (unchanged).
- **Track**: one ordered audio file with a number and a title (unchanged).
- **Note**: a marked second inside one track, with optional text (unchanged).
- **Track group**: a presentation-only grouping — the track plus the Notes it contains, its Note count, and whether it is open. It is derived from the Notes and is not stored with them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In an audiobook of 68 tracks with Notes in 5 of them, the listener sees exactly those 5 track rows after opening the Notes tab, without scrolling past any Note of another track.
- **SC-002**: A listener can find the Notes of a given track and see them in at most two actions (open the Notes tab, open the track's row), or in one action when it is the track that is currently playing.
- **SC-003**: 100% of Notes are reachable: for any audiobook, the sum of the counts on the rows equals the number of Notes the audiobook holds, and every Note appears in exactly one row.
- **SC-004**: Every action available on a Note before this feature (jump, edit, delete with confirmation, "Here" highlight) still works from an open row with identical results, in 100% of tested cases.
- **SC-005**: With the maximum supported number of Notes (500) spread over the maximum number of tracks with Notes, opening the Notes tab and opening or closing rows never shows a visible freeze longer than 1 second.
- **SC-006**: 100% of single-file audiobook Notes behaviours that worked before still work with identical results; no PDF or EPUB annotation is changed.

## Assumptions

- **Scope of audiobooks**: "Multi-track" means an audiobook of two or more tracks made from a ZIP. Single-file audiobooks have no tracks and keep their flat list (Story 5).
- **"Chapter" means track** (confirmed): the request speaks of chapters; in this app the parts of a multi-chapter audiobook are its tracks, so a "chapter with Notes" is a track with Notes. Embedded chapters of single-file audiobooks are not covered.
- **Where**: the grouped list replaces the flat list inside the existing Notes tab of the left sidebar. No new screen, tab or panel is added. The "+ Note" button above the list keeps working as today.
- **Default state** (confirmed): only the row of the track currently playing is open when the Notes tab is first shown, so "where am I" is visible at once.
- **Track label on a Note**: because the row already names the track, a Note inside a row does not need to repeat the track number and title; its timestamp and text are enough. The Note menu may still name the track.
- **Memory of open rows** lasts for the current listening session only (not saved to disk), so no stored data changes and nothing needs migrating.
- **No data change**: Notes keep their stored form and limits; the grouping is derived each time from the Notes and the track list.
- **Dependencies**: relies on the existing multi-track Notes (add, edit, delete, jump, markers) delivered by feature `001-multi-track-audiobook-notes`.
