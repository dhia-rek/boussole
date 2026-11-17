---
id: company-career-pages
title: Company Career Pages Extractor
description: Pull jobs straight from employers' own career boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor).
sidebar_position: 13
---

## What it is

This extractor (source id `companyats`, shown as **Company Career Pages**) reads the public job feeds that employers publish through their applicant tracking system (ATS). It covers a curated list of about 60 AI and data employers that hire in France, such as Mistral AI, Hugging Face, H Company, Dust, Pennylane, Devoteam, Artefact and Ubisoft.

Supported platforms and the public endpoint used for each:

| Platform | Endpoint | Requests per company |
| --- | --- | --- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` | 1 |
| Lever | `api.lever.co/v0/postings/<slug>?mode=json` | 1 |
| Ashby | `api.ashbyhq.com/posting-api/job-board/<slug>` | 1 |
| Workable | `apply.workable.com/api/v1/widget/accounts/<slug>?details=true` | 1 (descriptions included) |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/<id>/postings?country=<cc>` | 1 per 100 postings, plus 1 per kept role for its description (at most 30 per run) |
| Teamtailor | `<slug>.teamtailor.com/jobs.rss`, or `<custom domain>/jobs.rss` | 1 |

Implementation split:

1. `extractors/companyats/src/companies.ts` lists the companies: name, platform, board slug, and an optional Teamtailor custom domain.
2. `extractors/companyats/src/run.ts` holds one fetcher per platform, the role filter and the per-company cap.
3. `extractors/companyats/manifest.ts` maps pipeline settings and progress, and registers the `companyats` source.

## Why it exists

Many French AI startups and consulting firms post roles on their own careers page first, sometimes only there. Reading those boards directly catches roles that aggregators miss or index late, with structured data and the original apply link.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **Company Career Pages** in **Sources**.
3. The run controls it uses:
   - `searchTerms` decide which roles are kept (see below).
   - The selected country is sent to SmartRecruiters as a country filter. On the other platforms, on-site roles outside France, Europe or remote are dropped, and the pipeline's location filter does the rest.
   - `jobspyResultsWanted` caps the roles kept **per company** per run: best match first, then newest. Empty means no cap.
4. Start the run and follow the progress card: one line per company, with a note when a board is unavailable.

How roles are kept on each board:

- A role is kept when its **title contains every word of one search term**, in any order. Accents and simple plurals are ignored, and `AI` / `IA` / `intelligence artificielle` and `ML` / `machine learning` count as the same word. For example, `Data Quality` keeps "Senior Data Quality Analyst" and `Consultant IA` keeps "Junior AI Consultant".
- It is also kept, ranked lower, when its title reads as an AI / ML / data role ("Machine Learning Engineer") or shares at least two words with your search terms ("Junior Data & Automation Engineer" for `Data Quality` and `AI Automation`).
- Sales, account management, recruiting, finance, legal and customer-success titles are dropped unless the title contains a whole search term. Descriptions are not used for this, because AI-native companies mention AI in every posting.
- Internship and alternance titles are skipped unless one of your search terms asks for one (`Stage Data`, `Machine Learning Intern`). When **every** term is internship-type, only internship-type titles are kept.
- Without any search term, every AI / ML / data role (title or description) is kept.

Search terms that work well:

```text
Data Quality
Data Steward
AI Engineer
Ingénieur IA
Consultant IA
AI Automation
```

Defaults and constraints:

- No credentials are required.
- Boards are read four at a time with a short pause between batches; each request times out after 20 s.
- A board that fails (for example HTTP 404 after a company changes ATS) is skipped and reported in progress. The run fails only when every board fails.
- After 2 consecutive timeouts or server errors on one platform, its remaining boards are skipped for that run, so one unresponsive host costs at most a couple of timeouts.
- To add a company, append `{ name, ats, slug }` to `companies.ts`, plus `host` for a Teamtailor board on a custom domain.

## Common problems

### "board unavailable (HTTP 404)" for a company

The company moved to another ATS or renamed its board. Open its careers page, check which platform serves it, and update the entry in `companies.ts`.

### A company returns nothing

Its open roles don't match your search terms, are internships while your terms target permanent roles, or are outside France, Europe or remote. A SmartRecruiters company also returns nothing when no posting matches the selected country.

### "skipped: lever is not responding"

That platform timed out or returned server errors twice in a row, so its other boards were skipped for this run. It usually clears up on its own (outage or temporary rate limiting); the next run tries again.

### "All N company job boards failed to load"

Every request failed, usually because there is no network access or a proxy blocks the ATS hosts.

## Related pages

- [Extractors overview](/docs/extractors/overview)
- [Welcome to the Jungle](/docs/extractors/welcome-to-the-jungle)
- [Pipeline run](/docs/features/pipeline-run)
- [Add an Extractor](/docs/workflows/add-an-extractor)
