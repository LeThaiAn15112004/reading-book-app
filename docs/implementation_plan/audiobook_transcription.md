# Audiobook transcription (spec 004: transcribe, follow and seek, search and export)

Specification, plan, contracts and tasks live in `specs/004-audiobook-transcription/` (read `spec.md`, `plan.md`,
`contracts/ipc-transcription.md`, `data-model.md`, and the decisions in `research.md` R1–R13). This file is the short map of
what was built and the rules that must not be broken. Scope: **audiobooks only** (single-file and multi-track, from the
ZIP import). An audiobook that is never transcribed behaves exactly as before (FR-016 / SC-007).

## Invariants

- **On device only.** The audio is decoded and transcribed locally; nothing audio-related is ever sent anywhere (FR-013).
  The only network traffic is the one-time download of a speech model, started by a button that says so.
- **Models are verified, never trusted.** Every model file is pinned (full commit id, size, SHA-256 in
  `electron/transcription/transcription-models.ts`, produced by `model-manifest.md`), downloaded into a `.partial` folder,
  hashed, then moved into place; the engine re-hashes on load. A mismatch is `INTEGRITY_FAILED` and nothing is installed.
- **Decoding is our own LGPL FFmpeg, spawned with an argv array** (`audio-decoder.ts`): never `ffmpeg-static`, never a system
  `ffmpeg`, never a shell, and only after the binary's SHA-256 matches the build record. **It is not integrated yet**
  (tasks T001 / T001a / T001b, blocked on the owner): until then `transcription:start` answers `DECODE_FAILED`
  ("the audio decoder is not available on this system") instead of starting a job that cannot work.
- **Whisper runs in a separate OS process, never a worker thread** (research R11): ONNX Runtime cannot be interrupted, and
  terminating a thread that is inside it crashes the whole app. `speech-process-host.ts` owns the process; cancel = graceful
  interrupt, then the process is killed after 2 s; a crash or kill fails only that request.
- **A request can never hang** (research R12): a watchdog ends it as `DECODE_FAILED` after 120 s of silence while loading /
  180 s while transcribing one window, a liveness probe notices a dead process, a closed IPC channel is `ipc-lost`; a user
  cancel always wins and ends `ABORTED`, never a timeout.
- **What is committed stays.** One transaction per 30 s window writes its passages and its covered interval together
  (`SqliteTranscriptStore.commitWindow`). Cancel, failure, quit or a crash never remove finished windows and never leave a
  transcript `complete` unless the requested scope is covered. Startup recovery turns a job that died with the process into
  `partial` / `failed` + `INTERRUPTED` (never `complete`) before `transcription:start` can be served; nothing restarts by
  itself, **Resume** is `start` again and skips covered intervals.
- **The renderer never gets a path.** It names a `bookId` / `trackId` / model id / job id. The export's save dialog and file
  write are Main's; the renderer learns `{ saved }` and an error text.
- **The book file and the audio progress are never touched.** Transcripts are overlay data in SQLite
  (`books.reading_state_json` is not written).

## Pieces

| Where | What |
|---|---|
| `book-reader-sdk/src/transcription/` | pure model: types, `range-merge`, `window-plan` (30 s windows, 2 s overlap), `active-passage` (binary search by track + position), `transcript-export` (text, `[hh:mm:ss]`, file name), `languages` (Whisper languages, default language) |
| `electron/persistence/migrations/029_audio_transcripts.sql`, `030_audio_transcript_scope.sql` | `audio_transcripts` (one per book, `covered_json`, `job_state`, `last_error`, `scope_json`), `audio_transcript_passages`, FTS5 `audio_transcript_fts` |
| `electron/persistence/sqlite-transcript-store.ts` | get / ensure / `commitWindow` / paged `getPassages` / `search` / job markers / `recoverInterrupted` / replace / delete |
| `electron/transcription/transcription-service.ts` | the queue, start validation, scopes, the decode → speech → commit loop, progress, outcomes, search, export text, model removal |
| `electron/transcription/speech-process-host.ts`, `transcription.process.ts`, `whisper-engine.ts` | the speech process, its watchdog and the `transformers.js` Whisper pipeline |
| `electron/transcription/model-manager.ts`, `transcription-models.ts` | verified download / list / remove of `whisper-tiny`, `-base`, `-small` under `{userData}/transcription-models` |
| `electron/transcription/audio-decoder.ts`, `ffmpeg-artifacts.ts` | FFmpeg spawn (16 kHz mono float32 windows); the verified-artifact table is empty until T001 |
| `electron/transcription/transcription-runtime.ts` | the only place that wires real collaborators (`electron`, library, `music-metadata`); startup recovery; quit |
| `electron/transcription/transcript-export-file.ts`, `speech-model-usage.ts`, `audio-language-tag.ts` | export with a Main-owned dialog (effects injected), size of downloaded models, the audiobook's own language tag |
| `electron/ipc/transcription.ipc.ts`, `preload.ts`, `src/bridge/transcription.ts` | `transcription:*` (getInfo, start, cancel, downloadModel, getPassages, search, export, delete + progress / passagesAdded / modelProgress events) |
| `electron/storage/storage-service.ts` | Settings → Storage lists the speech models with their size and removes one (refused while a transcription runs) |
| `src/screens/AudioBook/logic/transcriptStore.ts` | renderer state: summary, job, passages (paged), active passage, search, export, actions |
| `src/screens/AudioBook/components/TranscribeDialog.tsx`, `TranscriptPanel.tsx` | the dialog (scope, language, model, explicit download), the Transcript tab (progress, passages, follow, search, export, Resume / Restart / Delete) |

Following and seeking reuse the player: the active passage is derived from `audioPlayerStore` (current track + position) and
"play from here" is `goToPosition`, the same path as a Note jump (exact second, play state kept, back to the origin track if
the target cannot be played).

## Checks

All run without opening the app (`spike:transcription:main`, `:store`, `:sidebar` use Electron's binary as plain Node or plain
Node — no window):

```
cd source/apps/reading-book-desktop
npm run spike:transcription:main     # service, watchdog, recovery after a REAL process kill, search, export, storage models
npm run spike:transcription:store    # the real renderer stores against the real service (+ the real audio player store)
npm run spike:transcription:sidebar  # the text reader's sidebar is unchanged
npm run spike:transcription:smoke    # the real Whisper process, the real model, abort / kill / recovery (needs the model once)
```

`spike:transcription:smoke` criterion 4 (host heartbeat ≤ 500 ms) is a **documented, non-blocking limitation** under heavy CPU
load (owner decision, research R13); the threshold and the assertion are unchanged and it still prints FAIL when it fails.

## Release gate (T033)

`features.audiobookTranscriptionEnabled` (`packages/config/features.ts`) is `false` until the own-build FFmpeg is integrated and verified. OFF: no Transcribe entry, no Transcript tab, nothing bound in `AudioBookScreen`; Main's `start` and `downloadModel` answer `FEATURE_DISABLED` first (service option `isEnabled`, wired in `transcription-runtime.ts`). ON or OFF, the decoder is probed before any model download (`DECODE_FAILED`, not `MODEL_MISSING`) and `getInfo.decoder` feeds the dialog. Gate test: `book-reader-sdk/tests/config/audiobook-transcription-gate.test.ts` (committed value must not be `true`; a working copy may enable it only when `FFMPEG_ARTIFACTS` has real SHA-256 entries for win32-x64, darwin-arm64, darwin-x64). Enabling = flip the flag and that test's expectations in one release commit after T001/T001a/T001b and the T036 manual run.

## Not built / still open

- The own-build FFmpeg (T001 / T001a / T001b) — so no real audio can be transcribed yet; T036 (the quickstart on a real MP3
  and a multi-track book, and the SC-002 / SC-004 measurements) needs it.
- The React panels and dialogs have not been exercised in a window (only compiled and tested through their stores): see the
  manual checks in `specs/004-audiobook-transcription/quickstart.md`.
