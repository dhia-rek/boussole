---
id: faq
title: FAQ
description: Frequently asked questions about deployment, docs, and operations.
sidebar_position: 1
---

## Is docs content bundled for self-hosted installs?

Yes. The docs static build is bundled and served locally at `/docs`.

## How are docs versions managed?

Docs are versioned using Docusaurus versions, intended to map to release tags.

## How is the app version managed?

The app version comes from `orchestrator/package.json`.

Releases create a matching `vX.Y.Z` Git tag, and the UI shows that release version in the sidebar footer.

## Where should contributors edit docs?

Edit files under `docs-site/docs` for latest docs.

## What does this cost in practice?

Boussole runs every AI step on your own AI account, Claude or ChatGPT, so it uses your subscription instead of per-call API billing. There is no extra cost per job.

What matters instead is your subscription's usage limits:

- scoring is one Claude call per new job, and responses are cached, so re-runs over unchanged jobs cost nothing
- tailoring a CV and writing a cover letter take a few calls per job
- the agent team (analyst, CV tailor, letter writer, critic) takes several calls per job, so keep it for the jobs you will really apply to
- a lighter model (`sonnet`, `haiku`) or a lower effort (`opus:low`) in **Settings → AI account** stretches the limits further
