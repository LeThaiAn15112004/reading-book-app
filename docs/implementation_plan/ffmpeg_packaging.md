# FFmpeg for audiobook transcription: build, packaging, verification

Part of spec 004 (`specs/004-audiobook-transcription/`, tasks T001a / T001 / T001b). Evidence lives in
`specs/004-audiobook-transcription/ffmpeg-build-record.md`; this file is the map of how the decoder gets into a release.
Transcription itself stays behind `features.audiobookTranscriptionEnabled` (off): this work does not turn it on.

## What the app needs from FFmpeg

`electron/transcription/audio-decoder.ts` spawns `{resources}/ffmpeg/<platform>-<arch>/ffmpeg[.exe]` with an argv array
(no shell) per 30 s window:

```
-nostdin -hide_banner -loglevel error -protocol_whitelist file -ss <s> -t <s> -i <file>
-vn -sn -dn -map 0:a:0 -ac 1 -ar 16000 -f f32le pipe:1
```

So the binary needs: the `file` protocol (input) and the `pipe` protocol (`pipe:1` output); demuxers + decoders for every format `electron/adapters/audio.adapter.ts`
imports (MP3, M4A/M4B AAC, ADTS AAC, WAV PCM / IEEE float, FLAC, Ogg Vorbis/Opus, Opus); `aresample`; the
`pcm_f32le` encoder **and the `pcm_f32le` muxer** (that is the muxer's component name — `--enable-muxer=f32le` matches
nothing and leaves `-f f32le` "not known").

## Audit (2026-10-28) — what was missing

| Finding | Effect | Fix |
|---|---|---|
| The first MSYS2 build used `--enable-muxer=f32le` (`CONFIG_PCM_F32LE_MUXER 0`) | every decode failed: `Requested output format 'f32le' is not known` | `--enable-muxer=pcm_f32le` |
| (found by the real-binary spike) the first rebuild enabled only `--enable-protocol=file` | every decode failed: `Error opening output pipe:1: Protocol not found` | `--enable-protocol=file,pipe`; `stage-ffmpeg.mjs` refuses a binary without it |
| It imported `libwinpthread-1.dll` | exit 127 / `0xC0000135` outside the MSYS2 shell — on every user's PC | `--extra-ldflags=-static` (one self-contained `ffmpeg.exe`) |
| `FFMPEG_ARTIFACTS` empty, no `resources/ffmpeg/`, no `extraResources` | decoder always `NOT_BUNDLED` | staged artifact + manifest + electron-builder config |
| A missing file was reported as `INTEGRITY_FAILED`; a binary that cannot load was only discovered at the first decode (after a model download) | misleading / late errors | `NOT_BUNDLED` for a missing file, new `NOT_RUNNABLE` from a self-test before `available` |
| Dev path from `app.getAppPath()` | `dist-electron/resources` when Electron is started on `dist-electron/main.js` (E2E) | resolved from the Main bundle's folder |
| An abort between the first check and the spawn was lost | the process ran to the end | re-check right before the spawn |

Linux and macOS: no binary exists. The Windows binary is **not** usable there and is not renamed or copied for them.

## Design

- **Build** — `scripts/ffmpeg/build-ffmpeg-windows.sh <tarball> <work> release` (MSYS2 UCRT64): decode-only allow-list,
  `--disable-everything --disable-autodetect --disable-network`, no `--enable-gpl/--enable-nonfree/--enable-version3`
  (LGPL v2.1+), static. The same script's `fixture-tool` flavour builds a SEPARATE test-only binary with encoders; it is
  never shipped.
- **Stage** — `node scripts/ffmpeg/stage-ffmpeg.mjs <key> <binary> <configured source dir> [licence files]` refuses a
  GPL/nonfree/version3 configure line, a missing `pcm_f32le` muxer, a Windows binary importing non-system DLLs
  (`scripts/ffmpeg/pe-imports.mjs` reads the PE import table), then copies the binary + `licenses/` (FFmpeg's
  `COPYING.LGPLv2.1`, `LICENSE.md`, a README with version, configure line, SHA-256 and source location, and the notices
  of statically linked runtime pieces) into `resources/ffmpeg/<key>/`, and writes its SHA-256 into
  `electron/transcription/ffmpeg-artifacts.json`.
- **Trust anchor** — `ffmpeg-artifacts.json` is imported by `ffmpeg-artifacts.ts`, so the hashes are bundled into
  `dist-electron/main.js` (inside the asar), never read from next to the binary.
- **Package** — `electron-builder.json5` `win.extraResources` copies `resources/ffmpeg/win32-x64` to
  `{resources}/ffmpeg/win32-x64` as real files (an asar member cannot be executed). `afterPack`
  (`scripts/ffmpeg/verify-packaged-ffmpeg.mjs`) fails the build when a target that has a manifest entry is packaged
  without exactly that binary, without the LGPL text, with a non-system DLL import, or (same OS/arch) when the packaged
  binary fails its self-test. `READMATE_ALLOW_MISSING_FFMPEG=1` downgrades that to a warning. A target without an entry
  (macOS, Linux) is packaged without FFmpeg and the app reports `NOT_BUNDLED` / `UNSUPPORTED_PLATFORM`.
- **Runtime** — `process.resourcesPath` packaged; `<desktop>/resources` in dev / E2E. `availability()` = hash every file,
  then run `ffmpeg -h muxer=f32le` once; cached. Reasons: `UNSUPPORTED_PLATFORM`, `NOT_BUNDLED` (no entry or file
  missing), `INTEGRITY_FAILED` (hash), `NOT_RUNNABLE` (cannot start: missing DLL `0xC0000135`, blocked by security
  software, no f32le). The service checks availability before `start` and before any model download (no Whisper model
  is downloaded for a decoder that cannot run); `TranscribeDialog` shows `decoderUnavailableText(reason)`.

## Platforms

| Target | Status |
|---|---|
| win32-x64 | built, staged, tested: 28/28 real decode checks, packaged `--dir` build verified (see the build record) |
| darwin-arm64, darwin-x64 | **not built** — needs a Mac: same configure flags without `-static` (macOS has no static libSystem), check `otool -L` shows only `/usr/lib` + system frameworks, code-sign + notarize the Mach-O (hardened runtime), stage with `stage-ffmpeg.mjs darwin-<arch>`, add `mac.extraResources` `resources/ffmpeg/darwin-${arch}` → `ffmpeg/darwin-${arch}` |
| linux-x64 | not supported (`UNSUPPORTED_PLATFORM`); would need its own build + an `FFMPEG_ARTIFACT_KEYS` entry |
| win32-arm64 | not supported (`UNSUPPORTED_PLATFORM`) |

Docker: not used. Readmate is an Electron desktop app; transcription runs on the user's machine and there is no
backend or container that decodes audio, so no image is built.

## Checks

- `npm run spike:transcription:ffmpeg` — the real staged binary (see its header for the env vars that enable the
  non-WAV fixtures, real MP3/M4B files and the real missing-DLL case; anything not enabled prints SKIPPED).
- `npm run spike:transcription:main` — decoder logic with a fake process (self-test cases included).
- Packaging: `npx vite build` then `npx electron-builder --dir --win --x64` (the `afterPack` line reports the check).

## Still open (owner / release)

- LGPL distribution obligations (T001b): host the exact `ffmpeg-9.0.2.tar.xz` next to the installers (the README in
  `licenses/` promises the release page), mention FFmpeg/LGPL in About / licence screen, no reverse-engineering ban in
  the EULA; the AAC/M4B patent question; owner/legal sign-off.
- Whether `resources/ffmpeg/win32-x64/ffmpeg.exe` (≈ 4 MB) is committed (or Git LFS / CI artifact): without it a clean
  clone cannot package Windows (`afterPack` fails by design).
- Windows code signing: electron-builder also runs signtool over `ffmpeg.exe`. Today there is no certificate, so it is
  unchanged; with one, the signed bytes no longer match the manifest and the app refuses the decoder
  (`INTEGRITY_FAILED`). Sign `ffmpeg.exe` before `stage-ffmpeg.mjs` (so the manifest records the signed hash) or exclude
  it from electron-builder signing — decide before the first signed release.
- The NSIS installer itself was not built/installed in this pass (only `--dir`).
- A run on a really clean Windows (VM / Windows Sandbox — not available on Windows 11 Home here).
- macOS builds (above).
