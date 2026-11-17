---
id: deploy-server
title: Run Boussole 24/7 on Your Server
description: Install Boussole on your own Linux server with Docker and Tailscale, with automatic updates once GitHub's checks pass.
sidebar_position: 5
---

## What it is

`deploy/server/` runs Boussole permanently on a Linux server you own (for example a VPS), reachable only from your own devices through [Tailscale](https://tailscale.com):

| File | Role |
| --- | --- |
| `compose.yml` | The Boussole container: port `3005` on the server's loopback only, data in `/opt/boussole/data`, at most 4 GB of memory and 3 CPUs |
| `install.sh` | One-time setup: folders, first build, update timer, private HTTPS address |
| `deploy.sh` | Pull-based continuous deployment: deploys the newest commit once GitHub's checks pass, rolls back if it isn't healthy |
| `boussole-deploy.timer` | Runs `deploy.sh` every 5 minutes |
| `set-claude-token.sh` | Connects your Claude subscription to the server (run from your computer) |

## Why it exists

A tunnel from your laptop only works while the laptop is awake. A server keeps Boussole searching, scoring and tracking around the clock, and the pipeline updates it without anyone logging in to the server.

The server only **reads** the public repository; GitHub never gets access to the server.

## How to use it

Requirements on the server: Docker with the Compose plugin, Tailscale signed in to your tailnet, `git`, `curl`, `jq`, `flock`, and `sudo`.

### 1. Install

```bash
git clone https://github.com/dhia-rek/boussole.git /tmp/boussole
/tmp/boussole/deploy/server/install.sh
```

The first build takes several minutes. When it finishes, the script prints your private address, for example `https://my-server.tail1234.ts.net:8443`. Other services on the server keep running untouched.

### 2. Optional: bring your existing data

From the computer where Boussole ran before, copy a consistent snapshot of the database plus the PDFs, then restart:

```bash
sqlite3 orchestrator/data/jobs.db ".backup /tmp/jobs.db"
scp /tmp/jobs.db user@my-server:/opt/boussole/data/jobs.db
scp -r orchestrator/data/pdfs orchestrator/data/jwt-secret user@my-server:/opt/boussole/data/
ssh user@my-server 'docker restart boussole'
```

Put the API keys you use (Adzuna, Brave Search…) in `/opt/boussole/.env` on the server (`chmod 600`).

### 3. Connect Claude

On your computer:

```bash
claude setup-token          # sign in, then copy the token it prints
deploy/server/set-claude-token.sh user@my-server
```

The token is typed hidden and stored only in the server's `.env`. Running Claude on your own server with your own subscription is for your personal use only.

### How updates work

1. A change is merged into `main` on GitHub.
2. GitHub runs its checks (lint, types, tests, docs build).
3. Within 5 minutes the server sees the new commit. Once **every** check has passed, it builds the new image and restarts Boussole.
4. If the new version doesn't answer its health check within 3 minutes, the previous version comes back automatically.

Your data lives in `/opt/boussole/data`, outside the code, so updates never change it. Turn on automatic backups in **Settings → Backups**.

Useful commands on the server:

```bash
journalctl -u boussole-deploy -n 50        # what the pipeline did
/opt/boussole/repo/deploy/server/deploy.sh --force   # rebuild the current version now
docker logs boussole --tail 100             # application logs
```

Defaults and constraints:

- `BOUSSOLE_HOME` (default `/opt/boussole`), `BOUSSOLE_PORT` (default `3005`) and `BOUSSOLE_HTTPS_PORT` (default `8443`) can be changed when running `install.sh`.
- The container is never published on the server's public IP address; only Tailscale Serve exposes it, to your tailnet.
- A commit whose checks failed, or that couldn't start, is skipped until a newer commit arrives.

## Common problems

### The log says "waiting for GitHub checks"

GitHub hasn't finished testing the newest commit yet. The next run (within 5 minutes) deploys it once the checks pass.

### The log says "not deploying … GitHub checks failed"

A check failed on that commit, so the running version stays. Fix the problem on GitHub; the next green commit deploys automatically.

### "did not become healthy; rolling back"

The new version didn't start. The previous version is running again; see `docker logs boussole` for the reason.

### AI features fail on the server

The Claude token is missing or expired. Run `claude setup-token` and `set-claude-token.sh` again.

### The address doesn't open

Turn Tailscale on on the device you're using, signed in to the same tailnet as the server.

## Related pages

- [Open Boussole from Anywhere](/docs/getting-started/share-online)
- [Self-hosting](/docs/getting-started/self-hosting)
- [Database backups](/docs/getting-started/database-backups)
- [AI Agents](/docs/features/ai-agents)
