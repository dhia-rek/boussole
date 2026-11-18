---
id: cv-check
title: CV Check
description: Reads your CV line by line against one job, marks each line keep, reword or "not it for this job", and lists what the job asks for that your CV doesn't show.
sidebar_position: 11
---

## What it is

**CV check** is a panel on each job's overview page. It reads your CV against that one job, the way a demanding recruiter for that role would:

- every line gets a verdict: **Fits this job**, **Reword for this job** (with a suggested rewording), or **Not it for this job** (with the reason)
- **The job asks, your CV doesn't show:** requirements of the job your CV doesn't show, each marked as a wording gap (you have it, under another name) or a real gap
- **Change first:** the three changes that matter most for this job

The check is advisory. **It never changes your CV.**

## Why it exists

A CV written for one kind of job carries lines that are noise for another: an old marketing task on an engineering application, a vague claim, outdated memberships. They are easy to miss when you read your own CV. The CV check points at them for each job, so you decide what to drop, reorder or reword.

## How it works

1. **Your CV is the dictionary.** Boussole numbers every visible line of your CV: L1, L2 and so on, covering the headline, summary paragraphs, each bullet, skill groups and entries. It uses the CV variant in the job's language: your English CV for an English posting, otherwise your main CV. The review can only talk about these lines. Anything it says about a line that doesn't exist is thrown away.
2. **Your AI account reviews it** against the job description. No web access is used.
3. **Your rules apply.** Boussole passes along your notes from **Design Resume → AI guidance**:
   - a required headline start
   - sections you keep identical for every job
   - notes on sections and items
4. **No padding.** Suggestions may only rephrase, reorder or reuse what your CV already says. Boussole also checks each suggestion itself. If one contains a number, tool or name that appears nowhere in your CV, it shows a warning: *"Not in your CV: … Use this wording only if it is true."*

### What is sent to your AI account

- the job title, company, location and description (up to 6,000 characters)
- your CV lines and your AI guidance notes

Never sent:

- your name, email, phone, address or profile links
- references, hidden items and hidden sections
- sections you set to not shared with the AI

## How to use it

1. Make sure you have a CV in **Design Resume** and an AI account under **Settings → AI account**.
2. Open a job and stay on its **Overview**.
3. In the **CV check** panel, click **Check my CV**. It usually takes under a minute.
4. Read **Change first**, then the **Lines to look at**:
   - amber line with an arrow: a suggested rewording
   - struck-through red line: not it for this job, with the reason
5. Click **Show all N lines** to see the lines that fit as well.
6. Edit your CV yourself in **Design Resume** if you agree, then click **Check again**.

If you edit your CV after a check, the panel says **"Your CV changed since this check."**

### Defaults and limits

| Item | Value |
| --- | --- |
| CV lines reviewed | up to 150 |
| Missing requirements listed | up to 8 |
| Priorities | 3 |
| Runs at once | one per job and workspace |
| Storage | the latest check per job, private to your workspace |
| Demo | not available |

## Common problems

- **"Import or create your CV first."** Create or import a CV in **Design Resume**.
- **Suggestions keep a word you no longer want (for example "Intern").** The check follows your AI guidance. Change the headline note or prefix in **Design Resume → AI guidance**, then check again.
- **Few "reword" verdicts on the summary, skills or projects.** You set those sections to stay identical for every job, so the check only flags lines there that clearly hurt.
- **"The CV check was interrupted."** The server restarted during the run. Click **Try again**.

## Related pages

- [Design Resume](/docs/features/design-resume)
- [Company Research](/docs/features/company-research)
- [AI Account](/docs/features/ai-account)
