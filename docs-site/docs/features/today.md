---
id: today
title: Today, Navigation and Live Status
description: The Today home page, the grouped sidebar and the live pipeline bar that show what Boussole is doing and what to do next.
sidebar_position: 0
---

## What it is

Three parts of the app layout help you see what is going on at a glance:

- **Today** (`/today`) is the home page. It shows the one thing to do next, then up to three more, with the last pipeline run and your search folded away.
- The **sidebar** lists every page, grouped by step of the job search, with live counts.
- The **pipeline bar** at the top of every page shows the pipeline's live state.

## Why it exists

Earlier versions hid navigation behind a menu button and showed nothing about the pipeline outside the Jobs page. You had to open several pages to know whether a run had finished, which sources failed, or how many jobs were waiting.

Showing all of that at once was the next problem: counts, runs and lists on one screen didn't say what to do. Today now picks the next step for you.

## How to use it

### Today

Open Boussole. `/` redirects to **Today** (the jobs list stays at `/jobs/ready`).

- **Your next step**: the most useful thing to do now, with one button.
- **After that**: up to three more steps.
- **Search details** (folded; click to open):
  - **Pipeline**: status of the last run (completed, failed or cancelled), when it ran, how long it took, jobs found and tailored, the sources it used, and which sources had problems. **Run pipeline** opens the run dialog on the Jobs page.
  - **Your search**: your search terms and location. **Edit** opens Settings.

The steps, most important first (at most four are shown):

| Step | When it shows | Buttons |
| --- | --- | --- |
| Add your CV | No CV yet | **Add my CV** |
| Prepare your *stage* with *company* | An application is at an interview stage (recruiter screen, assessment, hiring manager screen, technical interview, onsite) | **Practice now** opens the [mock interview](/docs/features/mock-interview) for that job |
| Follow up with *company* | You applied 7 to 30 days ago, nothing was logged for 7 days, and no follow-up is logged yet | **Write the follow-up** (Ghostwriter writes it), **I've sent it** (logs "Followed up" on the job's timeline and removes the step) |
| Finish your application to *company* | You worked on a [guided application](/docs/features/guided-apply) in the last 14 days | **Continue** opens it at the first step still to do |
| Your job search is running | A search is running | **Watch it** |
| Find new jobs | No search yet, or the last one is 7 or more days old | **Search now** opens the run dialog |
| Recalculate *N* match scores | Open jobs only have a keyword estimate | **Recalculate now** scores them (up to 100) with your AI account; it takes a few minutes |
| Choose your next application | Good matches: score 60 or more from a real AI score, found in the last 45 days, not started | **Review them** opens [Choose your next application](/docs/features/guided-apply) |
| You're all caught up | Nothing else to do | **See applications** |

### Sidebar

On screens 1024 px and wider, the sidebar is always visible:

| Group | Pages |
| --- | --- |
| *(top)* | Today |
| Find | Jobs (badge: ready jobs), Spontaneous |
| Apply | Applications (badge: applications in progress), Inbox |
| Profile | CV |
| Insights | Analytics, Tracer links, [AI activity](/docs/features/ai-activity) |
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

### Today doesn't suggest a job I like

Only jobs found in the last 45 days with a real AI score of 60 or more are suggested; older postings are mostly closed. Open the job from **Jobs** and click **Apply step by step**, or run a new search.

### A follow-up reminder doesn't go away

Click **I've sent it**. Logging any other event on the job's timeline also pauses the reminder for 7 days.

### The counts or the bar look out of date

They refresh automatically (every minute for counts, every 30 seconds for the bar while idle). Reload the page to refresh immediately.

### I can't find the Overview page

It is now called **Analytics** (Insights group). The URL `/overview` still works.

### "Run pipeline" does nothing on the Jobs page

The run dialog does not open while a run is already active. Use **Cancel run** first, or wait for the run to finish.

## Related pages

- [Guided Applications](/docs/features/guided-apply)
- [Analytics (Overview)](/docs/features/overview)
- [Jobs (Orchestrator)](/docs/features/orchestrator)
- [Pipeline Run](/docs/features/pipeline-run)
- [Settings](/docs/features/settings)
