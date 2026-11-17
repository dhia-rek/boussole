---
id: share-online
title: Open Boussole from Anywhere
description: Reach your own Boussole from a phone or another computer through a Cloudflare tunnel, with the security steps to take first.
sidebar_position: 4
---

## What it is

`orchestrator/scripts/share.sh` runs Boussole on your computer and publishes it on the internet through a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/). You get an `https://` address you can open on your phone. Your computer stays the server: scraping, PDFs and the Claude CLI keep working as on your desk.

## Why it exists

Boussole needs browsers (for scraping), LaTeX (for PDFs) and your Claude login, which small free hosts cannot run. A tunnel needs no server, no open router port and no cost.

## How to use it

### 1. Use a strong password

Anyone who learns the address reaches your sign-in page. `share.sh` refuses to start while an account uses an easy password (for example `admin` / `admin`).

```bash
cd orchestrator
npx tsx scripts/set-password.ts admin
```

The command asks twice, hides what you type, needs at least 12 characters, rejects common passwords and your username, and signs out every other session.

### 2. Start the tunnel

Stop `npm run dev` first (two servers must not share one database), then:

```bash
cd orchestrator
./scripts/share.sh
```

The script checks passwords, updates the database, builds the web app, starts Boussole in production mode on port `3005` (`FORSA_SHARE_PORT` to change it) and opens the tunnel. Open the `https://….trycloudflare.com` address it prints. Press `Ctrl+C` to stop everything.

### 3. Optional: a stable address with your domain

Quick tunnels have [documented limits](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/): the address changes every time, there is no uptime guarantee, at most 200 requests can be in flight, and Server-Sent Events are not supported (the jobs page's live progress and Ghostwriter streaming won't update live; the top pipeline bar still refreshes by polling).

For a stable address such as `forsa.yourdomain.com` with live updates:

1. Create a free Cloudflare account and add your domain to it.
2. Run `cloudflared tunnel login`, then `cloudflared tunnel create forsa`, then `cloudflared tunnel route dns forsa forsa.yourdomain.com`.
3. Start with `FORSA_TUNNEL_NAME=forsa ./scripts/share.sh`.
4. Recommended: in Cloudflare Zero Trust, add an **Access** application for that hostname with an email one-time-code policy, so only you get past Cloudflare to the sign-in page.

### Security built into Boussole

- **Sign-in throttling**: after 10 failed attempts for a username, or 30 from one address, within 15 minutes, sign-in answers `429 TOO_MANY_REQUESTS` with `Retry-After` until the window passes. Behind a local tunnel the visitor's address comes from Cloudflare's `CF-Connecting-IP`. Restarting the server clears the counters.
- **Browser headers** on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that allows the camera and microphone only for Boussole (mock interviews), and `Strict-Transport-Security` when served over HTTPS.
- **No cross-site API access**: other websites cannot call the API from a browser. Set `FORSA_CORS_ORIGINS` (comma-separated origins) only if you build a separate front end.
- **Secrets stay local**: `.env` and `orchestrator/data/` are never committed; settings store the legacy basic-auth password only as a scrypt hash.

## Common problems

### "These accounts use an easy password"

Run the `set-password.ts` command the script prints, then start again.

### "Boussole's dev server (npm run dev) is running"

Stop `npm run dev` (Ctrl+C in its terminal) and run `share.sh` again.

### The phone shows the page but progress doesn't move live

That is the quick-tunnel limit on Server-Sent Events. Reload to refresh, or use a named tunnel (step 3).

### The address stopped working

Quick-tunnel addresses last only while `share.sh` runs and change on every start. Your computer must stay awake and online.

## Related pages

- [Self-hosting](/docs/getting-started/self-hosting)
- [Database backups](/docs/getting-started/database-backups)
- [Today, navigation and live status](/docs/features/today)
