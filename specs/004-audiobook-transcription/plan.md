# Implementation Plan: Audiobook Transcription

**Branch**: `004-audiobook-transcription` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-audiobook-transcription/spec.md`

## Summary

On-device speech-to-text for audiobooks (single-file and multi-track), run as a cancellable background job in a worker thread, producing time-stamped passages stored in SQLite (new migration, FTS-indexed) and shown in a transcript sidebar tab that follows playback, seeks on click, searches and exports. Approach: decode audio to 16 kHz mono PCM in bounded windows with a bundled ffmpeg binary, run Whisper (ONNX via the already-present `@huggingface/transformers`) in a dedicated worker mirroring the translation worker, commit passages per finished window so partial results are readable and a cancel/crash never leaves a "complete" transcript that is not.

## Technical Context

**Language/Version**: TypeScript (strict), Node 20 / Electron main + worker threads, React renderer

**Primary Dependencies**: existing `@huggingface/transformers` ^4.3 (Whisper ONNX pipeline, as the translation engine already does), `better-sqlite3` + FTS5 (existing), new: a self-built minimal LGPL decode-only FFmpeg shipped as a separate executable (win32-x64, darwin-arm64, darwin-x64; research R2/B3 — not yet built; NOT the `ffmpeg-static` npm package); models pinned by revision + SHA-256 manifest (research R5)

**Storage**: SQLite overlay tables via numbered migration 029 (`audio_transcripts` incl. `job_state`/`last_error` for crash recovery, `audio_transcript_passages` read in `book_audio_chapters.position` order, FTS table); model files under `{userData}/transcription-models/`

**Testing**: SDK vitest for pure logic (window planning, range merge, passage merge/normalise, active-passage lookup, export formatting); desktop spike scripts for Main side (`spike:transcription:main`, `spike:transcription:store`) per repo convention; no E2E runs

**Target Platform**: Desktop, matching `electron-builder.json5`: Windows x64 (NSIS), macOS (dmg; two separate FFmpeg binaries, `darwin-arm64` and `darwin-x64`, no universal binary — owner decision 2026-10-27), Linux AppImage (transcription NOT supported there until a Linux FFmpeg binary is built and verified — owner decision 2026-10-27). CI builds/tests run on Ubuntu only, so Windows and macOS behaviour (ffmpeg binary, signing, worker bundle) is verified manually. Mobile out of scope

**Project Type**: desktop-app (Electron + React) with shared SDK

**Performance Goals**: 1 h audio < 30 min on a typical laptop CPU (SC-003); UI responsive during job; cancel < 5 s (SC-006); passage-to-time error < 2 s (SC-004)

**Constraints**: offline after model download; audio never leaves the device (FR-013); original audio never modified (FR-006); never touch non-transcribed audiobook behaviour (FR-016); renderer never sees file paths; SDK `src` stays free of Node/DOM/electron

**Scale/Scope**: books up to ~30 h, ~10 passages/min → < 20k rows per book; one active job at a time globally (others queued)

## Constitution Check

`.specify/memory/constitution.md` is still the unfilled template, so there are no project-specific gates. The plan is checked against the binding rules in `CLAUDE.md` instead:

- SDK dependency rule (no electron/node/DOM in `book-reader-sdk/src`) — PASS: only pure logic in SDK; ffmpeg, worker, SQLite stay in `electron/`.
- IPC rule (channels.ts → `*.ipc.ts` → preload → `src/bridge`, DTOs, no paths in renderer) — PASS, see contracts.
- Book file never mutated; overlay data in SQLite keyed by `bookId` — PASS.
- Migrations numbered, run via `migrate.ts` — PASS (029).
- Unit tests only in SDK; desktop uses spikes — PASS.
- Audiobook invariants (one canonical `currentTime`, multi-track `trackId`, `rb-audio` Range streaming untouched) — PASS: transcript only reads positions and calls existing seek/openTrack actions.

Re-check after Phase 1: no violations; Complexity Tracking empty.

**Blocking prerequisites before implementation (research R2, R5, R10)**: B3 own LGPL FFmpeg build built, tested on Windows and macOS, licence-audited and legally signed off (T001a, T001b — BLOCKED, nothing built yet), B1 model manifest (revision + SHA-256) — DONE for the `q8` set (T013a, 2026-10-27), runtime completeness still to be confirmed by T014a, B2 SHA-256 of every produced FFmpeg artifact (recorded by T001a), and the T014a Whisper-in-worker smoke test must pass before T015 and its dependents — **T014a FAILED on criterion 6 (abort) on 2026-10-27, so the gate is closed**: terminating a worker thread mid-inference crashes the whole process and a graceful cancel can exceed 5 s under load; see research.md R11 for the evidence and the options (recommended: run the speech engine in a separate process).

## Project Structure

### Documentation (this feature)

```text
specs/004-audiobook-transcription/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ipc-transcription.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
source/apps/book-reader-sdk/src/transcription/        # pure, platform-agnostic
├── transcript-model.ts       # Passage/Transcript/Job types, status, covered ranges
├── window-plan.ts            # split a range into overlapping decode windows
├── range-merge.ts            # merge/dedupe ranges and passages across runs
├── active-passage.ts         # passage at time/track (binary search)
├── transcript-export.ts      # plain-text export
└── index.ts
source/apps/book-reader-sdk/tests/transcription/*.test.ts

source/apps/reading-book-desktop/electron/transcription/
├── transcription.worker.ts   # Whisper pipeline host (own bundle entry in vite.config.ts)
├── transcription-job.ts      # worker message types
├── transcription-service.ts  # queue, one active job, cancel, progress, resume
├── audio-decoder.ts          # spawn our own LGPL ffmpeg (resources/ffmpeg/<platform>-<arch>/) → 16 kHz mono f32 windows; hash-checked before spawn
├── model-manager.ts          # pinned-revision download, SHA-256 verify, cache dir, disk-space check
specs/004-audiobook-transcription/model-manifest.md   # pinned model revisions + checksums (B1) and FFmpeg artifact hashes (B2)
specs/004-audiobook-transcription/ffmpeg-build-record.md   # build spike evidence, licence audit, source archive, notices (B3)
source/apps/reading-book-desktop/electron/ipc/transcription.ipc.ts
source/apps/reading-book-desktop/electron/persistence/sqlite-transcript-store.ts
source/apps/reading-book-desktop/electron/persistence/migrations/029_audio_transcripts.sql
source/apps/reading-book-desktop/electron/ipc/{channels.ts,api-types.ts,index.ts}, preload.ts   # edited
source/apps/reading-book-desktop/src/bridge/transcription.ts
source/apps/reading-book-desktop/src/screens/AudioBook/logic/transcriptStore.ts   # zustand
source/apps/reading-book-desktop/src/screens/AudioBook/components/{TranscriptPanel,TranscribeDialog}.tsx
source/apps/reading-book-desktop/spikes/transcription/
```

**Structure Decision**: follow the existing translation-worker + SQLite-store + zustand-store pattern. The Transcript tab is a new sidebar tab in `AudioSidebar` beside Notes; seeking reuses the player store's existing seek / `openTrack` actions.

## Complexity Tracking

No constitution violations. One justified addition: a bundled native binary (our own LGPL FFmpeg build) — see research R2 for why Chromium decoding is not enough and why `ffmpeg-static` (GPL) is rejected.

## Gate decision and known limitation (T014a, 2026-10-27)

The speech engine runs in a separate process (research R11 option A) with a watchdog (R12). By owner decision (research R13), criterion 4 of the T014a smoke test — host heartbeat gap ≤ 500 ms — is a **documented, non-blocking performance limitation** under extreme CPU saturation: the 500 ms threshold and its assertion are kept (it still reports FAIL when it fails) but it no longer stops Phase 3. All correctness, cancellation, process-isolation, watchdog and recovery criteria stay in force. T014a is not marked complete.
