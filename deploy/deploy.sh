#!/usr/bin/env bash
# Build Fish and push it to its exe.dev VM. Run for every update.
# Bundles the app into dist/ and rsyncs it to /srv/site; Caddy serves it
# immediately (no restart).
# Usage: deploy/deploy.sh [vm-name]         (default: marine)
set -euo pipefail

VM="${1:-${VM:-marine}}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3"

echo "› building dist/"
( cd "$ROOT" && npm run build )

echo "› syncing dist/ → $HOST:/srv/site"
rsync -avh --delete -e "$SSH" "$ROOT/dist/" "$DEST:/srv/site/"

echo "✓ deployed → https://$HOST"
