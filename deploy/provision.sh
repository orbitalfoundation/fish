#!/usr/bin/env bash
# One-time provisioning for the Fish VM on exe.dev. Idempotent — safe to re-run;
# it just (re)starts Caddy. Creating the VM and making it PUBLIC are separate
# steps (see DEPLOYMENT.md): the scoped API token can't `share`, and the
# control-plane gateway SSH can hang, so do those out-of-band.
# Usage: deploy/provision.sh [vm-name]      (default: fishes)
set -euo pipefail

VM="${1:-${VM:-fishes}}"
HOST="$VM.exe.xyz"
DEST="exedev@$HOST"                 # login user on exe.dev VMs is always 'exedev'
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"               # VMs default to proxy_port 8000

# Self-contained SSH opts: tolerate the VM host key changing on reprovision, and
# fail fast (~15s) instead of hanging forever.
SSH="ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ServerAliveInterval=5 -o ServerAliveCountMax=3"

echo "› ensuring /srv on $HOST"
$SSH "$DEST" 'sudo mkdir -p /srv/site && sudo chown -R "$(id -un)":"$(id -gn)" /srv'

echo "› uploading Caddyfile"
rsync -e "$SSH" "$HERE/Caddyfile" "$DEST:/srv/Caddyfile"

echo "› enabling docker at boot + (re)starting Caddy on :$PORT"
$SSH "$DEST" "sudo systemctl enable --now docker >/dev/null 2>&1; \
  docker rm -f fish 2>/dev/null || true; \
  docker run -d --name fish --restart unless-stopped \
    -p $PORT:80 \
    -v /srv/site:/srv/site:ro \
    -v /srv/Caddyfile:/etc/caddy/Caddyfile:ro \
    caddy:2"

cat <<EOF
✓ provisioned ($HOST). The VM is PRIVATE until you make it public.
  From your own Terminal (keepalives turn a hang into a ~15s failure):
    ssh exe.dev share port $VM $PORT
    ssh exe.dev share set-public $VM
  …or via the exe.dev dashboard. Then run deploy/deploy.sh $VM.
EOF
