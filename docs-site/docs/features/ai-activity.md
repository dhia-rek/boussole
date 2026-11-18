---
id: ai-activity
title: AI Activity
description: Follow every request Boussole sends to your AI account, with what was sent, what came back, how long it took and what failed.
sidebar_position: 14
---

## What it is

**AI activity** (sidebar → Insights → **AI activity**) lists every request Boussole sends to your AI account (Claude or ChatGPT), newest first:

- what it was for: **Match score**, **Job summary**, **Tailor the CV**, **CV check**, **Company research (web search)**, **Check company research**, **Ghostwriter answer**, **Interview question**, **Interview feedback**, **Sort a job email**, **Read a job link**, **Import a CV**, **Spontaneous email**, **Deep Agents step**…
- which job, the AI (Claude or ChatGPT) and model, how long it took, and whether it worked;
- **What Boussole sent** and **What the AI answered** (JSON answers indented), or **What went wrong** for a failed request.

## Why it exists

The AI does a lot in the background (scoring every job of a search, tailoring CVs, sorting emails). This page shows what it was asked and what it answered, so you can check its work, see when your AI account hits a limit, and understand a surprising score or letter.

## How to use it

1. Open **AI activity**. Requests appear as soon as they start (a spinner while the AI works); the page refreshes every few seconds while one is running.
2. Click a line to read what was sent and answered. **Open the job** opens the job it was about.
3. Tick **Only failed** to see just the requests that failed and why.

Defaults and constraints:

- Stored only in this Boussole's database, per account, the last 300 requests. Older ones are deleted automatically.
- Very long texts show their beginning and end, with the number of characters left out in between.
- Requests answered from Boussole's short-term cache don't reach the AI and aren't listed.
- A request still running when Boussole restarts is shown as failed: "Interrupted: Boussole restarted."

## Common problems

### Many requests failed with a limit or sign-in message

Your AI account hit its usage limit or signed out. Check **Settings → AI account**, wait for the limit to reset, then redo the action (for example **Recalculate now** on **Today** for match scores).

### A request I expected isn't listed

It was answered from the cache (same question asked again recently), or it's older than the last 300 requests.

## Related pages

- [AI Account](/docs/features/ai-account)
- [Today](/docs/features/today)
- [AI Agents](/docs/features/ai-agents)
