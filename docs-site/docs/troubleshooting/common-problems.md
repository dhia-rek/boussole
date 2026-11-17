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

- Check that Claude is signed in on the host: run `claude` once in a terminal, then retry.
- On a server or in Docker, refresh the token with `claude setup-token` and update `CLAUDE_CODE_OAUTH_TOKEN`.
- Check **Settings → AI model**: an unknown model alias fails every call. Clear the field to use the default (`opus:medium`).

## Older jobs look expired or stale

- Run the pipeline again before reviewing or applying.
- Existing discovered jobs are not automatically refreshed in the background.
- A new run fetches current listings so you can work from fresher results.

## PDF generation fails

- Make sure the CV editor holds a CV (open **CV**). Without one, Boussole cannot build a PDF.
- Check that `tectonic` is installed (the Docker image includes it) or that `TECTONIC_BIN` points to it.
- The first render downloads LaTeX packages and needs internet access once.
