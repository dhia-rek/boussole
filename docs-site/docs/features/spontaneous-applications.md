---
id: spontaneous-applications
title: Spontaneous Applications
description: Write to a company that hasn't posted the job you want - Boussole finds where to send it, checks every source, writes the email from your CV, and logs it on your board.
sidebar_position: 12
---

## What it is

**Spontaneous** (sidebar → Spontaneous) helps you send a *candidature spontanée*: an application to a company with no matching job post. It takes you through four steps:

1. **Pick a company**: type a name (and its website if you know it), or click one of the suggestions.
2. **Who to write to**: Boussole finds where to send the application and checks every source.
3. **Write the email**: in French or English, from your CV and verified facts only.
4. **Send it**: open it in your mail app, attach your CV, and log it on your Applications board.

## Why it exists

Many companies hire without posting every role, especially startups. The hard parts of a spontaneous application are knowing where to send it, and saying something true and specific about the company. This page does both, and doesn't make things up: an address is offered only if it is written on a public page, and the email only uses company facts that Boussole confirmed on their source.

## How to use it

### 1. Pick a company

- Type the company name. Add its website if several companies share the name.
- Or click a suggestion. Suggestions are companies from your own job list that you haven't applied to or contacted yet, best matches first.
- **Your spontaneous applications** lists the companies you already worked on and where each one stands: searching, contacts found, email written, sent.

### 2. Who to write to

Your AI account searches the web (1 to 3 minutes; you can leave the page) for:

| Found | How Boussole checks it |
| --- | --- |
| Recruiting addresses published by the company (recrutement@, jobs@, careers@…) | Boussole opens the page it came from and keeps the address only if it is written there. Guessed addresses are dropped. |
| An application form or careers page | Boussole opens the page and checks it loads. |
| Recruiters / talent acquisition people on LinkedIn | Shown with their title. LinkedIn blocks automated reads, so these are marked "can't be checked automatically". |
| Up to 6 facts about the company | Each quote must be on its page, the same check as [Company Research](/docs/features/company-research). |

**Send to** only offers recruiting addresses: verified published ones, and people whose title is in recruiting or HR. Founders, executives and other teams are listed apart under **Other addresses (not in recruiting)** and are never chosen for you.

If you saved a **Hunter.io** API key (Settings), Hunter's addresses are added too. They are estimates, shown with Hunter's confidence and marked "not checked". Only the company's domain is sent to Hunter.

When no recruiting address exists, the page says so and points you to the application form, the careers page or the LinkedIn recruiters.

### 3. Write the email

- Optionally type the role you're after (for example `Data Engineer`), and pick **Français** or **English**.
- Click **Write it**. The email is written from:
  - your CV **in that language** (your English CV for English, otherwise your main CV), without the sections you keep private from the AI;
  - the verified company facts only.
- Edit the subject and text freely. If the email contains a number, tool or name that appears neither in your CV nor in the verified facts, Boussole warns you: keep it only if it is true.

### 4. Send it

- **Open in my mail app** fills in the address, subject and text. If the text is too long for a mail link, the subject is filled and the text is copied for you to paste.
- **Copy all** copies address, subject and text (for an application form or a LinkedIn message).
- **My CV to attach** downloads your CV PDF in the email's language.
- Then click **Yes, log it** under "Did you send it?". The application appears on your [Applications board](/docs/features/in-progress-board) under **Applied**, with the recipient on its timeline and the email saved in the job's description for follow-ups.

## Common problems

- **"… is not signed in for this workspace."** Sign in under **Settings → AI account**.
- **"No recruiting address was found."** Many companies don't publish one. Use the application form or careers page, or message a recruiter on LinkedIn with the email text (**Copy all**).
- **The wrong company was found.** Add the company's website in step 1 and search again.
- **"Import or create your CV first."** Create or import a CV in **Design Resume**.
- **"The search was interrupted."** The server restarted during the search. Search again.

## Related pages

- [Company Research](/docs/features/company-research)
- [Applications Board](/docs/features/in-progress-board)
- [AI Account](/docs/features/ai-account)
- [Design Resume](/docs/features/design-resume)
