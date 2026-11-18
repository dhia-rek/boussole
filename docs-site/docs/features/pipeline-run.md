---
id: pipeline-run
title: Pipeline Run
description: How to use Run Mode (Automatic vs Manual), presets, source controls, and advanced run settings.
sidebar_position: 2
---

## What it is

Pipeline Run is the Jobs-page run modal for starting either:

- an **Automatic** pipeline run
- a **Manual** one-job import

For end-to-end sequence, read [Find Jobs and Apply Workflow](/docs/workflows/find-jobs-and-apply-workflow).
For manual import internals, read [Manual Import Extractor](/docs/extractors/manual).

## Why it exists

The modal provides one place to control run volume, source compatibility, and processing aggressiveness before consuming compute/time.

It helps you:

- choose speed vs depth with presets
- avoid invalid source/country combinations
- understand estimated run cost before starting
- refresh your job list when older discovered jobs have gone stale

## How to use it

1. Open the Jobs page and use the top-right run control.
2. Choose either **Automatic** or **Manual** tab.
3. Configure required inputs and start run.

### Automatic tab

#### Presets

Three presets set defaults for run aggressiveness:

- **Fast**: lower processing volume, higher score threshold
- **Balanced**: middle-ground defaults
- **Detailed**: higher processing volume, lower score threshold

If values are edited manually, the UI shows **Custom**.

The automatic modal remembers the last preset choice and `Max jobs discovered`
value in this browser. If you picked **Custom**, it reopens in Custom mode with
the same values. The pipeline run itself still derives per-source caps from the
saved budget when you start the run.

#### Country and source compatibility

- Country selection affects which sources are available.
- UK-only sources are disabled for non-UK countries.
- Adzuna is available only for its supported countries and when App ID/App Key are configured in Settings.
- Glassdoor can be enabled only when:
  - selected country supports Glassdoor
  - at least one **Search city** is set in Advanced settings

Incompatible sources are disabled with explanatory tooltips.

#### Advanced settings

- **Resumes tailored** (`topN`)
- **Min suitability score**
- **Max jobs discovered** (run budget cap)
- `Max jobs discovered` accepts values from `50` to `1000` in the UI.
- **Search cities** (optional multi-city input; empty by default; required for Glassdoor)
- **Workplace type** (`Remote`, `Hybrid`, `Onsite`)

Workplace type applies globally to the run across all search terms and locations.

Search cities only applies when you explicitly add one or more cities. Leaving it empty does not inject a hidden UK fallback or fake city value.

Source behavior differs:

- Hiring Cafe and startup.jobs support all three workplace types directly.
- Indeed, LinkedIn, and Glassdoor are backed by JobSpy and only support strict remote filtering.
- If workplace type is set to `Remote` only, JobSpy runs with a remote-only filter.
- If `Hybrid` or `Onsite` is included, JobSpy sources remain enabled but may return broader results.

#### Search terms

- Add terms with Enter or commas.
- Multiple terms increase discovery breadth and runtime.
- At least one search term is required.

#### Estimate and run gating

The footer estimate shows expected discovered jobs and resume-processing range.

`Start run now` is disabled when:

- a run is already in progress
- required save/run work is still in progress
- no compatible sources are selected
- no search terms are present

### Manual tab

Manual mode opens direct import flow in the same modal.

You can also click **Add a job** in the **Jobs** header at any time, including while a search is running. Importing a link that is already in your list changes nothing: Boussole says "This job is already in your list" and opens it, so an application you already sent keeps its status.

Use it when you already have a specific job description or link and do not want full discovery.

For accepted input formats, inference behavior, and limits, see [Manual Import Extractor](/docs/extractors/manual).

## Common problems

### Start button stays disabled

- Ensure at least one search term is present.
- Ensure at least one compatible source is selected.
- Wait for active save/run operations to finish.

### Glassdoor cannot be enabled

- Verify selected country supports Glassdoor.
- Set at least one Search city in Advanced settings.

### Adzuna is not selectable

- Set `Adzuna App ID` and `Adzuna App Key` in **Settings > Environment & Workspaces**.
- Verify the selected country is one of Adzuna's supported markets.

### Run takes longer than expected

- Reduce term count.
- Use `Fast` preset or lower `Max jobs discovered`.
- Disable high-cost source combinations where acceptable.

### A site asks to prove you're human

Some job sites (for example Hiring Cafe) sometimes put an anti-bot check in front of their results. The search pauses and the progress card shows the site with two choices:

- **Solve**: a browser window opens; pass the check and the search continues with that site.
- **Skip and continue without …**: the search continues right away without that site.

If you do neither, the search continues by itself after 10 minutes (`BOUSSOLE_CHALLENGE_TIMEOUT_MS`, in milliseconds) without that site.

### A score shows "≈" and "estimate"

The AI account could not score the job when the pipeline found it (not signed in, usage limit, timeout). Boussole then keeps a **keyword estimate**: a rough number from generic keywords, not a judgement of your fit. Estimates are shown with a dashed outline and "≈", for example `≈75`.

To get real scores:

- **One job:** open it and click **Recalculate match** on the Overview.
- **Many jobs:** in **Jobs**, tick the jobs (or **Select all filtered**), then **Recalculate match** (up to 100 jobs at a time).

Recalculating never falls back to an estimate. If your AI account still can't answer, the job keeps its current score and you see the reason, for example "Your AI account could not score this job: Not logged in". Fix the account under **Settings → AI account** and recalculate.

### Older jobs look expired or stale

- Run the pipeline again before reviewing or applying.
- Existing discovered jobs are not automatically refreshed in the background.
- A new run fetches current listings so you can work from fresher results.

### JobSpy results are broader than the selected workplace type

- Indeed, LinkedIn, and Glassdoor only support strict remote filtering in this flow.
- Use `Remote` only when you need JobSpy sources filtered tightly.
- Hybrid or onsite selections are honored by Hiring Cafe and startup.jobs, but JobSpy-backed sources may still include broader results.

## Related pages

- [Find Jobs and Apply Workflow](/docs/workflows/find-jobs-and-apply-workflow)
- [Manual Import Extractor](/docs/extractors/manual)
- [Orchestrator](/docs/features/orchestrator)
- [Overview](/docs/features/overview)
