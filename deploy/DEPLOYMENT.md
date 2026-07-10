# Fish — deployment reference

Audience: humans **and** Claude instances. The exhaustive exe.dev model, quirks,
and recovery runbook live in a sibling project's doc —
**`/Volumes/summer/projects/2026/intotheblue/deploy/DEPLOYMENT.md`**. Read that
for the deep dive. This file records the **Fish-specific** facts.

Fish is a **purely static site** (a bundled `dist/`: `index.html` + `app.js`).
That means it will run on any static host — Cloudflare Pages / Netlify / GitHub
Pages would give free global CDN, redundancy, and atomic deploys. We use exe.dev
here because it's the house standard and one-command to share; treat the VM as
replaceable (source of truth is the git repo; `npm run build` regenerates `dist/`).

## What's deployed

- **VM:** `marine` (exe.dev, region `lax`), login user `exedev`.
- **Serving:** a `caddy:2` Docker container named `fish`, `-p 8000:80`,
  bind-mounting `/srv/site` (the build) and `/srv/Caddyfile` read-only.
- **URL:** https://marine.exe.xyz (public after the `share set-public` step).

## The path

Control-plane over the **HTTPS API** (gateway SSH can hang; the API doesn't).
Token in `deploy/.api-token` (git-ignored).

```sh
TOKEN=$(tr -d '[:space:]' < deploy/.api-token)
API() { curl -sS -X POST https://exe.dev/exec -H "Authorization: Bearer $TOKEN" -d "$1"; }

API 'whoami'              # confirm the key is registered
API 'new --name marine'     # create the VM (returns https_url + proxy_port 8000)

deploy/provision.sh marine  # /srv, Caddyfile, enable docker, run Caddy :8000
deploy/deploy.sh   marine   # npm run build + rsync dist/ → /srv/site
```

VM SSH (`ssh exedev@marine.exe.xyz`) works from anywhere; that's what the scripts use.

## The one manual step: make it public

`share` is not in the scoped token and the gateway SSH can hang, so flip the VM
public from your own Terminal (keepalives turn a hang into a ~15s failure):

```sh
ssh -o ServerAliveInterval=5 -o ServerAliveCountMax=3 exe.dev share port marine 8000
ssh -o ServerAliveInterval=5 -o ServerAliveCountMax=3 exe.dev share set-public marine
```

…or use the dashboard (`ssh exe.dev browser` → open the VM → make the HTTP proxy
public). A private VM answers the public URL with a `307 → /__exe.dev/login`;
once public it serves the site.

## Continuous deployment (push = deploy)

`deploy/setup-autodeploy.sh marine` installs an on-VM systemd timer that polls
GitHub `main` every ~2 min and rebuilds + redeploys on change. Once installed,
pushing to `main` is the deploy; `deploy/deploy.sh` remains a manual override.
Watch it: `ssh exedev@marine.exe.xyz journalctl -u fish-autodeploy -f`.

## Verify

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://marine.exe.xyz/                       # 200 when public
ssh exedev@marine.exe.xyz 'curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/'    # always 200 if Caddy is up
```

## Quick recovery

- **Down after reboot:** `ssh exedev@marine.exe.xyz 'sudo systemctl enable --now docker; docker start fish'` (the container is named `fish`)
- **`Host key verification failed`:** VM was reprovisioned — `ssh-keygen -R marine.exe.xyz` (scripts already pass `accept-new`).
- **Deploy/gateway SSH hangs:** use the HTTPS API for control-plane, VM SSH for the box.
- **VM gone:** `API 'new --name marine'` → `provision.sh` → `deploy.sh` → re-run the public step. Everything is in this repo.
