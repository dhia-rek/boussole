---
id: common-problems
title: Common Problems
description: Quick fixes for the most frequent setup and runtime issues.
sidebar_position: 1
---

## Docs site not loading at `/docs`

- Confirm docs build exists:

```bash
npm --workspace docs-site run build
```

- In production, ensure container includes docs build artifact.

## Deep links under `/docs/*` return 404

- Confirm Express is serving docs static mount before app SPA fallback.
- Confirm docs base URL is `/docs/` in `docs-site/docusaurus.config.ts`.

## Gmail OAuth callback fails

- Verify `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`.
- Ensure authorized redirect URI exactly matches deployment callback URL.

## No job scoring or AI inference

- Open **Settings → AI account**: the account Boussole uses must show as signed in. Sign in again if it expired.
- The owner's workspace may use the server's Claude login: run `claude` once on the host, or on a server refresh it with `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN`.
- If one model keeps failing, pick another one (or the default) in **Settings → AI account**.

## Older jobs look expired or stale

- Run the pipeline again before reviewing or applying.
- Existing discovered jobs are not automatically refreshed in the background.
- A new run fetches current listings so you can work from fresher results.

## PDF generation fails

- Make sure the CV editor holds a CV (open **CV**). Without one, Boussole cannot build a PDF.
- Check that `tectonic` is installed (the Docker image includes it) or that `TECTONIC_BIN` points to it.
- The first render downloads LaTeX packages and needs internet access once.
