# Research: Audiobook Transcription

## R1 — Speech recognition engine

- **Decision**: Whisper (ONNX) through `@huggingface/transformers` `automatic-speech-recognition` pipeline, hosted in a worker thread. Default model `whisper-base` (multilingual); `whisper-small` offered as "better quality, slower"; `whisper-tiny` as "fast".
- **Feasibility is unproven until task T014a passes** (Whisper pipeline inside the real Vite/Electron worker). If it fails, implementation stops and the engine choice is revisited.
- **Rationale**: dependency already in the app (translation engine), runs fully offline after download, multilingual including Vietnamese, gives segment timestamps. Same worker/idle-unload/progress pattern already proven.
- **Alternatives**: whisper.cpp native binary (faster, but per-platform builds and signing); Vosk/sherpa-onnx (lighter, weaker accuracy/timestamps); cloud APIs (rejected by FR-013).

## R2 — Decoding audio to PCM

- **Decision (target, NOT yet built or verified)**: spawn our own minimal, decode-only, **LGPL** FFmpeg build (option A of the 2026-10-26 licence research) as a separate process to emit 16 kHz mono float32 PCM for one time window at a time (`-ss start -t length`), streamed to the worker. `ffmpeg-static@5.3.0` is NOT used: its Windows binary is a gyan.dev GPL v3 build with libx264/libx265, its macOS binaries list GPL libraries (x264, x265, xavs) or carry no build info (arm64), and its installer downloads binaries without any hash check.
- **Rationale**: an hour of audio decoded by Web Audio is >1 GB in memory; windowed ffmpeg keeps memory bounded, supports every audio format the app imports (MP3, M4A/M4B, AAC, WAV, FLAC, OGG, Opus), and allows exact range selection (FR-001a).
- **Alternatives**: Chromium `decodeAudioData` (whole-file memory, renderer-only); JS/WASM per-format decoders (few formats); BtbN `win64-lgpl(-shared)` prebuilt (Windows only, LGPL **v3** via `--enable-version3`, 80–170 MB, dependency licences unchecked, daily tags are pruned — acceptable only as a stop-gap for Windows after its own audit); third-party macOS "LGPL" binaries (none verified). Cost accepted: we own a small build pipeline for 3 artifacts, and the installer grows by the size of our minimal build (expected single-digit MB; unmeasured).

**BLOCKING PREREQUISITE B3 — own LGPL FFmpeg build (status: BLOCKED, nothing built or tested yet)**

Chosen target: option A. Nothing below may be marked done from the planned configuration alone; each item needs the evidence named in tasks T001a/T001b recorded in `ffmpeg-build-record.md`.

Required conditions before a binary is accepted:
1. **Configuration**: built WITHOUT `--enable-gpl`, `--enable-nonfree` and `--enable-version3`; `--disable-autodetect` so no system library is picked up; `--disable-everything` followed by an explicit allow-list of only what decoding needs. Intended starting point (a hypothesis the spike must confirm or correct, not a verified recipe): demuxers/parsers/decoders for MP3, AAC/ALAC in MP4-family containers (M4A, M4B), FLAC, Ogg (Vorbis and Opus), WAV/PCM; the file protocol; `aresample` plus the raw float32 PCM output path; no encoders other than the raw PCM one used for output, no video, no network, no devices. The accepted list is whatever the spike proves necessary, no more.
2. **No GPL or nonfree code**: `ffmpeg -L` must report LGPL (v2.1 or later), `-buildconf` must show none of the forbidden flags, and the linked-library inventory of every binary (`otool -L` / `dumpbin /dependents` plus the build log) must contain only FFmpeg's own libav* libraries and system/OS libraries — no x264, x265, xavs, fdk-aac, faac, openssl, gnutls or other third-party library unless its licence has been audited and recorded.
3. **Dependency licence audit**: a table of every library linked into or shipped with each artifact (name, version, licence, compatibility with LGPL v2.1+, source location). Empty third-party list is the expected outcome and must be proven, not assumed.
4. **Linking**: FFmpeg's checklist recommends dynamic linking (Windows DLLs). The spike decides shared (`ffmpeg` + `avcodec`/`avformat`/`avutil`/`swresample` DLLs/dylibs next to it, `@loader_path` on macOS) vs static; if static is chosen the reason and the legal review's agreement must be recorded.
5. **Real decoding on real platforms**: MP3, M4A, M4B, FLAC, OGG (Vorbis), Opus (plus WAV and raw AAC, which the app also imports) decode to the expected 16 kHz mono float32 on Windows x64, macOS arm64 and macOS x64 (see T001a). Linux is not part of this build target; transcription is NOT supported on the Linux AppImage until a Linux binary is built and verified in practice (owner decision 2026-10-27). macOS gets two separate binaries, `darwin-arm64` and `darwin-x64` (owner decision 2026-10-27; no universal binary for now).
6. **Provenance and distribution evidence**: SHA-256 of every produced binary/library; the exact FFmpeg source (tag + commit, tarball with its own SHA-256) archived so it corresponds to the binaries; the exact configure command line and compiler/toolchain versions; the licence texts and notices to ship (`COPYING.LGPLv2.1`, FFmpeg notice, source-offer URL); plus the in-app notices per FFmpeg's legal checklist (About box, EULA/licence screen, download page note, no reverse-engineering ban).
7. **Legal sign-off**: a human/legal review of the obligations (LGPL for the separate process, the separate-process boundary, notices, patent exposure of AAC/M4B decoding — patent exposure is a separate question from licence terms and is not decided by an LGPL build). Until then LGPL compliance is NOT claimed.
8. **Packaging**: `extraResources` (not inside the asar), signing and notarization of every Mach-O on macOS, Windows SmartScreen/antivirus behaviour, executable bit not needed on Windows; none of this is verified yet.

## R3 — Windowing and timestamps

- **Decision**: 30 s windows with 2 s overlap; passages from the overlap are de-duplicated by keeping the later window's text when time ranges overlap >50%. Passage times stored as ms from the start of their file/track.
- **Rationale**: Whisper's native context is 30 s; overlap avoids cutting words; per-window commit gives resumability and partial reads (FR-001b).
- **Alternatives**: VAD-based splitting (better on long silences; deferred, can be added inside `window-plan.ts` later).

## R4 — Partial results, ranges and resume

- **Decision**: store `covered_ranges` per (transcript, track) as merged `[startMs,endMs)` intervals; each finished window commits passages + range in ONE transaction. Transcript status is `complete` only when requested range ⊆ covered; otherwise `partial`/`failed`/`cancelled`. A new run skips already-covered intervals.
- **Rationale**: satisfies cancel safety, crash safety, "add another range without redoing" (FR-001a/b, edge cases).
- **Alternatives**: all-or-nothing at end (rejected: loses hours of work).

## R5 — Language and models

- **Decision**: language = book metadata language when mapped to a Whisper code, else app language; user can override in the start dialog, or choose "Auto-detect". Model download is explicit (size shown, consent), cached in `{userData}/transcription-models/`; free-space check before download and before job (FR-014).
- **Rationale**: matches spec edge cases; avoids silent large downloads.

### Model source, pin and integrity (S1)

- **Source**: Hugging Face repos `onnx-community/whisper-tiny`, `onnx-community/whisper-base`, `onnx-community/whisper-small` (library `transformers.js`).
- **Pin (verified 2026-10-27)**: each model is downloaded at a fixed commit revision, never `main`: `whisper-tiny` `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`, `whisper-base` `1846881b6b3a3024392c1eea3ad983695bc23925`, `whisper-small` `36050c46d777d46dc4b5f43f6d90574fc38f8732` (details, file list and SHA-256 in `model-manifest.md`).
- **Verification**: after download and before loading, every file is hashed with SHA-256 and compared with the manifest entry; files are first written to a `.partial` location and moved into the model folder only on a match. On mismatch: delete the partial files, install nothing, fail with `INTEGRITY_FAILED` (the message says the download was corrupted or altered and to retry), and never load unverified files.
- **PREREQUISITE B1 — satisfied for the `q8` file set on 2026-10-27** (`model-manifest.md`: 21 files, SHA-256 from our own downloads of the pinned revisions, cross-checked with the Hub's metadata). Still open: runtime completeness of the file list and `q8` quality are proven only by T014a/T036; trust root is the Hugging Face host; licence is metadata evidence only (base models `openai/whisper-*`, apache-2.0 per Hub tags) and needs an owner decision on notices.
- **BLOCKING PREREQUISITE B2**: the same for our own FFmpeg artifacts — SHA-256 of each produced binary/library, recorded only after they are actually built (T001a) and listed in the manifest; no value exists yet.

## R6 — Storage and search

- **Decision**: new migration 029: `audio_transcripts`, `audio_transcript_passages` (+ FTS5 `audio_transcript_fts` mirroring existing `book_chunks_fts` style), `ON DELETE CASCADE` from `books`. Search is a FTS query returning passage ids/times.
- **Rationale**: FR-006, FR-010, FR-015. FTS5 is already verified in the migration spikes.

## R7 — Player integration

- **Decision**: transcript is a read-only consumer of `audioPlayerStore` (`currentTime`, current track); click → existing seek, or `openTrack(trackId)` + exact second (same clamp-only path as Note jump). Highlight uses SDK `active-passage` binary search driven by the store, not by polling the DOM.
- **Rationale**: keeps the "one canonical position" invariant and FR-016 (no change for untranscribed books).

## R9 — Interrupted jobs

- **Decision**: persist `job_state` on the transcript row while a job is queued/running; on startup reconcile any row left non-NULL to `partial`/`failed` with `last_error = INTERRUPTED` (never `complete`), keep all committed windows, and offer "Resume" (same scope, covered intervals skipped). See data-model "Startup recovery".
- **Rationale**: jobs live in memory, so the database is the only place that can say a previous process died mid-job; per-window commits (R4) make resuming cheap.

## R10 — Early feasibility smoke test

- **Decision**: task T014a runs a short fixture through the real worker bundle and checks responsiveness; T015 and everything that depends on it are blocked until it passes. Pass/fail is defined in tasks.md T014a.

## R8 — Privacy

- **Decision**: no network except the model download (Hugging Face hosting), triggered only after consent; no audio or text is sent anywhere.

## R11 — T014a result: Whisper in a worker thread (2026-10-27)

**Outcome: the gate FAILED on criterion 6 (abort). Criteria 1–5 pass.**

- What works (built `dist-electron/transcription.worker.js` on Electron-as-Node, `whisper-tiny` downloaded through our model manager and re-hashed, network blocked in the worker): the model loads from the verified folder offline; the fixture (synthetic speech, 6.7 s) is transcribed exactly (WER 0.0 %, one segment 0–6705 ms); the host heartbeat never gaps more than 243 ms on a quiet machine; 2.5–17 s end to end. Timing varies a lot between runs (transcribe 0.9 s to 12 s for the same 6.7 s of audio).
- What fails: aborting while the model is running.
  - Graceful cancel (`InterruptableStoppingCriteria`) answers `ABORTED` after about 2–3 s on a quiet machine, because the current ONNX call (the 30 s encoder pass) cannot be interrupted; under CPU load it can take more than the 5 s the criterion and SC-006 allow.
  - The fallback `worker.terminate()` while ONNX Runtime is executing **kills the whole process** with a native C++ exception (exit status `0xE06D7363`), on Electron-as-Node and on plain Node alike. In the app this would take Main down.
- Measurements (all with the same fixture; "abnormal" = host process died or criterion failed):
  - `spike:transcription:smoke` on a quiet machine: 34 runs, 6 abnormal (the first 14 runs 6; the last 20 consecutive runs 0) — not explained, but consistent with graceful answers occasionally exceeding 5 s.
  - Same spike with 16 busy CPU loops: 8 runs, 1 passed, 5 native crashes (`0xE06D7363`), 2 failures by time (5.4 s, no crash).
  - Isolated experiment (not in the repo): graceful cancel never crashed (10 runs under full CPU load, 24 quiet); `terminate()` 1.5 s into inference crashed in 4 of 5 runs on each runtime, `terminate()` before inference started (150 ms) was clean 10 of 10.
  - Alternative: the same Whisper code in a separate OS process (Electron-as-Node child), `SIGKILL` 1.5 s into inference under full CPU load — the parent survived 6 of 6; the time until the exit event was noisy (0.1–5.4 s) only because the machine was saturated.
- Consequences:
  1. A `worker_threads` worker must NEVER be hard-terminated while it is inferring; only a graceful cancel is safe, and its latency is bounded below by the current ONNX call. As specified (worker thread, hard stop within 5 s) SC-006 cannot be guaranteed.
  2. Independently of cancelling, any native crash inside ONNX Runtime in a worker thread takes the whole app down; in a child process it only ends the job.
- Options for the owner (nothing implemented):
  - **A (recommended): run the Whisper engine in a separate process** (Electron `utilityProcess` or a forked child) with the same engine module and message protocol; cancel = graceful interrupt, then kill the process if there is no answer within a short time; a crash or kill only fails that job (the transcript keeps its committed windows). Costs: process start and model load per job (about 1.5–4.5 s measured), structured-clone of audio over IPC (a 30 s window is 1.9 MB) and a small change to T014/T015.
  - B: keep the thread, never terminate it while busy, and redefine SC-006 at job level ("the job shows cancelled within 5 s; the current window finishes in the background and is discarded"). Does not remove the crash exposure.
  - C: smaller decode windows to shorten the uninterruptible call (cost: more windows, worse context); does not remove the exposure either.
- Rule from T014a: no dependent task (T015 onward) starts until the owner picks an option and the smoke test is rerun and passes.

## R12 — T014a re-run after option A: Whisper in a separate process (2026-10-27)

Owner chose option A (R11). The engine runs in a child process owned by `speech-process-host.ts` (`transcription.process.js`, forked); `spike:transcription:smoke` was amended to 9 criteria (adds forced kill of a busy process, external kill = native crash, recovery on a fresh process). Nothing below was tuned to pass.

- **Quiet machine, 6 runs: 6 × PASS (9/9).** Load 1.3–2.6 s, transcribe about 1.1 s, WER 0.0 %, graceful abort answered by a forced kill after the 2 s grace (2003 ms), forced kill of the busy process 30–55 ms, external kill 56–331 ms, heartbeat gap 163–390 ms.
- **16 busy CPU loops on a 16-core machine, 3 runs: 0 full passes.** Criteria 1, 2, 3, 5, 6 (abort ≈ 2.0 s), 7 (forced kill 46–55 ms) and 9 pass in all 3 runs — the scenario that crashed the thread version (kill during inference) no longer takes the host down. Failures: **criterion 4** (host heartbeat gap 523 ms, 711 ms, 1674 ms; the gaps sit in spawn / first request while the host thread itself is starved of CPU) in all 3 runs; **criterion 8** once (external kill of the busy process: the host had no answer after 20 s — the `exit` event never arrived in that run).
- Reading: the abort / crash-isolation goal of the gate holds (also under load); the responsiveness criterion fails under full CPU saturation, and external-crash detection can be late under it. T015 should add a request watchdog (a request with no message for N seconds kills the process and fails with `DECODE_FAILED`) so a missed `exit` event cannot hang a job.
- **Gate status: NOT declared passed.** The gate text says PASS needs all criteria; under load it did not. Owner decision needed: accept "quiet 9/9 + abort/isolation criteria under load" as PASS (with the watchdog added in T015), or require criterion 4 / 8 under saturation too.

### R12 addendum — owner decision on the gate, and the watchdog (T015)

**Owner decision (2026-10-27): option A stays (separate process); add a watchdog in T015; do not go back to a worker thread; do not loosen the 500 ms limit.** T014a is recorded as having confirmed its main goal (cancelling a transcription no longer takes the application down in the runs reported) but is **NOT marked passed**, because the agreed acceptance text (all criteria) is not met under high CPU load.

**Watchdog (implemented in `electron/transcription/speech-process-host.ts`, so every request of every job gets it):**
- The spec and research did not set a limit, so the values come from the measurements above: model load 1.3–3.6 s and one window 0.9–12 s for a 6.7 s clip (about 1.8× the audio at worst, under CPU saturation). Defaults: **120 s** of silence while the process starts / loads the model (`loadTimeoutMs`) and **180 s** of silence while it transcribes one 30 s window (`windowTimeoutMs`) — more than 10× the worst measured value, so a slow machine or a larger model is not killed for being slow, while a hung process still ends in minutes, not never. Every message from the process (each stage) restarts the clock for its phase. Both are options so the service can raise them per model.
- A **liveness probe** every 2 s (`livenessIntervalMs`) asks the OS whether the process still exists (`process.kill(pid, 0)`), because the exit / disconnect events depend on the host's own event loop and were once never delivered within 20 s under load. A closed IPC channel is reported as `ipc-lost` and the process is killed.
- Every failure is `DECODE_FAILED` with a distinct `reason` on `SpeechProcessError`: `timeout`, `process-exit`, `ipc-lost`, `send-failed` (plus `engine`, `cancelled`, `cancel-unanswered`, `disposed` for the other paths). A **user cancel always wins**: it disarms the watchdog and the request ends `ABORTED` (never a timeout). All timers and the abort listener are released in one place (`finish`); a late timer or a late message from a killed process cannot touch a newer request. (A bug found by the new tests: arming the timers after `send` leaked them when the reply was delivered inside `send`; they are now armed first.)
- Tests: `spike:transcription:main` section E, 12 checks with fake processes and real short timers (hung process + queued request, progress restarts the clock, silent transcribing phase, unexpected exit, missing exit event, lost IPC, cancel vs watchdog, answered cancel, result just before the deadline, stale callbacks, cleanup of timers / listeners / dispose, failing send, engine error keeps its code).

**Smoke test after the watchdog (`spike:transcription:smoke`, nothing tuned):**
- Quiet machine: 8 runs, 7 × 9/9; one run failed criterion 4 (796 ms, first request, right after a build).
- 16 busy CPU loops (16 cores): criteria 1, 2, 3, 5, 6, 7, 8, 9 pass in every run, including **criterion 8 (external kill) 7 of 7 runs, detected in 0.1–1.1 s** (before the probe change: 7–15 s, and once not within 20 s). **Criterion 4 (host heartbeat ≤ 500 ms) still fails**: 4 contaminated runs (another job was running at the same time: 979–11 983 ms) and 3 clean runs (792 ms, 1222 ms fail; 237 ms passes). The long gaps are in spawn / first request, where the host process itself competes for CPU with the busy loops; the 500 ms limit was NOT relaxed.
- Reading: crash isolation and abort criteria hold under load, hang / dead-process detection is now bounded; host responsiveness under full CPU saturation is not met. **T014a stays open** against its all-criteria text. T015 may proceed with this limit recorded.

## R13 — Gate decision for T014a criterion 4, and what the transcription service (Phase 3) does (2026-10-27)

**Owner decision: criterion 4 of the T014a smoke test (host heartbeat gap ≤ 500 ms) does NOT block Phase 3.** Reasons given: Readmate Reader is a local desktop reading app; CPU saturation and scheduling differ across machines; the evidence is that the latency criterion fails only under artificial saturation (16 busy loops on 16 cores) while quiet-machine runs generally pass.

How the decision is applied (nothing weakened):
- Criterion 4 keeps its 500 ms threshold and its assertion in `spike:transcription:smoke`; it still prints FAIL (and the script still exits 1) when it fails. Only the closing message changed: a run where criterion 4 is the ONLY failure now says it is a documented non-blocking limitation. Any other failed criterion still stops the work.
- It is **not** claimed as passed. Evidence kept: quiet machine 9/9 in 14 of the 16 runs recorded since the process split (the two failures were criterion 4 on the first request: 796 ms and 644 ms); under 16 busy loops criterion 4 failed in 2 of 3 clean runs (792 / 1222 ms; 237 ms in a run where the loops did not saturate) and in every run that was disturbed by other work.
- The criteria that protect correctness stay in force and passed in every run, quiet and loaded: model verified and loaded offline (1), WER (2), segments (3), time to first result (5), abort ≤ 5 s without crashing the host (6), forced kill of a busy process (7), external kill = only that request fails (8, now 7 of 7 under load), recovery on a fresh process (9), plus the watchdog tests (R12 addendum).
- **Known limitation (user-visible only under extreme CPU load):** while the machine is fully saturated the app's main process can stall for more than half a second around starting the speech process or its first request. Transcription itself, cancelling, crash isolation and recovery are not affected.
- T014a itself stays unchecked in `tasks.md` (its text says all criteria); the dependent tasks proceed under this recorded decision.

### What Phase 3 built (and the choices it made where the spec was silent)

- **Service** (`electron/transcription/transcription-service.ts`, Electron-free, collaborators injected): one global queue, one active job; start validation per the contract (`INVALID_ARGUMENT` for an unknown / non-audio book, a bad range, a `trackId` on a single-file book or of another book, a range of a multi-track book without a track, a second job for the same book; `UNSUPPORTED_LANGUAGE`; `MODEL_MISSING` for a known model that is not installed; `DECODE_FAILED` when the audio decoder is unavailable). Nothing is persisted for a refused start.
- **`job_state` marker** is set when the job is accepted and cleared by `endJob` whenever it ends, so startup recovery (`recoverInterrupted`, called from `main.ts` after the database opens and before the IPC handlers are registered) can find a job that died with the process. Nothing restarts by itself; **Resume** is `start` again, covered intervals are skipped. Resume starts the scope the last job had (stored in `scope_json`, migration 030, T038); a transcript with no stored scope, or one that is already complete, continues with the whole audiobook.
- **Progress**: `totalMs` = the requested scope, `doneMs` starts at what is already covered (a resumed job begins at its real percentage), multi-track jobs add `trackId` / `trackDoneMs` / `trackTotalMs` from the very first running snapshot; snapshots are throttled to one per 250 ms, state changes are always delivered.
- **Outcomes**: finished → `complete` (the requested scope is covered); finished with no passage at all → `complete` + `lastError NO_SPEECH`; cancelled → `cancelled` (committed windows stay; a transcript the job itself created and that is still empty is removed instead of leaving an empty row); failed → `partial` with the error code when something was committed, `failed` otherwise. A queued job that is cancelled leaves the transcript as it was.
- **Default language** (FR-005): the audiobook's own language tag when mapped, else the app language, else auto-detect. The tag is read from the audiobook's own file with `music-metadata` (`common.language`, the first track of a multi-track book), once per book (T039); an unreadable or unmapped tag falls back to the app language, then to auto-detect.
- **The own-build FFmpeg is still not integrated (T001 / T001a / T001b are blocked on the owner).** Until it is, `start` answers `DECODE_FAILED` ("the audio decoder is not available on this system") instead of starting a job that cannot work. Everything else is verified with a fake decoder; real-audio end-to-end is unverified.
- `search` and `export` are part of phase 5 (T029): their channels exist but no handler is registered and `TranscriptionApi.search` / `export` are optional until then.
