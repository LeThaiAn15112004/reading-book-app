#!/usr/bin/env bash
# Builds Readmate's own decode-only LGPL FFmpeg for win32-x64 (spec 004, task T001a) from a source tarball.
# Run inside an MSYS2 **UCRT64** shell with gcc (mingw-w64-ucrt-x86_64-gcc), make and nasm installed.
#
#   scripts/ffmpeg/build-ffmpeg-windows.sh <ffmpeg-X.Y.Z.tar.xz> <work-dir> [release|fixture-tool]
#
# release       the binary the app ships: resources/ffmpeg/win32-x64/ffmpeg.exe (copy it with stage-ffmpeg.mjs).
# fixture-tool  a SEPARATE test-only binary with encoders, used to make decode fixtures. Never shipped.
#
# Nothing is downloaded. The work dir gets: source.sha256, the extracted source, configure.log, make.log, install/.
set -euo pipefail

TARBALL=${1:?tarball}
WORK=${2:?work dir}
FLAVOUR=${3:-release}

# Decode-only allow-list. Each entry is needed by an audiobook format the app imports (electron/adapters/audio.adapter.ts):
#   mp3 → mp3 demuxer + mp3/mp3float + mpegaudio parser; m4a/m4b → mov demuxer + aac (+ alac for Apple Lossless .m4a);
#   aac (ADTS) → aac demuxer + aac parser; wav → wav demuxer + PCM decoders (u8, s16/24/32, f32/f64 little-endian);
#   flac → flac demuxer/parser/decoder; ogg/opus → ogg demuxer + vorbis/opus decoders and parsers.
# Output: aresample (16 kHz mono) → pcm_f32le encoder → pcm_f32le muxer (`-f f32le`). Note: the MUXER component is
# called `pcm_f32le`; `--enable-muxer=f32le` silently matches nothing and the binary cannot write `-f f32le`.
COMMON=(
  --disable-autodetect --disable-debug --disable-doc --disable-ffplay --disable-ffprobe
  --disable-indevs --disable-outdevs --disable-network --disable-everything
  --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avutil --enable-swresample
  # `file` reads the book; `pipe` is the output (`pipe:1` = stdout). Without `pipe` every decode fails "Protocol not found".
  --enable-protocol=file,pipe
  # Link libgcc / winpthreads statically: the default build needs libwinpthread-1.dll, which only exists inside MSYS2.
  --extra-ldflags=-static
)
case "$FLAVOUR" in
  release)
    FLAGS=(
      --enable-demuxer=mp3,mov,wav,flac,ogg,aac
      --enable-decoder=mp3,mp3float,aac,alac,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,vorbis,opus
      --enable-parser=aac,flac,mpegaudio,opus,vorbis
      --enable-filter=aresample
      --enable-encoder=pcm_f32le
      --enable-muxer=pcm_f32le
    )
    ;;
  fixture-tool)
    FLAGS=(
      --enable-demuxer=mp3,mov,wav
      --enable-decoder=mp3,mp3float,aac,pcm_s16le
      --enable-parser=mpegaudio,aac
      --enable-filter=aresample,atrim
      --enable-encoder=flac,vorbis,opus,aac,pcm_u8,pcm_s16le,pcm_s24le,pcm_f32le
      --enable-muxer=flac,ogg,opus,adts,wav,ipod
    )
    ;;
  *) echo "unknown flavour: $FLAVOUR" >&2; exit 2 ;;
esac

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
sha256sum "$TARBALL" | tee "$WORK/source.sha256"
# `sed -n 1p` reads the whole listing (`head` would close the pipe early and fail the script under pipefail).
TOP=$(tar -tf "$TARBALL" | sed -n 1p | cut -d/ -f1)
rm -rf "${WORK:?}/$TOP"
tar -xf "$TARBALL" -C "$WORK"
cd "$WORK/$TOP"

./configure --prefix="$WORK/install" "${COMMON[@]}" "${FLAGS[@]}" 2>&1 | tee "$WORK/configure.log"
make -j"$(nproc)" 2>&1 | tee "$WORK/make.log" > /dev/null
make install > /dev/null

echo
echo "built: $WORK/install/bin/ffmpeg.exe"
sha256sum "$WORK/install/bin/ffmpeg.exe"
