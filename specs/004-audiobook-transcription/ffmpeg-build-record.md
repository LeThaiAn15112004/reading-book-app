# FFmpeg build record (evidence for prerequisite B3)

**Status (2026-10-28): win32-x64 BUILT, STAGED AND TESTED. darwin-arm64 / darwin-x64 NOT BUILT. LGPL distribution
obligations and legal sign-off (section 4, task T001b) are NOT DONE — LGPL compliance is NOT claimed.**

Fill each section only from real runs. Map and procedure: `docs/implementation_plan/ffmpeg_packaging.md`.

## 1. Build inputs and outputs

### win32-x64

- FFmpeg source: release **9.0.2**, tarball `ffmpeg-9.0.2.tar.xz`, SHA-256
  `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e` (computed locally on the owner's copy; the
  tarball's GPG signature was NOT checked — that needs FFmpeg's public key, i.e. a download). Archived: NOT YET (owner).
  No changes to the sources.
- Script: `source/apps/reading-book-desktop/scripts/ffmpeg/build-ffmpeg-windows.sh <tarball> <work> release`, run in the
  owner's MSYS2 UCRT64 shell (a build launched from the agent session was too slow: process creation is throttled there).
  `make` was interrupted once by a transient `CreateProcess` failure of `cc1.exe`; it was resumed in the same tree after
  deleting the static archives (`lib*/lib*.a`) so they were re-archived with every object.
- Exact configure line (from `config.h`):
  `--prefix=…/release/install --disable-autodetect --disable-debug --disable-doc --disable-ffplay --disable-ffprobe --disable-indevs --disable-outdevs --disable-network --disable-everything --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avutil --enable-swresample --enable-protocol='file,pipe' --extra-ldflags=-static --enable-demuxer='mp3,mov,wav,flac,ogg,aac' --enable-decoder='mp3,mp3float,aac,alac,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,vorbis,opus' --enable-parser='aac,flac,mpegaudio,opus,vorbis' --enable-filter=aresample --enable-encoder=pcm_f32le --enable-muxer=pcm_f32le`
- Toolchain: MSYS2 UCRT64, gcc 16.2.0 (Rev6, MSYS2), binutils 2.47, NASM 3.02, mingw-w64 crt / winpthreads
  14.0.0.r569.g34eeafb7d.
- Produced file: `ffmpeg.exe` 5,215,744 bytes, SHA-256
  `be96e0c4e044fab7b0a5c20b3c7286d88f33a2fcb09b92d5f8a3fedff5f6829c` → `resources/ffmpeg/win32-x64/ffmpeg.exe` and
  `electron/transcription/ffmpeg-artifacts.json`.
- Rejected earlier builds (kept on disk, not shipped): the owner's first build (`--enable-muxer=f32le` = no f32le muxer;
  imports `libwinpthread-1.dll`) and a first `release` build without the `pipe` protocol (`pipe:1` → "Protocol not found").

### darwin-arm64, darwin-x64

NOT BUILT (needs a Mac). Nothing is shipped for macOS.

## 2. Licence evidence (win32-x64)

- `ffmpeg -L`: "GNU Lesser General Public License … version 2.1 of the License, or (at your option) any later version".
  configure summary: `License: LGPL version 2.1 or later`.
- `-buildconf`: no `--enable-gpl`, `--enable-nonfree`, `--enable-version3` (checked by `stage-ffmpeg.mjs` and the spike).
- Linked libraries (PE import table, read by `scripts/ffmpeg/pe-imports.mjs`, same result as `objdump -p`): `KERNEL32`,
  `bcrypt`, `SHELL32`, `api-ms-win-crt-*` (UCRT, in-box on Windows 10+) only. Statically linked: FFmpeg libavcodec /
  libavformat / libavutil / libswresample / libavfilter / libswscale (LGPL), MinGW-w64 winpthreads (MIT + BSD-3, notice
  required), MinGW-w64 runtime startup code (notice required), libgcc (GCC Runtime Library Exception, no notice
  required — the text is shipped anyway). No other third-party library.
- Shipped beside the binary in `licenses/`: `COPYING.LGPLv2.1`, `LICENSE.md` (FFmpeg), `README.txt` (version, configure
  line, SHA-256, source location), `mingw-w64-winpthreads-COPYING.txt`, `mingw-w64-runtime-COPYING.txt`,
  `gcc-runtime-library-exception.txt`.
- Allow-list and why: see `scripts/ffmpeg/build-ffmpeg-windows.sh` (one line per format the importer accepts; `pipe` and
  the `pcm_f32le` encoder + muxer for the output). ALAC is decodable although the importer only accepts AAC in M4A.

## 3. Decode results (T001a) — `npm run spike:transcription:ffmpeg`, 2026-10-28, 28 passed / 0 failed / 0 skipped

Exact app argv (`buildFfmpegArgs`), real `createAudioDecoder`. Synthetic files: a band-limited speech-like signal, 20 s,
44.1 kHz stereo; reference computed analytically at 16 kHz (no FFmpeg in the reference path). Non-WAV fixtures encoded by
a SEPARATE test-only FFmpeg (`fixture-tool` flavour). Pass: 10 s window and a 3.5 s window starting at 7.25 s have the
expected sample count ±50 ms, correlation ≥ 0.999 (lossless) / ≥ 0.95 (lossy), middle window ≤ 100 ms off; a window
past the end is empty.

| Format | Windows x64 | Correlation whole / middle | Offset | macOS arm64 | macOS x64 |
|---|---|---|---|---|---|
| MP3 | PASS (2 real LibriVox / 1915 recordings, 30 s at start and middle, 480,000 samples, not silent) | n/a (no LGPL MP3 encoder for a fixture) | — | NOT RUN | NOT RUN |
| M4A (AAC-LC) | PASS | 0.9983 / 0.9968 | −23 / −18 ms | NOT RUN | NOT RUN |
| M4B (AAC-LC) | PASS + real LibriVox M4B (3.5 h, window at 12,755 s) | 0.9983 / 0.9967 | −23 / −18 ms | NOT RUN | NOT RUN |
| AAC (ADTS) | PASS | 0.9984 / 0.9965 | +23 ms | NOT RUN | NOT RUN |
| FLAC | PASS | 1.0000 / 1.0000 | 0 | NOT RUN | NOT RUN |
| Ogg Vorbis | PASS | 0.9999 / 0.9999 | 0 | NOT RUN | NOT RUN |
| Opus (.opus and Ogg Opus .ogg) | PASS | 0.9997 / 0.9995 | 0 | NOT RUN | NOT RUN |
| WAV PCM u8 / s16 / s24 / s32, IEEE float f32 / f64 | PASS | ≥ 0.9999 | 0 | NOT RUN | NOT RUN |

Also run for real: damaged file and text-as-WAV → `DECODE_FAILED` with FFmpeg's message; missing file → `FILE_MISSING`;
abort → `ABORTED`; a path with spaces, Vietnamese letters and a leading dash; no binary → `NOT_BUNDLED`; changed binary →
`INTEGRITY_FAILED`; the old DLL-dependent build with PATH = System32 → `NOT_RUNNABLE` "a required DLL was not found
(exit 0xc0000135)"; a copy of the shipped binary in an empty folder with PATH = System32 runs.

## 4. Distribution obligations (T001b)

- Source archive published next to the binaries, matching them exactly: NOT DONE (README.txt promises the release page)
- Configure line shipped as a text file: DONE (`licenses/README.txt`); diff of local changes: none
- Licence texts and FFmpeg/LGPL notice shipped in the installer: DONE for the files in `resources/ffmpeg/win32-x64/licenses`
- In-app notices (About box, licence/EULA screen, download page note, no reverse-engineering ban): NOT DONE
- Dynamic vs static decision: static FFmpeg libraries inside the separate `ffmpeg.exe` program (Readmate only spawns it, it
  is not linked into Readmate); static runtime so no MSYS2 DLL has to ship. Owner review: NOT DONE
- Patent exposure review (AAC/M4B) — separate from licence terms: NOT DONE
- Legal / owner sign-off: NOT DONE

## 5. Packaging (T001)

- `npx electron-builder --dir --win --x64` (2026-10-28): `ffmpeg.exe` + `licenses/` at `resources/ffmpeg/win32-x64/`
  outside `app.asar` (no ffmpeg entry inside the asar); `afterPack` printed "FFmpeg win32-x64: 1 file(s) verified".
  Inside the packaged `Readmate Reader.exe` (`ELECTRON_RUN_AS_NODE`, PATH = System32): `availability()` → available
  from `process.resourcesPath`, a 30 s MP3 window → 480,000 samples.
- Code signing: electron-builder runs signtool over `ffmpeg.exe` too. No certificate is configured, so the file was
  unchanged; WITH a certificate the signature changes the bytes and the app would refuse it (`INTEGRITY_FAILED`) —
  sign `ffmpeg.exe` before staging (and record that hash) or exclude it from electron-builder's signing. NOT RESOLVED.
- NSIS installer build, a clean Windows VM / Sandbox (not available on Windows 11 Home here), SmartScreen / antivirus
  behaviour (360 Total Security is installed here): NOT VERIFIED. macOS signing / notarization: n/a until a Mac build.
