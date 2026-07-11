#!/usr/bin/env bash
# Runs ON the fishes VM (installed by deploy/setup-autodeploy.sh, fired by a
# systemd timer). Polls GitHub main; when the SHA moves, pulls, rebuilds the
# bundle, and syncs dist/ into /srv/site — Caddy picks the new files up at once.
#
# No secrets: the repo is public, so a plain https ls-remote/fetch works.
# Overlap-safe without a lockfile: the systemd timer re-arms only after the
# previous oneshot run finishes (OnUnitInactiveSec).
set -euo pipefail

REPO_URL="https://github.com/orbitalfoundation/fish.git"
BRANCH="main"
BASE="/srv/autodeploy"
REPO="$BASE/repo"
STATE="$BASE/deployed-sha"
DEST="/srv/site"

remote_sha="$(git ls-remote "$REPO_URL" "refs/heads/$BRANCH" | cut -f1)"
[ -n "$remote_sha" ] || { echo "could not read $BRANCH from $REPO_URL"; exit 1; }
deployed="$(cat "$STATE" 2>/dev/null || echo none)"
[ "$remote_sha" = "$deployed" ] && exit 0   # nothing new — the common case

echo "› main moved: $deployed -> $remote_sha"

if [ ! -d "$REPO/.git" ]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$REPO"
fi
git -C "$REPO" fetch --depth 1 origin "$BRANCH"
git -C "$REPO" reset --hard FETCH_HEAD
git -C "$REPO" clean -fd   # drop stray files but keep ignored (node_modules/, dist/)

cd "$REPO"
echo "› npm ci"
npm ci --no-audit --no-fund
echo "› build"
npm run build
echo "› sync -> $DEST"
rsync -a --delete dist/ "$DEST"/

echo "$remote_sha" > "$STATE"
echo "✓ deployed $remote_sha"
