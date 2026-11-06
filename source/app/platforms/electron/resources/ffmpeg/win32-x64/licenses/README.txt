FFmpeg 9.0.2 — decoder used by Readmate Reader for on-device audiobook transcription

This folder contains an unmodified build of FFmpeg (https://ffmpeg.org), licensed under the GNU Lesser General
Public License version 2.1 or later (licenses/COPYING.LGPLv2.1). FFmpeg is a trademark of Fabrice Bellard.
Readmate runs it as a separate program; it is not linked into Readmate.

Source code: the exact FFmpeg 9.0.2 release tarball this binary was built from is available from
https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz and from the Readmate Reader release page.
No changes were made to the FFmpeg sources.

Configuration: --prefix=/c/Users/ADMIN/Downloads/ffmpeg-9.0.2-readmate/release/install --disable-autodetect --disable-debug --disable-doc --disable-ffplay --disable-ffprobe --disable-indevs --disable-outdevs --disable-network --disable-everything --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avutil --enable-swresample --enable-protocol='file,pipe' --extra-ldflags=-static --enable-demuxer='mp3,mov,wav,flac,ogg,aac' --enable-decoder='mp3,mp3float,aac,alac,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,vorbis,opus' --enable-parser='aac,flac,mpegaudio,opus,vorbis' --enable-filter=aresample --enable-encoder=pcm_f32le --enable-muxer=pcm_f32le

ffmpeg.exe SHA-256: be96e0c4e044fab7b0a5c20b3c7286d88f33a2fcb09b92d5f8a3fedff5f6829c

Statically linked runtime components and their notices:
  licenses/mingw-w64-winpthreads-COPYING.txt
  licenses/mingw-w64-runtime-COPYING.txt
  licenses/gcc-runtime-library-exception.txt
