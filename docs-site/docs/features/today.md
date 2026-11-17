---
id: today
title: Today, Navigation and Live Status
description: The Today home page, the grouped sidebar and the live pipeline bar that show what Boussole is doing and what to do next.
sidebar_position: 0
---

## What it is

Three parts of the app layout help you see what is going on at a glance:

- **Today** (`/today`) is the home page. It shows your next actions, the last pipeline run, your best-matching ready jobs and your current search.
- The **sidebar** lists every page, grouped by step of the job search, with live counts.
- The **pipeline bar** at the top of every page shows the pipeline's live state.

## Why it exists

Earlier versions hid navigation behind a menu button and showed nothing about the pipeline outside the Jobs page. You had to open several pages to know whether a run had finished, which sources failed, or how many jobs were waiting.

## How to use it

### Today

Open Boussole. `/` now redirects to **Today** (the jobs list stays at `/jobs/ready`).

- **Next actions**: counts for *Ready to apply*, *New to review*, *In progress* and *Applied*. Click a row to open that list.
- **Pipeline**: status of the last run (completed, failed or cancelled), when it ran, how long it took, jobs found and tailored, the sources it used, and which sources had problems. Runs started before per-source results were recorded show "Per-source results weren't recorded for this run." **Run pipeline** opens the run dialog on the Jobs page.
- **Top matches**: the six ready jobs with the highest match score. Unscored jobs come last.
- **Your search**: your search terms and location. **Edit** opens Settings.

### Sidebar

On screens 1024 px and wider, the sidebar is always visible:

| Group | Pages |
| --- | --- |
| *(top)* | Today |
| Find | Jobs (badge: ready jobs), Spontaneous |
| Apply | Applications (badge: applications in progress), Inbox |
| Profile | CV |
| Insights | Analytics, Tracer links, Visa sponsors |
| *(bottom)* | Settings, Account (switch account, documentation, version, sign out) |

Click **Collapse** at the bottom to shrink the sidebar to icons; hover an icon to see its name. Boussole remembers the choice in this browser.

On phones, a bottom bar shows **Today**, **Jobs**, **Applications** and **CV**. **More** opens every other page plus Settings and Account.

### Pipeline bar

| State | What the bar shows |
| --- | --- |
| Running | The current step (*Searching job boards*, *Saving new jobs*, *Scoring jobs*, *Tailoring CVs*) with details such as `Welcome to the Jungle · term 3/18 · 42 found`, a progress line, **Details** and **Stop** |
| Needs you | *Waiting for you: security check* with the source name, and **Solve**, which opens the Jobs page where you complete the check |
| Idle | `Last run 3 hours ago · 54 found · 12 tailored` (or why the last run failed), the next scheduled run, and **Run pipeline** |

Defaults and constraints:

- The bar checks the pipeline every 30 seconds while idle and every few seconds while a run is active. It does not open an extra live connection.
- On the Jobs page the bar hides its own buttons, because that page already has **Run pipeline** / **Cancel run** and the detailed progress card.
- Sidebar counts refresh every minute and after each run.

## Common problems

### The counts or the bar look out of date

They refresh automatically (every minute for counts, every 30 seconds for the bar while idle). Reload the page to refresh immediately.

### I can't find the Overview page

It is now called **Analytics** (Insights group). The URL `/overview` still works.

### "Run pipeline" does nothing on the Jobs page

The run dialog does not open while a run is already active. Use **Cancel run** first, or wait for the run to finish.

## Related pages

- [Analytics (Overview)](/docs/features/overview)
- [Jobs (Orchestrator)](/docs/features/orchestrator)
- [Pipeline Run](/docs/features/pipeline-run)
- [Settings](/docs/features/settings)
