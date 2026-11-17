---
id: overview
title: Extractors Overview
description: Technical index of supported extractors and how they work.
sidebar_position: 1
---

This page helps you choose the right extractor for your run, understand key constraints, and navigate to detailed technical guides.

Extractor integrations are now registered through manifests and loaded automatically at orchestrator startup. Runtime discovery only scans `extractors/*/(manifest.ts|src/manifest.ts)` and does not read manifests from `orchestrator/**`. Extractor-specific run logic should also remain in `extractors/<name>/` so orchestrator stays source-agnostic. To add a new source, follow [Add an Extractor](/docs/workflows/add-an-extractor).

## Extractor chooser

| Extractor | Best use case | Core constraints/dependencies | Notable controls | Output/behavior notes |
| --- | --- | --- | --- | --- |
| [Gradcracker](/docs/extractors/gradcracker) | UK graduate roles from Gradcracker | Crawling stability depends on page structure and anti-bot behavior; tuned for low concurrency | `GRADCRACKER_SEARCH_TERMS`, `GRADCRACKER_MAX_JOBS_PER_TERM`, `FORSA_SKIP_APPLY_FOR_EXISTING` | Scrapes listing metadata, then detail pages and apply URL resolution |
| [JobSpy](/docs/extractors/jobspy) | Multi-source discovery (Indeed, LinkedIn, Glassdoor) | Requires Python wrapper execution per term; source availability and quality vary by site/location | `JOBSPY_SITES`, `JOBSPY_SEARCH_TERMS`, `JOBSPY_RESULTS_WANTED`, `JOBSPY_HOURS_OLD`, `JOBSPY_LINKEDIN_FETCH_DESCRIPTION` | Produces JSON per term, emits structured location evidence, then orchestrator normalizes and de-duplicates by `jobUrl` |
| [Adzuna](/docs/extractors/adzuna) | API-based multi-country discovery with low scraping overhead | Requires valid App ID/App Key; country must be in Adzuna-supported list | `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `ADZUNA_MAX_JOBS_PER_TERM` | API pagination to dataset output, emits structured location evidence, and orchestrator maps progress and de-duplicates by `sourceJobId`/`jobUrl` |
| [Hiring Cafe](/docs/extractors/hiring-cafe) | Browser-backed discovery using Hiring Cafe search APIs | Subject to upstream anti-bot checks; uses browser context and encoded search-state payloads | `HIRING_CAFE_SEARCH_TERMS`, `HIRING_CAFE_COUNTRY`, `HIRING_CAFE_MAX_JOBS_PER_TERM`, `HIRING_CAFE_DATE_FETCHED_PAST_N_DAYS` | Uses existing pipeline term/country/budget knobs, emits structured location evidence, and maps directly to normalized jobs |
| [startup.jobs](/docs/extractors/startup-jobs) | Startup-focused discovery through the published `startup-jobs-scraper` package | No credentials required; detail enrichment depends on Playwright browser binaries being installed | existing pipeline `searchTerms`, selected country/cities, `jobspyResultsWanted`; `npx playwright install` for fresh environments | Algolia-backed search plus detail-page enrichment via package import; orchestrator maps normalized records and de-duplicates by `jobUrl` |
| [Welcome to the Jungle](/docs/extractors/welcome-to-the-jungle) | France-centred startup, scale-up and tech roles (CDI, CDD, internships) | No credentials; relies on WTTJ's published job sitemaps and public job endpoint staying available | existing pipeline `searchTerms` (matched against titles), selected country, `jobspyResultsWanted` | Reads the job sitemaps once per run, matches titles locally, fetches only matching offers (bounded and spaced), labels contracts (CDI/CDD/stage) and skips internships unless a term asks for them |
| [Company Career Pages](/docs/extractors/company-career-pages) | AI / data employers hiring in France, read from their own career boards | No credentials; depends on each company's public ATS feed (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor); boards that move are reported and skipped | existing pipeline `searchTerms` (matched against titles), selected country, `jobspyResultsWanted` (per company) | One feed request per company (plus SmartRecruiters paging and bounded detail calls); keeps title matches first, skips internships unless asked, reports unavailable boards |
| [Working Nomads](/docs/extractors/working-nomads) | Remote-only discovery through the public Working Nomads jobs API | Public API is curated and remote-only; available fields are limited to API payload shape | existing pipeline `searchTerms`, selected country/cities, `jobspyResultsWanted`, workplace type | Fetches a single public JSON feed, filters locally by terms/location, emits structured location evidence, infers job type when possible, and de-duplicates by source id / URL |
| [Golang Jobs](/docs/extractors/golang-jobs) | Go-specific discovery through the public Golang Jobs feed | Depends on the site's public Supabase-backed schema staying stable; no credentials required | existing pipeline `searchTerms`, selected country/cities, `jobspyResultsWanted`, workplace type | Paginates the public jobs feed, maps location through the linked city record, then filters locally and de-duplicates by source id / URL |
| [Jobindex](/docs/extractors/jobindex) | Denmark job search through Jobindex result pages | Denmark-only; city filtering depends on resolving selected cities to Jobindex `geoareaid` values | existing pipeline `searchTerms`, selected country/cities, `JOBINDEX_MAX_JOBS_PER_TERM` / automatic run budget | Parses the embedded Stash payload, applies resolved `geoareaid` filters when available, paginates result pages, maps card metadata and direct apply links, and de-duplicates by source id / URL |
| [Seek](/docs/extractors/seek) | Australia/NZ job search via Apify | Requires Apify API token; actor runs incur cost ($1.50/1,000 results; free tier ~3,000/month) | `APIFY_TOKEN`, `SEEK_MAX_JOBS_PER_TERM`, `SEEK_APIFY_ACTOR_ID` | Calls the `unfenced-group/seek-com-au-scraper` Apify actor per term, maps results, and de-duplicates by source id / URL |
| [UKVisaJobs](/docs/extractors/ukvisajobs) | UK visa sponsorship-focused roles | Requires authenticated session and periodic token/cookie refresh | `UKVISAJOBS_EMAIL`, `UKVISAJOBS_PASSWORD`, `UKVISAJOBS_MAX_JOBS`, `UKVISAJOBS_SEARCH_KEYWORD` | API pagination + dataset output; orchestrator de-dupes and may fetch missing descriptions |
| [Manual Import](/docs/extractors/manual) | One-off jobs not covered by scrapers | Inference quality depends on model/provider and input quality; some URLs cannot be fetched reliably | App/API endpoints (`/api/manual-jobs/infer`, `/api/manual-jobs/import`) | Accepts text/HTML/URL, runs inference, then saves and scores job after review |

## Which extractor should I use?

- Use **JobSpy** for broad first-pass sourcing across common boards.
- Use **Adzuna** when you want API-first discovery in supported non-UK markets.
- Use **Hiring Cafe** when you want another term/country-driven source without adding credentials.
- Use **startup.jobs** when you want startup-heavy listings without maintaining another scraper locally.
- Use **Welcome to the Jungle** for France-focused startup and tech roles, including CDI offers.
- Use **Company Career Pages** to follow specific AI / data employers (Mistral AI, Hugging Face, Dust, Devoteam, …) on their own career boards.
- Use **Working Nomads** when you want another remote-only source with a public API and curated global roles.
- Use **Golang Jobs** when you want a niche Go-focused board that broad aggregators often miss.
- Use **Jobindex** when targeting Denmark roles from the local Jobindex board.
- Use **Seek** when targeting Australia/NZ roles via the Apify-powered Seek scraper.
- Use **Gradcracker** when targeting graduate pipelines in the UK.
- Use **UKVisaJobs** for sponsorship-specific UK searches.
- Use **Manual Import** when you already have a specific posting and need direct import.

Many runs combine sources: broad discovery first, then manual import for high-priority jobs that scraping misses.

## Common problems

### How do I health-check an extractor?

- Every runtime-registered extractor source exposes `GET /api/:source/health`.
- Use the source id from the shared extractor catalog, for example `/api/linkedin/health` or `/api/gradcracker/health`.
- The health check runs a minimal live probe for that source with a fixed search term and a result limit of `1`.
- A `200` response means the extractor returned at least one valid normalized job for that source.
- A `503` response means the extractor could not run successfully, returned no jobs, or returned invalid jobs.
- A `404` response means the source id is unknown or not registered at runtime on that instance.

## Related extractor docs

- [Gradcracker](/docs/extractors/gradcracker)
- [JobSpy](/docs/extractors/jobspy)
- [Adzuna](/docs/extractors/adzuna)
- [Hiring Cafe](/docs/extractors/hiring-cafe)
- [startup.jobs](/docs/extractors/startup-jobs)
- [Welcome to the Jungle](/docs/extractors/welcome-to-the-jungle)
- [Company Career Pages](/docs/extractors/company-career-pages)
- [Working Nomads](/docs/extractors/working-nomads)
- [Golang Jobs](/docs/extractors/golang-jobs)
- [Jobindex](/docs/extractors/jobindex)
- [Seek](/docs/extractors/seek)
- [UKVisaJobs](/docs/extractors/ukvisajobs)
- [Manual Import](/docs/extractors/manual)
- [Add an Extractor](/docs/workflows/add-an-extractor)
