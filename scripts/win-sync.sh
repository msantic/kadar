#!/bin/bash
# Copies this Mac's working copy of Kadar (every file git tracks or would track, saved or not)
# to C:\dev\kadar on the Windows build machine, so a Windows build can check work that is not
# committed yet. Files there that are not in this copy stay; `git status` there shows the state.
#
# Same route as scripts/win.sh. The tar is made without macOS side files (COPYFILE_DISABLE) and
# unpacked with today's time on every file (-m), so the Windows build sees every change
# (both traps are in the office server's runbook).

set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${KADAR_WIN_HOST:-marko@10.10.10.4}"
GUEST="${KADAR_WIN_GUEST:-build@192.168.122.12}"

git ls-files -co --exclude-standard -z \
  | COPYFILE_DISABLE=1 tar -c --null -T - -f - \
  | ssh -o BatchMode=yes "$HOST" "ssh -o BatchMode=yes $GUEST 'cmd /c tar -xmf - -C C:\\dev\\kadar'"
echo "Synced to C:\\dev\\kadar"
