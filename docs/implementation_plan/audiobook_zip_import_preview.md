# Audiobook ZIP import — preview (phase 1)

Scope: choose a `.zip`, inspect it without extracting it into permanent storage, show a preview (tree, ordered
tracks, cover), let the user adjust the selection, then hand a **validated selection** to an import-stage boundary.
Not in scope: player UI, transcoding, nested ZIPs, a general archive manager.

## What the codebase already gives us (inspected)

- Import entry: `ImportMenu` → `useLibraryImport` → `window.api.import.fromFile()` (native dialog in Main,
  `electron/ipc/import.ipc.ts`). Dialog filters come from `SUPPORTED_FORMATS`; ZIP is not a book format, so the ZIP
  flow gets its own menu item + channel instead of widening that registry.
- Audio validation: SDK `audioFormatFromExtension` / `audioPlaybackStatus` (aiff = recognised but unsupported) and the
  container+codec check inside `electron/adapters/audio.adapter.ts` (`music-metadata`). That check is extracted into
  an exported `probeAudioFile` so the preview and the importer use the *same* rule.
- ZIP: `jszip` is a dependency, but it needs the whole archive in memory. Not used. No new dependency: a small
  central-directory reader on `node:fs` + `node:zlib` (`electron/zip-import/zip-reader.ts`).
- Data model: `books` has ONE `file_path` per book (migration 001–027); no chapters table, no multi-file book.
  **Gap:** a multi-track audiobook cannot be persisted yet. This phase stops at the boundary (below) and does not
  invent a schema.
- No virtualisation library; the tree uses a small fixed-row-height windowing in the dialog.
- Tests: vitest exists only in `book-reader-sdk`; desktop checks are `spikes/`. So pure logic (path safety, classification,
  ordering, cover choice, tree, selection state) lives in the SDK with vitest tests; the Main reader/inspector is covered by
  `spike:audio:zip` on synthetic ZIPs generated in the script.

## Architecture

```
renderer (zustand store + dialog)  ──IPC──  Main: zip-import ipc ── sessions ── inspector ── zip-reader
                                                                              └─ probeAudioFile (music-metadata)
SDK (pure): audio/audio-zip-import.ts  — limits, normalizeArchivePath, classifyEntry, naturalCompare, order warnings,
            cover ranking, tree build/flatten, selection reducer, validateZipSelection
```

### IPC (`ZipImportChannels`, preload `api.zipImport`, bridge `src/bridge/zipImport.ts`)

| channel | in | out |
|---|---|---|
| `zipImport:pick` | – (native dialog in Main) | `{ok:true, preview}` \| `{ok:false, errorCode, errorMessage}` (`cancelled` is silent) |
| `zipImport:coverPreview` | `{sessionId, entryId}` | `{ok, dataUrl?}` (validated raster ≤ 2 MB, else no preview) |
| `zipImport:confirm` | `{sessionId, trackIds[], coverId\|null}` | `{ok:true, bookId}` \| `{ok:false, errorCode, errorMessage}` |
| `zipImport:discard` | `{sessionId}` | `{ok}` |

The renderer never sends a path. The archive path is held in Main (from the dialog) in an in-memory session keyed by a
random id; entries are addressed by stable ids (`e<index>` from the validated central directory).

### Preview model
`ZipImportPreview`: `sessionId`, `archiveName`, `entries[]` (`id`, safe relative `path`, `name`, `kind`, `size`,
`eligible`, `status ok|unsupported|ignored`, `reason`, `durationSeconds?`), `trackOrder[]` (ids, natural order),
`coverCandidates[]` (ids, ranked), `defaultCoverId`, `warnings[]`, `stats`.

### Confirmation = import-stage boundary
`confirmZipImport` (Main): session exists → ZIP file still has the recorded size+mtime → central directory re-read and every selected
entry's fingerprint (path, method, sizes, CRC) equals the one in the preview → `validateZipSelection` (≥1 track, all ids
eligible & unique, cover id is a candidate) → build `AudiobookImportRequest { archivePath (Main only), chapters[] in order,
coverEntryId }` → `ZipAudiobookImporter.import(request)`.
The default importer returns `import_not_available` (no multi-track storage yet). Nothing is created or extracted on
cancel/failure. Swapping in the real importer later touches only that function.

## Validation & limits (`ZIP_IMPORT_LIMITS`)
entries 5 000 · path depth 12 · path length 400 chars · total declared size 8 GiB · one audio entry 2 GiB (mp4-family are
probed whole, others by first 4 MiB) · cover image 10 MiB (preview ≤ 2 MB) · central directory 16 MiB.
Rejected archive (nothing shown): corrupt/unreadable/empty, entry count/size/depth, `..`/absolute/drive-letter/UNC/backslash/control
chars, duplicate normalised path (NFC + case-fold). Symlink entries are never extracted (shown as ignored). Encrypted
entries and unsupported compression methods are marked unsupported. Actual bytes are counted while inflating (hard cap =
min(limit, declared size); a mismatch aborts) — declared sizes are not trusted. Probe temp files live in
`{userData}/zip-import-tmp/<random>/`, are named by id (never by archive path) and removed in `finally`.

## UI states
idle (menu item) · inspecting (progress dialog) · preview · no audio · all unsupported · no cover · corrupt / rejected
(error dialog with *Choose another ZIP*) · cancelled · confirming · failure (message, stay on preview to retry).
Reordering is not implemented (no existing DnD pattern); order is natural-sort with an ambiguity warning — future work.

## Tests
SDK vitest: path safety, classification, natural order, order warnings, cover ranking, tree, selection, validate.
Spike: multi-track / mixed / nested / duplicate basenames / `1,2,10` / no audio / only unsupported / corrupt / empty / no cover /
several covers / traversal / absolute / drive-letter / duplicate path / entry-count / declared + actual size / depth / symlink /
cleanup of temp dir / confirm re-validation. No E2E window is launched.
