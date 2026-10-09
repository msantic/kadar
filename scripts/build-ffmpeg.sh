#!/bin/bash
# Builds the small ffmpeg that Kadar ships for video optimizing (Apple Silicon, macOS 15+, as Kadar).
#
# Why not the Mac's own encoder: at the same file size its H.264 output is visibly worse than
# x264 (blocky, soft text). Why not a stock ffmpeg: that is 45 MB. This one has only what the
# optimizer and recorder need: read MOV/MP4/MKV/WebM/AVI, write H.264 + AAC MP4, mix and
# level audio. About 8 MB.
#
# Runs once; later runs exit at once when the binary exists. Pass --force to rebuild.
# Note: x264 is GPL, so this ffmpeg is GPL. Fine for a personal app; check before selling Kadar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/src-tauri/bin/ffmpeg-aarch64-apple-darwin"
FFMPEG_VERSION="7.1.1"
# Bump when the configure flags change, so existing copies are rebuilt.
BUILD_ID="3"

STAMP="$OUT.build-id"
if [ -x "$OUT" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$BUILD_ID" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

WORK="$ROOT/src-tauri/target/ffmpeg-build"
PREFIX="$WORK/prefix"
JOBS="$(sysctl -n hw.ncpu)"
export MACOSX_DEPLOYMENT_TARGET=15.0
mkdir -p "$WORK"
cd "$WORK"

echo "==> Building the small video tool (once, a few minutes)"

if [ ! -f "$PREFIX/lib/libx264.a" ]; then
  rm -rf x264
  git clone --quiet --depth 1 --branch stable https://code.videolan.org/videolan/x264.git
  (
    cd x264
    ./configure --prefix="$PREFIX" --enable-static --enable-pic --disable-cli \
      --disable-opencl --disable-lavf --disable-swscale --disable-ffms --disable-gpac --disable-lsmash
    make -j"$JOBS"
    make install
  ) > x264-build.log 2>&1
fi

if [ ! -d "ffmpeg-$FFMPEG_VERSION" ]; then
  curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" | tar xJ
fi

cd "ffmpeg-$FFMPEG_VERSION"
make distclean > /dev/null 2>&1 || true
PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
  --prefix="$WORK/ffmpeg-out" \
  --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include" \
  --extra-ldflags="-L$PREFIX/lib" \
  --enable-gpl --enable-libx264 \
  --enable-static --disable-shared \
  --disable-autodetect --enable-zlib \
  --disable-doc --disable-ffplay --disable-ffprobe --disable-network --disable-debug \
  --disable-everything \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,avi \
  --enable-muxer=mp4 \
  --enable-decoder=h264,hevc,prores,vp8,vp9,mpeg4,mjpeg,aac,mp3,opus,vorbis,alac,ac3,eac3,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le \
  --enable-parser=h264,hevc,vp8,vp9,mpeg4video,aac,mpegaudio,opus,vorbis,ac3,flac \
  --enable-encoder=libx264,aac \
  --enable-filter=scale,format,aformat,aresample,transpose,hflip,vflip,null,anull,amix,loudnorm \
  --enable-swscale --enable-swresample \
  > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
make -j"$JOBS" > make.log 2>&1 || { tail -30 make.log; exit 1; }

mkdir -p "$(dirname "$OUT")"
cp ffmpeg "$OUT"
strip "$OUT"
echo "$BUILD_ID" > "$STAMP"
echo "==> Done: $OUT ($(du -h "$OUT" | cut -f1))"
