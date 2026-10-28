# Feature Specification: Audiobook Transcription

**Feature Branch**: `004-audiobook-transcription`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "tôi muốn làm chức năng trích văn bản từ audio trong audio book" (extract text from the audio in an audiobook)

## Clarifications

### Session 2026-10-28

- Q: Ở bản phát hành đầu tiên, nếu bản Mac chưa có FFmpeg, người dùng Mac sẽ thấy tính năng chép lời như thế nào? → A: A — chỉ bật trên nền tảng có FFmpeg đã xác minh (Windows trước); trên nền tảng khác ẩn hẳn nút Transcribe và tab Transcript, như khi cờ tắt.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Transcribe an audiobook into text (Priority: P1)

A listener opens an audiobook in their library and asks the app to turn its spoken audio into written text. The app processes the audio in the background, shows progress, and when finished the listener can read the full transcript for that audiobook. The rest of the app stays usable while transcription runs.

**Why this priority**: Producing the text is the whole feature. Without it nothing else (reading along, searching, exporting) has value.

**Independent Test**: Import an audiobook with clear speech, start transcription, wait for completion, and confirm a readable transcript exists whose content matches what is spoken.

**Acceptance Scenarios**:

1. **Given** an audiobook with no transcript, **When** the user chooses "Transcribe", **Then** the app starts processing, shows progress, and keeps the rest of the app usable.
2. **Given** transcription has finished, **When** the user opens the audiobook's transcript, **Then** they see the full spoke/n text in reading order.
3. **Given** transcription is running, **When** the user cancels it, **Then** processing stops and no partial transcript is presented as complete.
4. **Given** an audiobook that already has a transcript, **When** the user views its details, **Then** the app shows that a transcript exists instead of offering to start again by default.

---

### User Story 2 - Follow the text in sync with the audio (Priority: P2)

While listening, the user sees the transcript with the passage currently being spoken highlighted. Selecting any passage in the transcript jumps playback to that moment in the audio.

**Why this priority**: Linking text to audio position is what makes a transcript more useful than a plain text file, but it depends on Story 1.

**Independent Test**: Play a transcribed audiobook and verify the highlighted passage tracks playback; select a passage and verify playback jumps to it.

**Acceptance Scenarios**:

1. **Given** a transcribed audiobook is playing, **When** playback moves forward, **Then** the passage being spoken is highlighted and kept in view.
2. **Given** the transcript is open, **When** the user selects a passage, **Then** playback jumps to the start of that passage.
3. **Given** a multi-track audiobook, **When** the user selects a passage that belongs to another track, **Then** playback opens that track at the matching position.

---

### User Story 3 - Search and export the transcript (Priority: P3)

The user can search for a word or phrase inside a transcript, see where it occurs, and jump to that moment. They can also export the transcript as a plain text file to use elsewhere.

**Why this priority**: Valuable follow-ups that make transcripts useful beyond reading along, but not needed for a first usable release.

**Independent Test**: Search for a known spoken word in a finished transcript and confirm the matches and jump targets are correct; export and confirm the file contains the transcript text.

**Acceptance Scenarios**:

1. **Given** a finished transcript, **When** the user searches for a phrase, **Then** all matches are listed and selecting one jumps playback to it.
2. **Given** a finished transcript, **When** the user exports it, **Then** they choose a destination and receive a plain text file with the full transcript.

---

### Edge Cases

- The audiobook has no speech (music only, silence) or very poor audio quality: the app reports that little or no text could be extracted rather than showing an empty transcript as success.
- The audiobook is very long (many hours) or has many tracks: progress is shown per track and overall, and transcription of an unfinished book can be resumed or cancelled without losing finished tracks.
- The user closes the app or the audiobook file is moved/removed mid-transcription: the job stops safely, no corrupt transcript is kept, and the user can restart it.
- The audiobook's spoken language is not supported or differs from the chosen language: the app tells the user and lets them pick another language.
- The user removes the audiobook from the library: its transcript is removed with it.
- Not enough free disk space or required language data is missing: the app explains what is needed before starting.
- The user starts transcription for a second audiobook while one is running: the second waits in a queue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to start transcription for any audiobook in their library from the app.
- **FR-002**: The system MUST convert the spoken audio of the audiobook into text covering the whole audiobook, including every track of a multi-track audiobook, in playback order.
- **FR-003**: The system MUST run transcription in the background, show overall progress (and per-track progress for multi-track books), and keep the rest of the app usable.
- **FR-004**: Users MUST be able to cancel a running transcription; cancelling MUST NOT leave an incomplete transcript presented as complete.
- **FR-005**: Users MUST be able to choose the spoken language, with a sensible default (the audiobook's language tag when present, otherwise the app language).
- **FR-006**: The system MUST store each transcript with the audiobook so it is available offline and after restarting the app, without modifying the original audio file.
- **FR-007**: The system MUST associate each passage of the transcript with its time position (and track) in the audio.
- **FR-008**: Users MUST be able to view the transcript in reading order and, during playback, see the currently spoken passage highlighted.
- **FR-009**: Users MUST be able to select a passage to jump playback to its position.
- **FR-010**: Users MUST be able to search within a transcript and jump to a match.
- **FR-011**: Users MUST be able to export a transcript as a plain text file to a location they choose.
- **FR-012**: Users MUST be able to delete a transcript, and re-run transcription to replace it after confirming.
- **FR-013**: The system MUST process audio on the user's device by default; audio MUST NOT be sent to any external service without the user's explicit consent.
- **FR-014**: The system MUST report clear, actionable errors (unsupported language, missing language data, insufficient disk space, unreadable or missing file, no speech found).
- **FR-015**: Removing an audiobook from the library MUST also remove its transcript.
- **FR-016**: Audiobooks that are not yet transcribed MUST behave exactly as today (playback, Notes, progress unaffected).
- **FR-017**: Transcription MUST be offered only on a platform (OS + CPU architecture) whose bundled audio decoder has been built and verified for it; on any other platform the Transcribe entry and the Transcript tab MUST be hidden exactly as when the feature is off, and no speech model may be downloaded. A platform is enabled only when a verified decoder for it ships in the installer.

### Key Entities

- **Transcript**: The text extracted from one audiobook. Belongs to exactly one audiobook; has a language, a status (not started, in progress, complete, failed, cancelled), and a creation time.
- **Transcript Passage**: A short unit of transcript text (about a sentence or phrase) with the track it belongs to and its start and end time inside that track. Passages are ordered and together form the transcript.
- **Transcription Job**: A single run of transcription for an audiobook, with chosen language, progress (overall and per track), and outcome. At most one job per audiobook is active at a time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can start transcription of an audiobook in at most 3 interactions from the library.
- **SC-002**: For clearly spoken audio in a supported language, at least 90% of spoken words appear correctly in the transcript.
- **SC-003**: Transcription of a one-hour audiobook completes in under 30 minutes on a typical modern laptop, while the app remains responsive (no visible freezing during use).
- **SC-004**: 100% of transcript passages jump to a playback position within 2 seconds of the actual spoken moment.
- **SC-005**: A finished transcript is available after restarting the app and with no network connection.
- **SC-006**: Cancelling a running transcription stops processing within 5 seconds.
- **SC-007**: Existing audiobook behavior (playback, seeking, Notes, progress) shows no regressions for books with and without transcripts.

## Assumptions

- Transcription targets spoken-word audio; music, singing, and heavy background noise are not guaranteed to give good results.
- Processing is done on the user's device (consistent with the app's local-first design); any cloud option is out of scope for this feature and would require its own explicit-consent design.
- The feature is for the desktop app; mobile is out of scope for this version.
- First release platform: Windows x64. macOS (arm64, x64) joins when its decoder is built, signed and verified (FR-017); until then Mac users get the app without this feature, not an error.
- Transcripts are plain text with time positions; speaker identification, translation, and manual transcript editing are out of scope for v1.
- Language models/data needed for a language may need a one-time download, and the user is told before it happens.
- Audiobook formats already supported by the app (MP3 and the other audio formats, single-file and multi-track) are in scope.
- Existing audiobook playback, track, and Notes behavior is reused as the basis for jumping and highlighting.
