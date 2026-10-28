# Feature Specification: Notes for Multi-Track Audiobooks

**Feature Branch**: `001-multi-track-audiobook-notes` (spec directory only; no git branch was created)

**Created**: 2026-10-25

**Status**: Draft — awaiting approval

**Input**: User description: "Add Notes support for multi-track audiobooks imported from ZIP archives in Readmate Reader. Inspect the existing implementation and the plans `audiobook_multi_track_playback_b.md` and `audiobook_multi_chapter_import.md`; do not assume those plans have been implemented. Preserve existing Notes behavior for single-file audiobooks. For multi-track audiobooks, allow users to create, view, edit, and delete Notes at the current playback position. Show all Notes belonging to the audiobook in one Notes view, including each Note's track title and timestamp within that track. Clicking a Note must navigate to the correct track and exact playback position. Store Notes locally in the existing app persistence system, associated with the parent audiobook and a stable track identifier. No cloud sync, export, or download. Do not change PDF or EPUB annotations."

## Current State (verified in the repository, 2026-10-25)

This section records what exists today so the requirements below are not built on the plans' claims alone. The two plans (`audiobook_multi_track_playback_b.md`, `audiobook_multi_chapter_import.md`) are labelled "plan only, not implemented"; the working tree is further along than they say.

- **Multi-track audiobooks exist.** Importing a ZIP with two or more audio tracks produces one audiobook made of ordered tracks, each with a stable identifier and a title (tag title, else file name). The ZIP import entry point is still switched off for end users by a release flag, which is currently on in the working tree only for local testing.
- **Multi-track playback is largely in place.** The player plays one track at a time, shows the track list in the Contents sidebar, switches tracks on click, advances automatically at the end of a track, and has previous/next track controls. Progress is remembered as "track + seconds inside that track".
- **Notes for single-file audiobooks work today.** A Note is a marked position in seconds with optional text. Users can add one from the player, see all Notes in a sidebar list and as markers on the timeline, edit or delete them from one shared menu, and click one to jump to it.
- **Notes for multi-track audiobooks are deliberately blocked today**, in three independent places: the Notes tab and the "+ Note" control are hidden, the player ignores add/go-to-Note actions, and the storage layer returns no Notes for, and refuses to save Notes on, a multi-track audiobook. This feature lifts that block for multi-track audiobooks only. The storage-layer refusal is a safeguard from the earlier plans; it must be replaced by a rule that accepts a Note only when it names a track that belongs to that audiobook.
- **Out of scope in the same plans (Stage C), not part of this feature:** audiobook-wide percentage, total/remaining time, "Book" scope timeline, Continue Reading integration, gapless playback.

## Clarifications

### Session 2026-10-25

- No open questions were raised with the user: every ambiguity found has a reasonable default and none changes scope or touches data safety. The defaults are recorded under Assumptions so they can be overruled at approval.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a Note while listening to a multi-track audiobook (Priority: P1)

A listener is playing track 12 of a 40-track audiobook and hears something worth remembering. They add a Note, optionally typing text, and it is attached to this exact spot: track 12, at the current second.

**Why this priority**: Without the ability to create a Note, nothing else in this feature has any data. It is the smallest slice that gives a listener value (a saved, durable marker), and it removes the visible capability gap between single-file and multi-track audiobooks.

**Independent Test**: Open a multi-track audiobook, play or seek to a position inside any track, add a Note with and without text, close and reopen the app, and confirm both Notes are still there, each tied to that track and second.

**Acceptance Scenarios**:

1. **Given** a multi-track audiobook is open on track 12 at 03:20, **When** the user adds a Note with the text "check this fact", **Then** a Note is saved for that audiobook, belonging to track 12 at 03:20, with that text.
2. **Given** the same state, **When** the user adds a Note without any text, **Then** a plain marker Note is saved at track 12, 03:20 (a Note with no text is valid, as for single-file audiobooks).
3. **Given** a Note was added, **When** the user closes and reopens the app and opens the same audiobook, **Then** the Note is still present with the same track, timestamp and text.
4. **Given** the player is in the middle of switching tracks, or the current track failed to load, **When** the user looks at the add-Note control, **Then** it is unavailable (no Note can be created for a position that is not really playing).
5. **Given** the user adds two Notes in quick succession at the same second, **When** they look at the list, **Then** both exist as separate Notes.

---

### User Story 2 - See every Note of the audiobook in one place (Priority: P1)

The listener opens the Notes view and sees all Notes of the audiobook together, ordered the way the book plays: by track order, then by time inside the track. Each Note shows which track it belongs to (track number and title), its timestamp inside that track, and its text if any.

**Why this priority**: A Note nobody can find again is worthless; the single list is what makes Notes useful across 40+ tracks. It is P1 because creation (Story 1) and review are the minimum useful pair.

**Independent Test**: Create Notes in at least three different tracks (out of order), open the Notes view, and verify one list in playback order with correct track label, in-track timestamp and text on every entry.

**Acceptance Scenarios**:

1. **Given** Notes exist in tracks 3, 12 and 12, and 30, **When** the user opens the Notes view, **Then** all four appear in one list ordered track 3, track 12 (earlier time first), track 12 (later time), track 30.
2. **Given** a Note on track 12 at 03:20, **When** it is displayed, **Then** it shows the track number and title ("12 · <track title>") and the timestamp "03:20" measured inside that track, not a position in the whole book.
3. **Given** two tracks have the same title, **When** their Notes are listed, **Then** the track number still tells them apart.
4. **Given** an audiobook with no Notes, **When** the user opens the Notes view, **Then** a clear empty state explains how to add one.
5. **Given** the user is on track 5, **When** they open the Notes view, **Then** Notes from other tracks are still shown (the list is for the whole audiobook, not just the current track).

---

### User Story 3 - Jump to a Note (Priority: P1)

Clicking a Note in the Notes view takes the listener to that Note's track and exact second, even when it is a different track from the one playing, and even after the app was restarted.

**Why this priority**: This is the payoff of the feature — turning a saved marker into a way back to the moment — and the description makes it a hard requirement ("the correct track and exact playback position").

**Independent Test**: With Notes in tracks 3 and 30, start playing track 12, click the Note in track 30, and verify the player ends up on track 30 at the Note's second; then click the Note in track 3 while paused and verify the same, still paused.

**Acceptance Scenarios**:

1. **Given** track 12 is playing and a Note exists on track 30 at 01:05, **When** the user clicks that Note, **Then** track 30 loads, the position is 01:05, and playback continues (it was playing).
2. **Given** playback is paused, **When** the user clicks a Note on another track, **Then** that track loads at the Note's position and stays paused.
3. **Given** the Note is on the track that is already current, **When** the user clicks it, **Then** playback only moves to the Note's second; the track is not reloaded or restarted.
4. **Given** the user clicks Note A and, before it finishes loading, clicks Note B on another track, **Then** the player ends on B's track and second only; A's position is never applied to B's track.
5. **Given** the app was restarted, **When** the user clicks any Note, **Then** it navigates exactly as before (navigation depends on stored data, not on anything remembered in memory).
6. **Given** the Note's track file is missing or cannot be played, **When** the user clicks the Note, **Then** the user is told that track cannot be played, the Note is kept, and the player stays usable on the track it was on (no blank or error screen).
7. **Given** a Note's saved second is beyond the track's actual length (for example the file was replaced), **When** it is clicked, **Then** the player goes to the nearest valid point inside that track rather than failing.

---

### User Story 4 - Edit and delete a Note (Priority: P2)

The listener changes a Note's text or removes a Note, from the same menu used for single-file audiobooks. Editing changes only the text; it does not change the Note's track or second. Deleting asks for confirmation.

**Why this priority**: Needed for a complete feature and to keep the list tidy, but a listener can already get value from Stories 1–3 without it.

**Independent Test**: Edit a Note's text, clear it, and delete another one; confirm the list, the saved data after restart, and that neither action moves playback.

**Acceptance Scenarios**:

1. **Given** a Note with text, **When** the user edits it and saves, **Then** the list shows the new text, the Note keeps the same track and timestamp, and no duplicate appears.
2. **Given** a Note with text, **When** the user clears the text and saves, **Then** it remains as a plain marker Note.
3. **Given** a Note, **When** the user chooses delete and confirms, **Then** it disappears from the list and does not return after restart.
4. **Given** the delete confirmation is shown, **When** the user cancels, **Then** the Note is untouched.
5. **Given** the user edits or deletes a Note on another track, **When** the action completes, **Then** playback (track, position, play state) is unaffected.

---

### User Story 5 - See Notes of the current track on the timeline (Priority: P3)

While listening, the seek bar of the current track shows small markers where that track's Notes are, and clicking a marker opens the same Note menu. This mirrors what single-file audiobooks have.

**Why this priority**: A convenience that helps in-context review; the feature is complete and valuable without it.

**Independent Test**: Add two Notes to the current track and one to another track; confirm only the two appear as markers on the current track's bar, and that markers vanish/appear correctly when switching tracks.

**Acceptance Scenarios**:

1. **Given** the current track has Notes at 01:00 and 04:30, **When** the track's seek bar is shown and its duration is known, **Then** two markers appear at proportional positions.
2. **Given** the user moves to another track, **When** the bar updates, **Then** it shows only that track's Notes.
3. **Given** the current track's duration is not yet known, **When** the bar is shown, **Then** no markers are drawn (they are never drawn in a wrong place).

---

### User Story 6 - Single-file audiobooks stay exactly as they are (Priority: P1)

Everything a listener can do with Notes on a single-file audiobook today — add, list, edit, delete, jump, timeline markers, existing saved Notes — behaves identically after this feature ships. Audiobooks created from a ZIP with one selected track are single-file audiobooks and are covered here.

**Why this priority**: Regression protection for existing user data is non-negotiable and is a stated requirement.

**Independent Test**: Run the existing single-file Notes behaviours (add/edit/delete/jump/markers/restart) and compare with pre-feature behaviour; open a single-file audiobook with previously saved Notes and confirm all of them are intact.

**Acceptance Scenarios**:

1. **Given** a single-file audiobook with existing Notes, **When** the app is updated, **Then** every existing Note is still present, in the same order and with the same text and positions.
2. **Given** a single-file audiobook, **When** the user adds, edits, deletes or jumps to a Note, **Then** the result is identical to before this feature.
3. **Given** a PDF or EPUB with highlights, notes and bookmarks, **When** this feature ships, **Then** their annotations behave identically and none is added, changed or lost.

---

### Edge Cases

- **Note limit:** an audiobook reaches the same maximum number of Notes that single-file audiobooks have; adding another is declined with a clear message and nothing is lost or silently dropped.
- **Long text:** Note text beyond the existing maximum length is trimmed the same way as for single-file audiobooks, and the user sees how much they can type.
- **Unknown track length:** a track whose duration is unknown can still receive Notes (the position comes from where playback actually is); only timeline markers wait for a known duration.
- **Track unplayable:** Notes on a track that cannot be played remain listed and editable/deletable; only jumping to them reports the problem.
- **Switching in flight:** while a track switch is in progress, adding a Note is unavailable, and a Note click made during a switch ends on the last clicked target only (no mixed track/second).
- **Orphaned Note:** if a stored Note names a track that no longer belongs to the audiobook (damaged or inconsistent data), it is not shown as a normal Note, never causes navigation to the wrong place, never blocks the rest of the list, and never causes a crash or an unreadable Notes view.
- **Many tracks and many Notes:** an audiobook with up to the maximum supported number of tracks and Notes keeps the Notes view scrollable and responsive.
- **Remove audiobook:** removing a multi-track audiobook from the library also removes its Notes; they are never left behind or attached to another book.
- **Duplicate imports:** Notes belong to one audiobook; importing the same tracks again is rejected as a duplicate by the existing rules, so Notes are never merged between two audiobooks.
- **Concurrent edits in flight:** rapid add/edit/delete actions never reorder, duplicate or resurrect Notes; the saved result equals the last list the user saw.
- **Playback progress is unaffected:** adding, editing, deleting or jumping to a Note never changes the book-level progress rules (no percentage or total time is introduced by this feature).

## Requirements *(mandatory)*

### Functional Requirements

**Creating**

- **FR-001**: Users MUST be able to add a Note to a multi-track audiobook at the current playback position, defined as the current track and the current second inside that track.
- **FR-002**: A Note MAY carry text or be a plain marker with no text, the same as for single-file audiobooks.
- **FR-003**: The add-Note control MUST be unavailable whenever the player has no valid current position: while a track switch is in progress, while the audiobook is not ready, or while the current track has failed to load.
- **FR-004**: Every Note MUST be stored as belonging to its parent audiobook and to one stable track of that audiobook, plus a position in seconds inside that track. A Note's track MUST NOT change when the track list is displayed, re-read, reordered by the UI or the app is restarted.

**Viewing**

- **FR-005**: The Notes view of a multi-track audiobook MUST be available (the Notes entry that is hidden for these audiobooks today MUST be shown) and MUST list every Note of the audiobook in one list, not only those of the current track.
- **FR-006**: The list MUST be ordered by the tracks' playback order, then by time inside the track, then by creation time for equal times.
- **FR-007**: Each entry MUST show the track number and track title, the timestamp inside that track, and the Note text when present.
- **FR-008**: When no Notes exist the Notes view MUST show an explanatory empty state.
- **FR-009**: The current track's seek bar MUST show a marker for each of that track's Notes when its duration is known, MUST show no markers for Notes of other tracks, and MUST show none when the duration is unknown. Markers MUST open the same Note menu used by the list.

**Navigating**

- **FR-010**: Selecting a Note MUST navigate to that Note's track and to its exact second inside that track.
- **FR-011**: Navigation MUST preserve the play state: playing before ⇒ playing after; paused before ⇒ paused after.
- **FR-012**: Selecting a Note on the current track MUST only move the position; it MUST NOT reload or restart the track.
- **FR-013**: When several navigation requests overlap (rapid clicks, a click during a track switch, a click while the app is still starting playback), the player MUST end on the last requested Note's track and second, and MUST never apply one Note's second to a different track.
- **FR-014**: If the target track cannot be played, the user MUST be told which track failed, the Note MUST remain, and the player MUST stay usable on its previous track. The error MUST NOT blank the player or the Notes view.
- **FR-015**: If a Note's second lies beyond the track's actual length, navigation MUST land on the nearest valid point inside that track.
- **FR-016**: Navigation MUST keep working after an app restart, using only stored data.

**Editing and deleting**

- **FR-017**: Users MUST be able to edit a Note's text from the same menu used for single-file audiobooks; editing MUST NOT change the Note's track, position, or identity, and MUST NOT create a duplicate.
- **FR-018**: Users MUST be able to delete a Note after a confirmation step; cancelling the confirmation MUST leave the Note unchanged.
- **FR-019**: Editing, deleting and opening the Note menu MUST NOT change playback (track, position, play state).

**Storage and integrity**

- **FR-020**: Notes MUST be stored locally in the app's existing persistence system, together with the audiobook's other reading data, and MUST survive app restart, update and reboot. No new storage location outside the existing persistence system is introduced.
- **FR-021**: The system MUST accept a Note for a multi-track audiobook only if it names a track that belongs to that same audiobook, and MUST reject a Note that names a track of another audiobook, an unknown track, or no track. This replaces today's blanket refusal of Notes for multi-track audiobooks.
- **FR-022**: The system MUST keep refusing a track reference on a single-file audiobook, so a single-file audiobook can never hold Notes that point at tracks.
- **FR-023**: Per audiobook, the system MUST apply the same limits as single-file audiobooks today: the same maximum number of Notes and the same maximum Note text length. Reaching a limit MUST be reported to the user and MUST NOT silently drop or overwrite existing Notes.
- **FR-024**: Reading stored Notes MUST tolerate damaged or inconsistent entries (including an unknown track): such entries MUST be skipped or shown as unavailable, MUST NOT stop the valid Notes from loading, and MUST NOT cause navigation to a wrong place.
- **FR-025**: Removing a multi-track audiobook from the library MUST remove its Notes with it.
- **FR-026**: Saving the Notes list MUST NOT alter the audiobook's playback progress, its other reading data, or any other audiobook.

**Compatibility and boundaries**

- **FR-027**: Notes of single-file audiobooks MUST keep their current behaviour, stored form and visible results unchanged; all Notes saved before this feature MUST remain readable and intact.
- **FR-028**: PDF and EPUB annotations (highlights, notes, bookmarks) MUST NOT be changed by this feature in behaviour or in stored data.
- **FR-029**: This feature MUST NOT add cloud synchronisation, export, download, sharing or any other transfer of Notes off the device.
- **FR-030**: This feature MUST NOT introduce an audiobook-wide percentage, total or remaining time, or a whole-book timeline, and MUST NOT change how multi-track playback progress is remembered.
- **FR-031**: This feature MUST NOT change the ZIP import flow, the import release switch, or the rules for how a ZIP becomes a single-file or multi-track audiobook.

### Key Entities

- **Audiobook (multi-track)**: The parent library item made from a ZIP with two or more tracks. Owns its ordered tracks and its Notes. Removing it removes both.
- **Track**: One ordered audio file of an audiobook, with a stable identifier that never changes for the life of the audiobook, a title, a position in the order, and possibly an unknown duration.
- **Note**: A marked spot in one audiobook. Attributes: unique identifier, the audiobook, the track it belongs to (stable identifier), the position in seconds inside that track, optional text, a display label, creation time. A Note belongs to exactly one track; a track can have many Notes.
- **Note list**: All Notes of one audiobook, presented in playback order (track order, then in-track time).
- **Single-file audiobook Note**: The existing kind of Note, whose position is in seconds from the start of the one file. It is unchanged and has no track.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A listener can add a Note at the current position of a multi-track audiobook in at most two actions (open the add control, confirm) and the Note is visible in the Notes view immediately.
- **SC-002**: For an audiobook with 68 tracks and Notes in at least 10 different tracks, 100% of Notes appear in one list in the correct playback order with the correct track label and in-track timestamp.
- **SC-003**: Selecting any Note lands the player on the correct track within 2 seconds on a normal local library, and on the saved second to within 1 second, in 100% of attempts, including after an app restart.
- **SC-004**: When the user selects Notes in quick succession (at least 10 selections across different tracks), the final state is always the last selection's track and second; mixed results (one Note's second on another Note's track) occur in 0% of runs.
- **SC-005**: After closing and reopening the app, 100% of added, edited and deleted Notes match what the user last saw.
- **SC-006**: 100% of single-file audiobook Notes behaviours that worked before this feature (add, list, edit, delete, jump, timeline markers, existing saved data) still work with identical results.
- **SC-007**: A track that cannot be played never makes the player or the Notes view unusable: in 100% of tested failure cases the user sees which track failed and can keep using the audiobook.
- **SC-008**: With the maximum supported number of Notes on the maximum supported number of tracks, opening and scrolling the Notes view remains smooth (no visible freeze longer than 1 second).
- **SC-009**: No PDF or EPUB annotation is created, changed or lost as a result of this feature, and no Note ever leaves the device.

## Assumptions

- **Scope of audiobooks**: "Multi-track" means an audiobook with two or more tracks made from a ZIP archive. A ZIP with one selected track is already imported as an ordinary single-file audiobook and keeps the existing single-file Notes.
- **Release gating**: The ZIP import entry point remains controlled by the existing release switch. This feature does not turn that switch on and does not change when the capability reaches end users; it must work for multi-track audiobooks that already exist in a user's library.
- **Plan documents are not assumed implemented**: Where the plans and the repository differ, this spec follows the repository (see Current State). The plans' Stage C item "Notes for multi-track books" is what this feature delivers; the other Stage C items remain out of scope.
- **Same Note model**: Notes in multi-track audiobooks behave like single-file Notes in every way not stated here — optional text, one shared menu from every entry point (list, timeline marker, add control), and the same maximum count and text length.
- **Limit notice (FR-023)**: the "limit reached" notice applies to multi-track audiobooks only. Single-file audiobooks keep their current behaviour at the limit unchanged (FR-027).
- **Order of the list**: The single Notes view is a flat list in playback order; grouping by track with collapsible headers is a presentation choice and not required.
- **Play state on jump**: Jumping to a Note preserves play/pause state, consistent with how choosing a track in the Contents list already behaves.
- **Timeline markers (Story 5)** are only for the current track, because the multi-track seek bar is per track; there is no whole-book bar.
- **Adding while paused** is allowed and records the paused position.
- **Notes during errors**: A track that failed to load has no valid playback position, so no Note can be added there, but its existing Notes stay listed, editable and deletable.
- **Existing Notes are not migrated**: Multi-track audiobooks have never been able to hold Notes, so there is no existing data to convert; single-file Notes keep their current form.
- **Track identity is stable**: Tracks of an imported audiobook are fixed at import time (they are not added, removed or reordered afterwards), so a stored track reference stays valid for the life of the audiobook.
- **Local only**: Notes live only on the user's device in the app's existing local storage; no account, network or cloud service is involved.
- **Dependencies**: Relies on the existing multi-track playback (switching tracks, per-track position), the existing Notes menu and the existing local persistence for reading data.
