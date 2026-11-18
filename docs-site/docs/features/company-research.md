---
id: company-research
title: Company Research
description: One click researches the company behind a job on the web, checks every quoted source, and gives the brief a "Passed" or "Needs review" verdict.
sidebar_position: 10
---

## What it is

**Company research** is a panel on each job's overview page. One click and your AI account searches the web for:

- what the company does and who its customers are
- its products, market, size and recent news
- how it works, and what this role involves there

You get back a short summary, a list of facts (each with its source and a quote from that page), talking points for your cover letter or interview, and questions to ask.

Every fact is then **checked by Boussole itself**, and the brief is judged before you rely on it.

## Why it exists

A cover letter or interview answer that names the company's real products, numbers or news stands out. Finding that by hand takes time for every application. AI answers can also invent facts that sound right. So this feature does the research for you and refuses to trust it blindly:

1. **Quote check (no AI).** Boussole opens every cited page itself and looks for the quoted words. Each fact gets one of three marks:
   - ✓ **Quote found on the source page**
   - ⚠ **Quote not found on the source page**
   - ? **Source page could not be read** (the site blocks automated reads, needs a login, or isn't a web page)
2. **AI review.** A second AI pass scores the brief for **relevance** (the right company, useful for this job) and **specificity** (concrete names and numbers, not filler) from 1 to 5. It also flags a possible mix-up with another company of the same name.
3. **Verdict.** The brief is **Passed** when all of these hold:
   - at least 3 facts confirmed
   - at least 60% of facts confirmed
   - relevance and specificity of 3 or more
   - no sign of the wrong company

   Otherwise it is **Needs review**, with the reasons listed under "Check before using".

Only facts with a ✓ are passed to [Ghostwriter](/docs/features/ghostwriter) when it writes your cover letter. If the review thinks the facts are about a different company, none are passed.

## How to use it

1. Make sure an AI account is signed in under **Settings → AI account** (see [AI Account](/docs/features/ai-account)).
2. Open a job and stay on its **Overview**.
3. In the **Company research** panel, click **Research company**.
4. Wait about 1 to 4 minutes. You can leave the page, and the run continues on the server.
5. Read the verdict line, for example `Passed · 7 of 7 facts confirmed on their source · relevance 4/5 · specificity 4/5`.
6. Expand a fact's source to see the exact quote, and open the page if you want to read more.
7. Open Ghostwriter and ask for a cover letter. It now knows the confirmed facts.

Click **Research again** at any time. The new brief replaces the old one.

### What is sent where

- **To your AI account:** the job title, company, company website, location, job address and job description (up to 3,500 characters). Nothing from your CV or profile is sent, because the research is about the company.
- **From the server:** ordinary web requests to the cited pages, public addresses only. Private network, local and cloud-metadata addresses are refused.
- **Tools the AI may use:** web search and web page reading only. It cannot run commands or read or write files.

### Defaults and limits

| Item | Value |
| --- | --- |
| Facts per brief | 4 to 12 |
| Talking points / questions | up to 5 each |
| Time limit | 8 minutes (`COMPANY_RESEARCH_TIMEOUT_MS`, in milliseconds) |
| Page read limit | 15 seconds and 3 MB per source page |
| Runs at once | one per job and workspace |
| Storage | the latest brief per job, private to your workspace |
| Demo | not available |

## Common problems

- **"… is not signed in for this workspace."** Sign in under **Settings → AI account**, then click **Try again**.
- **Many facts marked "?"** The cited sites block automated reads (common for LinkedIn and some job boards). The facts may still be true. Open the source and check yourself. Quotes from the job posting are also checked against the job description Boussole already stored.
- **"Needs review" with a wrong company.** The company name is shared by several organisations. Add the company's website to the job (edit job details) and research again.
- **"The research did not finish within 8 minutes."** Try again, or pick a faster model or a lower effort under **Settings → AI account**.
- **"The research was interrupted."** The server restarted during the run. Click **Try again**.

## Related pages

- [AI Account](/docs/features/ai-account)
- [Ghostwriter](/docs/features/ghostwriter)
- [Find jobs and apply](/docs/workflows/find-jobs-and-apply-workflow)
