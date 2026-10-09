#!/bin/bash
# Makes Kadar's Windows installer on the Windows build machine and copies it to this Mac.
# It builds the copy in C:\dev\kadar as it is: run scripts/win-sync.sh first for work that is
# not pushed. The installer is not signed (owner's decision, 2026-10-09): Windows shows
# "unknown publisher" at the first install; More info → Run anyway installs it.
#
# Result: src-tauri/target/release/bundle/windows/Kadar_<version>_x64-setup.exe
# Steps, the machine and the remote screen: docs/windows.md.

set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${KADAR_WIN_HOST:-marko@10.10.10.4}"
GUEST="${KADAR_WIN_GUEST:-build@192.168.122.12}"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
NAME="Kadar_${VERSION}_x64-setup.exe"
OUT="src-tauri/target/release/bundle/windows"

echo "==> Building the installer on Windows (a few minutes)"
scripts/win.sh <<'PS'
$ErrorActionPreference = "Continue"
cd C:\dev\kadar
cmd /c "npm ci --no-audit --no-fund 2>&1" | Select-Object -Last 1
cmd /c "npx tauri build --bundles nsis 2>&1" | Select-Object -Last 3
PS

echo "==> Copying it to this Mac"
mkdir -p "$OUT"
ssh -o BatchMode=yes "$HOST" "ssh -o BatchMode=yes $GUEST 'cmd /c type C:\\dev\\kadar\\src-tauri\\target\\release\\bundle\\nsis\\$NAME'" > "$OUT/$NAME.part"
mv "$OUT/$NAME.part" "$OUT/$NAME"
echo "Ready: $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
