---
id: design-resume
title: Design Resume
description: Edit your CV inside Boussole, keep one version per language, and tell the AI how to use each section.
sidebar_position: 4
---

## What it is

Design Resume is Boussole's local-first CV editor.

It stores your CV as a Reactive Resume v5 document inside Boussole and uses it as the source of truth for:

- profile context for job scoring
- tailoring inputs (headline, summary, skills, projects)
- cover letters written by Ghostwriter
- PDF generation

On top of the CV content, each CV carries **AI guidance**: per-section rules and notes that tell every AI step how to treat your CV. AI guidance is never printed on the PDF.

You can keep **one CV per language** (for example a French and an English CV). Each job automatically uses the CV written in the job description's language.

## Why it exists

- Editing your CV where you tailor and track applications avoids juggling tools.
- Some parts of a CV must never be rewritten (for example your work experience), while others benefit from per-job tailoring (the headline). AI guidance makes those rules explicit and enforced instead of hoping the model follows them.
- Applying in several countries usually means maintaining CVs in several languages; Boussole picks the right one per job.

## How to use it

### Import or create your CV

1. Open **Design Resume** from the main navigation.
2. Click **Upload a CV file** (PDF or DOCX) or **Import from Reactive Resume**.
3. Edit sections in the **Content** tab on the left. Changes save automatically; the indicator next to the tabs shows **Saving…**, **Saved**, or **Not saved**.
4. The right panel is a live preview of the exact PDF that will be generated with the selected template.

### Add a CV in another language

1. Open the **⋯** menu next to **Download PDF**.
2. Choose **Add a CV in another language** and pick the language (Français, English, Deutsch, Español).
3. Upload that language's CV file.

A language switcher appears in the header. The first CV you created is the **Default** one: it is used for jobs whose language has no dedicated CV.

| Job description language | CV used |
| --- | --- |
| Has a CV in that language | That CV |
| No CV in that language, or language unclear | Default CV |

Tailoring, project selection, cover letters, and the job PDF all use the same CV for a given job.

To remove a language version, switch to it and choose **Delete this … CV** in the **⋯** menu. The default CV cannot be deleted (replace it with **Replace from a file** instead).

### Tell the AI how to use your CV

Open the **AI guidance** tab. Each section has:

- **A mode** (headline, summary, skills, projects):
  - **Match each job / Rewrite per job / AI picks** — the AI adapts this section to every job.
  - **Keep as written / Keep as shown** — tailored CVs use the section exactly as written. This is enforced by Boussole, not just requested from the model.
- **Always start with** (headline only) — every tailored headline starts with this text. Example: `Stagiaire` turns the job title `Stage - Data Scientist (H/F)` into `Stagiaire Data Scientist`.
- **Notes for the AI** — context the AI uses when scoring jobs, tailoring, and writing cover letters (for example *"Mention I'm looking for a 6-month end-of-studies internship"*).
- **Shared with the AI** — turn it off to make a section private. Private sections are never sent to any LLM. References and profile links are private by default.

Experience, education, and the other sections are always copied verbatim into tailored CVs; you can still add notes so the AI knows what matters in them.

For **projects** in *AI picks* mode, each project can be pinned:

- **Always include** — on every tailored CV.
- **AI decides** — the AI picks it when relevant.
- **Never include** — never on tailored CVs.
- **Default** — follows **Settings → Resume projects**.

A sparkle icon on an entry in the **Content** tab means it has AI guidance (a note or a pin).

### One-page PDFs

With the **Local LaTeX (Jake template)** renderer, a CV that slightly overflows onto a second page is re-rendered with progressively tighter spacing until it fits on one page. CVs of three pages or more are never squeezed. Bold text from the editor is kept in the PDF, and section titles follow the CV's language.

When Design Resume changes, ready jobs with system-generated PDFs are queued for automatic regeneration. Until the queue catches up, those jobs show a `PDF stale` indicator and keep the old PDF available.

## Common problems

- **The AI still rewrote my summary.** Check that the summary is set to **Keep as written** in the AI guidance tab of the CV used for that job (each language version has its own guidance). Then regenerate the job's tailoring.
- **An English job used my French CV.** Boussole detects the job description's language from its text. Very short or mixed-language descriptions can be detected as unclear, in which case the default CV is used.
- **A tailored CV is missing projects.** Check the project pins and **Settings → Resume projects → Max projects**. If you switched CV languages, Boussole automatically re-selects projects for jobs whose old selection no longer matches.
- **Import fails.** File import needs a working LLM connection (Settings → AI). Reactive Resume import needs valid Reactive Resume credentials and a selected base resume.
- **The PDF has two pages.** Auto-fit only applies to the LaTeX renderer and only when the overflow is small. Shorten content or hide entries with the eye icon.
- **Picture upload fails.** Use `png`, `jpeg`, or `webp` images, and make Boussole reachable at a public URL (pictures are fetched by the renderer).

## Related pages

- [Reactive Resume](/docs/features/reactive-resume)
- [Ghostwriter](/docs/features/ghostwriter)
- [Settings](/docs/features/settings)
- [Orchestrator](/docs/features/orchestrator)
