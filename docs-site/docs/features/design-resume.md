---
id: design-resume
title: CV Editor
description: Edit your CV inside Boussole, keep one version per language, and tell the AI how to use each section.
sidebar_position: 4
---

## What it is

The CV editor (called Design Resume in the code) is Boussole's local-first CV editor.

It stores your CV inside Boussole as structured data (Reactive Resume's open v5 JSON format) and uses it as the source of truth for:

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

1. Open **CV** from the main navigation.
2. Click **Upload a CV file** (PDF or DOCX). Claude reads the file's text and turns it into an editable CV; a scanned PDF without selectable text cannot be read.
3. Edit sections in the **Content** tab on the left. Changes save automatically; the indicator next to the tabs shows **Saving…**, **Saved**, or **Not saved**.
4. The right panel is a live preview of the exact PDF recruiters will receive.

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
- **Default** — a project visible in your CV is always included; a hidden one can be added by the AI when relevant. A tailored CV shows at most 3 projects, or more when more are visible or pinned.

A sparkle icon on an entry in the **Content** tab means it has AI guidance (a note or a pin).

### The PDF layout

Every CV, the one you edit and every tailored one, uses the same Boussole layout:

- A4, one column, Source Sans at 9 pt: applicant tracking systems read it in order.
- Your name and headline at the top, with your languages beside the headline (for example *Trilingual: French, English, Arabic*), contact details on one line and profile links on the next.
- A round photo with a thin coral ring, when the CV has a picture (**Picture** section of the **Content** tab). Without a picture, the header uses the full width.
- Indigo uppercase section titles over coral rules, skills aligned in two columns, and a **Stack:** line under each role or project (write a bullet that starts with `Stack:` and it moves there).
- Section titles follow the CV's language: a French CV gets *Expériences*, *Formation*, *Compétences techniques*.

A CV that slightly overflows onto a second page is re-rendered with progressively tighter spacing until it fits on one page. CVs of three pages or more are never squeezed. Bold text from the editor is kept in the PDF.

When Design Resume changes, ready jobs with system-generated PDFs are queued for automatic regeneration. Until the queue catches up, those jobs show a `PDF stale` indicator and keep the old PDF available.

## Common problems

- **The AI still rewrote my summary.** Check that the summary is set to **Keep as written** in the AI guidance tab of the CV used for that job (each language version has its own guidance). Then regenerate the job's tailoring.
- **An English job used my French CV.** Boussole detects the job description's language from its text. Very short or mixed-language descriptions can be detected as unclear, in which case the default CV is used.
- **A tailored CV is missing projects.** Check the project pins in the **AI guidance** tab: pin a project as **Always include** to force it. If you switched CV languages, Boussole automatically re-selects projects for jobs whose old selection no longer matches.
- **Import fails.** File import needs Claude to be connected (Settings → AI model) and a file with selectable text.
- **The PDF has two pages.** Auto-fit only works when the overflow is small. Shorten content or hide entries with the eye icon.
- **The photo is missing from the PDF.** Use a `png` or `jpeg` picture and make sure the **Picture** section is not hidden. `webp` pictures show in the editor but cannot be printed in the PDF.

## Related pages

- [AI Agents](/docs/features/ai-agents)
- [Ghostwriter](/docs/features/ghostwriter)
- [Settings](/docs/features/settings)
- [Orchestrator](/docs/features/orchestrator)
