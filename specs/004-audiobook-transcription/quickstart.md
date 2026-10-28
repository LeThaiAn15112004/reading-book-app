# Quickstart: validating Audiobook Transcription

Prerequisites: `npm install` in `source/`; a short (1–3 min) clearly spoken MP3 (single file) and a multi-track audiobook; the `whisper-tiny` model (downloaded through the dialog, or pre-seeded in `{userData}/transcription-models/`).

## Automated checks (no E2E)

```text
cd source/apps/book-reader-sdk && npm run verify            # window plan, range merge, active passage, export
cd source/apps/reading-book-desktop
npm run typecheck && npm run lint
npm run spike:transcription:main    # decoder windows, worker, SQLite migration 029, IPC, cancel, resume, cascade delete
npm run spike:transcription:store   # renderer store: progress, partial passages, seek, search
npx vite build                      # worker entry bundles
```

## Gate before decoding real audio (T001a/T001b/T001)

The own-build LGPL FFmpeg must exist, have decoded every format on Windows and macOS (T001a), and have its licence evidence recorded (T001b) before any manual scenario that decodes real audio is run. Until then only fake-decoder spikes run.

## Gate before building on the worker (T014a)

Run the worker smoke spike (`npm run spike:transcription:smoke`, defined in T014a) first. If it fails, stop and report; do not continue with T015+.

## Manual scenarios

1. **Single file, whole book (US1, FR-002)**: open the MP3 → Transcribe → whole book → wait. Expect progress, then a transcript matching the speech; Library and player stay usable meanwhile.
2. **Partial reading (FR-001b)**: on a longer file, open the transcript mid-job; finished text is visible, marked partial.
3. **Range (FR-001a)**: transcribe minute 1–2 only; later transcribe 0–3; the first minute is not recomputed (check progress totals).
4. **Multi-track**: transcribe one track, then the whole book; passages group by track; clicking a passage of another track opens that track at the right second.
5. **Follow & seek (US2)**: play; highlight tracks speech within 2 s; click a passage → playback jumps.
6. **Search/export (US3)**: search a spoken word → jump; export → plain text file matches transcript.
7. **Cancel (SC-006)**: cancel mid-job → stops < 5 s, status `cancelled`, finished windows kept.
8. **Errors**: no model → asks consent with size; music-only file → `NO_SPEECH`; move the file mid-job → `FILE_MISSING`, nothing marked complete.
9. **Privacy/offline (SC-005)**: disable network after model install; transcribe and reopen app; transcript still there.
10. **Interrupted job**: start a long transcription, kill the app process, relaunch: the transcript shows interrupted with "Resume", finished text is intact; Resume continues without recomputing covered parts; relaunching again changes nothing.
11. **Integrity**: corrupt a downloaded model file (or its manifest hash): `INTEGRITY_FAILED`, nothing installed, model not loaded.
12. **Timing accuracy (SC-004)**: follow T036's procedure on the reference set and record the median and p95 offsets.
13. **Regression (SC-007/FR-016)**: books without a transcript play, seek, take Notes exactly as before.
