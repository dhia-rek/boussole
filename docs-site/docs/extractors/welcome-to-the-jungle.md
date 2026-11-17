---
id: welcome-to-the-jungle
title: Welcome to the Jungle Extractor
description: Discover French and European jobs from Welcome to the Jungle through its published job sitemaps.
sidebar_position: 12
---

## What it is

Original website: [welcometothejungle.com](https://www.welcometothejungle.com)

This extractor finds offers on Welcome to the Jungle (WTTJ), a job board centred on France with strong startup, scale-up and tech coverage (CDI, CDD, internships, alternance, freelance).

Implementation split:

1. `extractors/wttj/src/run.ts` reads the job-listings sitemaps, matches search terms against offer titles, then fetches each matching offer from WTTJ's public job endpoint.
2. `extractors/wttj/manifest.ts` adapts pipeline settings, reports progress, and registers the `wttj` source.

## Why it exists

WTTJ lists many Paris and France tech roles that broad aggregators miss or pick up late.

Its former public jobs API (`api/v1/jobs`) now answers `404`, its site search only works from welcometothejungle.com, and its `robots.txt` disallows crawling search pages. The extractor therefore only uses what WTTJ publishes for automated clients: the job sitemaps and the public job pages.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **Welcome to the Jungle** in **Sources**.
3. Set your usual run controls:
   - `searchTerms`: each term is matched against offer titles. Every word must appear, in any order. Accents and simple plurals are ignored, and `AI` / `IA` / `intelligence artificielle` and `ML` / `machine learning` count as the same word.
   - Selected country: on-site offers in other countries are skipped; fully remote offers are kept.
   - `jobspyResultsWanted`: the maximum number of offers kept per term (50 when empty).
4. Start the run and follow the pipeline progress card: first "reading the job index", then one line per term.

Search terms that work well with title matching:

```text
Data Quality
Qualité des données
Data Steward
Ingénieur IA
AI Engineer
IA Générative
```

Defaults and constraints:

- No credentials and no browser are required.
- Internship and alternance offers are skipped unless one of your search terms asks for them (for example `Stage Data` or `Machine Learning Intern`).
- Each run downloads the sitemaps once (about 9 files, ~3.5 MB, ~90,000 offers). It then requests at most 3 offers per job kept per term and 300 offers per run, three at a time with a short pause.
- The newest offers (by sitemap last-modified date) are checked first.
- `jobType` holds the contract: `Full-time permanent (CDI)`, `Fixed-term (CDD)`, `Internship (stage)`, `Apprenticeship (alternance)`, `Freelance`, `Part-time`, `VIE (international volunteer)`.

## Common problems

### A term finds nothing

Matching uses titles only. Use words that appear in job titles (`Data Steward`, `Ingénieur IA`), not tools that usually appear only in descriptions (`n8n`, `dbt`). Add French and English forms as separate terms.

### "sitemap index returned HTTP …" or "lists no job-listings sitemaps"

WTTJ changed or removed its sitemaps. The run reports a source error and the other sources continue. Open `https://www.welcometothejungle.com/sitemaps/index.xml.gz` in a browser to check.

### "job details could not be fetched"

Every offer request failed (network issue, or WTTJ refusing the requests). Partial failures are tolerated: the run keeps the offers that loaded.

## Related pages

- [Extractors overview](/docs/next/extractors/overview)
- [startup.jobs](/docs/next/extractors/startup-jobs)
- [Pipeline run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
