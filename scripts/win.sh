#!/bin/bash
# Runs one PowerShell script on the Windows build machine (`winbuild` on the BIMTLY office server)
# from this Mac, and prints its output. The script travels encoded, so no quoting can break it.
#
#   scripts/win.sh 'cargo --version'
#   scripts/win.sh < some-script.ps1
#
# The route: this Mac → ssh marko@10.10.10.4 (the office server) → ssh build@192.168.122.12 (Windows).
# The machine runs on demand; see the "Build machines" part of "Platforms" in README.md before
# starting or stopping it. Override the route with KADAR_WIN_HOST and KADAR_WIN_GUEST.

set -euo pipefail
HOST="${KADAR_WIN_HOST:-marko@10.10.10.4}"
GUEST="${KADAR_WIN_GUEST:-build@192.168.122.12}"

if [ $# -gt 0 ]; then SCRIPT="$*"; else SCRIPT="$(cat)"; fi
# Every run starts with Rust and Node on the PATH and stops at the first error.
PRELUDE='$ErrorActionPreference = "Stop"; $ProgressPreference = "SilentlyContinue"; $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"; '
ENCODED=$(printf '%s' "$PRELUDE$SCRIPT" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh -o BatchMode=yes "$HOST" "ssh -o BatchMode=yes $GUEST powershell -NoProfile -NonInteractive -EncodedCommand $ENCODED"
