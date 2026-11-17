---
id: settings
title: Settings
description: Configure your AI account and model, writing style, webhooks, workspaces, backups, scoring, and safety controls.
sidebar_position: 2
---

## What it is

The Settings page is the control center for app-wide behavior.

![Settings page sections](/img/features/settings.png)

It lets you configure:

- Your AI account (Claude or ChatGPT) and the model every AI step uses
- Webhook destinations and secret
- Display and writing-style defaults
- Editable prompt templates for core AI workflows
- Service credentials and workspace users
- Tracer Links readiness verification
- Backup and scoring rules
- Data-clearing actions in the Danger Zone

## Why it exists

Most teams want stable defaults for repeated workflows, without editing environment variables every time.

Settings gives you runtime overrides for the key parts of discovery, scoring, tailoring, and post-application automation.

## How to use it

1. Open **Settings**.
2. Expand each section you want to change.
3. Update values and click **Save Changes**.
4. Re-run the workflow that uses those settings (for example pipeline runs, Ghostwriter, or resume tailoring) to verify behavior.

## Section-by-section guide

### AI account

Every AI step (scoring, CV tailoring, cover letters, Ghostwriter, agents) runs on your own AI account: **Claude** (a Claude plan or an Anthropic Console account) or **ChatGPT** (your ChatGPT plan).

- Sign in on Anthropic's or OpenAI's own page, choose which account Boussole uses, and pick the model and effort for each.
- Model and account choices save immediately, separately from the **Save** button.
- The owner's workspace can keep using the server's own Claude login.

See [AI Account](/docs/features/ai-account) for the full guide.

### Webhooks

![Webhooks settings section](/img/features/settings-webhooks-section.png)

- Pipeline status webhook: called on run completion/failure
- Job completion webhook: called when a job is marked applied
- Optional webhook secret (sent as bearer token)

### Display Settings

![Display settings section](/img/features/settings-display-section.png)

- Toggle `Render Markdown in job descriptions` to control whether expanded job descriptions show formatted headings, lists, bold text, and code blocks
- Default: Markdown rendering is enabled

### Writing Style & Language

![Ghostwriter settings section](/img/features/settings-ghostwriter-section.png)

- Pick a preset for a quick starting point
- Set global writing defaults:
  - Tone
  - Formality
  - Output language mode
  - Manual output language
  - Use Stop Slop for Ghostwriter
  - Constraints
  - Do-not-use terms
- These settings apply to Ghostwriter and resume tailoring
- `Use Stop Slop for Ghostwriter` applies only to Ghostwriter. It adds extra instructions that cut filler, formulaic AI phrasing, passive voice, vague claims, and em dashes.
- Use the output language controls as the primary way to choose generated language
- Choose how AI output language is resolved:
  - `Manual`: always use the language you select, such as English, German, French, or Spanish
  - `Match Resume`: detect the dominant language from your resume/profile content and use that language for generated output
- If language detection is unclear or there is not enough resume/profile text, Boussole falls back to English
- Resume tailoring keeps the exact source wording for ATS-sensitive resume headlines and job titles, even when the rest of the tailored content is generated in the selected language
- Fixed CV section titles in the PDF follow the CV's own language (a French CV gets "Expériences")
- Summary max words: optional cap on AI-generated summary length (empty = no limit)
- Max keywords per skill: optional cap on keywords per skill category in tailoring (empty = no limit)
- These numeric limits override any similar constraints written in the Constraints text field
- Do-not-use terms are model guidance, not a guaranteed output filter
- `Use Stop Slop for Ghostwriter` is disabled by default and affects only new Ghostwriter responses after you save

#### Writing Style & Language workflow

Use these steps when you want Ghostwriter and resume tailoring to stay in a specific language:

1. Open **Settings**.
2. Expand **Writing Style & Language**.
3. Choose a preset if you want a starting point for tone and formality.
4. Under the language control, choose one of these modes:
   - **Manual**: pick the output language directly.
   - **Match Resume**: let Boussole infer the language from your resume/profile text.
5. If you chose **Manual**, select the language you want the AI to use.
6. Review the rest of the writing defaults such as tone, formality, constraints, and do-not-use terms.
7. Click **Save Changes**.
8. Run Ghostwriter or start resume tailoring again so the new language preference is applied to new output.

Defaults and constraints:

- `Manual` is best when you always want output in one language regardless of the resume source text.
- `Match Resume` is best when your base resume is already written in the language you want to preserve.
- If Boussole cannot determine a reliable resume/profile language, it safely uses English.
- The generated resume content follows the resolved language, but ATS-sensitive headline and job-title wording stays exact so matching and parsing remain safer.
- The PDF uses the CV's language for fixed section headings such as Profile, Experience, Education, Projects, and Technical Skills.

### Prompt Templates

- Edit the base templates for:
  - Ghostwriter system prompt
  - Resume tailoring prompt
  - Job scoring prompt
- Each editor starts from the current effective template, not a blank override
- Supported placeholders are shown inline for each template
- Use **Reset** to restore a single template, or **Reset all prompts** to restore all three
- Template editing is intentionally advanced:
  - removing key instructions can degrade output quality
  - removing placeholders can strip important runtime data from the prompt
  - resetting restores the shared default templates
- Existing writing-style, language, and scoring-instructions settings still matter because the default templates consume those values through placeholders

### Tracer Links

- Verify tracer readiness before enabling per-job tracing
- Shows current status (`Ready`, `Unavailable`, `Unconfigured`, or stale state)
- Displays the effective public base URL and last check time
- Provides **Verify now** for an on-demand health check

Readiness requires:

- a valid public Boussole base URL
- successful reachability of `<public-base-url>/health`
- non-localhost/non-private host setup for public redirect usage

### Environment & Workspaces

- Configure service accounts:
  - Adzuna app ID/app key
- Manage workspace users when signed in as a system admin:
  - create a user with a private workspace
  - disable a user
  - reset a user's password
- Each created user gets a separate private workspace. Jobs, settings, resume data, integrations, PDFs, pipeline runs, chat, analytics, and post-application data are scoped to that user's workspace.
- `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` are only used as legacy bootstrap credentials during migration. New sign-ins use database users.

### Backup

![Backup settings section](/img/features/settings-backup-section.png)

- Enable/disable automatic daily backups
- Configure backup hour (UTC) and max retained backups
- Create or delete backups manually
- Backup management is available only to system admins
- See [Database Backups](../getting-started/database-backups) for full backup/restore guidance.

### Scoring Settings

![Scoring settings section](/img/features/settings-scoring-section.png)

- Penalize missing salary data
- Set penalty amount
- Optional auto-skip threshold for low-score jobs
- Block jobs from companies that match configured keyword tokens
- Add custom scoring instructions to tell the AI what to weigh more or less

### Danger Zone

![Danger Zone settings section](/img/features/settings-danger-zone-section.png)

- Clear jobs by selected statuses
- Clear jobs below a score threshold
- Clear the full database

## API examples

```bash
# Get effective settings (defaults + overrides)
curl "http://localhost:3001/api/settings"
```

```bash
# Update settings overrides
curl -X PATCH "http://localhost:3001/api/settings" \
  -H "content-type: application/json" \
  -d '{
    "model": "opus:medium",
    "chatStyleTone": "concise"
  }'
```

```bash
# Override the Ghostwriter base prompt template
curl -X PATCH "http://localhost:3001/api/settings" \
  -H "content-type: application/json" \
  -d '{
    "ghostwriterSystemPromptTemplate": "You are Ghostwriter. Tone: {{tone}}. Output language: {{outputLanguage}}. {{constraintsSentence}}"
  }'
```

```bash
# List and create backups (used by the Backup section)
curl "http://localhost:3001/api/backups"
curl -X POST "http://localhost:3001/api/backups"
```

## Common problems

### Saved value does not seem to apply

- Some settings apply only to new runs/actions after save.
- Re-run scoring/tailoring/pipeline to validate effect.
- A new AI account or model choice applies to the next AI action; it saves as soon as you pick it.
- Prompt-template changes only affect new Ghostwriter runs, new tailoring generations, and new scoring runs after you save.

### I do not see workspace user controls

- Workspace user management is shown only to system admins.
- The first user created during first-run setup or legacy migration is the system admin.
- Normal users can use their private workspace settings, but cannot create users, reset other passwords, or manage backups.

### AI behavior got worse after editing a prompt template

- Open **Settings → Prompt Templates**.
- Reset the individual template you changed, or use **Reset all prompts**.
- Save settings and rerun the affected workflow.
- If you keep a custom template, make sure required placeholders still exist where you need runtime data such as `{{jobDescription}}`, `{{profileJson}}`, or `{{outputLanguage}}`.

### AI steps fail with a Claude error

- Run `claude` once in a terminal on the host to sign in, then retry.
- On a server, refresh the token: run `claude setup-token` and update `CLAUDE_CODE_OAUTH_TOKEN`.
- Check **Settings → AI account**: the chosen account must show as signed in. Pick another model if the current one keeps failing.

### Resume tailoring used English instead of my resume language

- Open **Settings → Writing Style & Language** and confirm whether the language mode is set to **Manual** or **Match Resume**.
- If you want a specific language every time, switch to **Manual** and select that language explicitly.
- If you use **Match Resume**, make sure your resume/profile text has enough content in the target language for detection.
- If detection is ambiguous, Boussole falls back to English by design.

### My headline or target job title did not get translated

- This is expected during resume tailoring.
- Boussole intentionally preserves exact headline and job-title wording for ATS safety, even when other tailored sections are generated in another language.
- If you need a different headline or target title, change the source resume/profile text first and then re-run tailoring.

### Webhook calls fail

- Verify URL reachability from the server host.
- Confirm auth expectations on the receiver side (including secret/bearer token).

### Tracer links cannot be enabled

- Open **Settings → Tracer Links** and click **Verify now**.
- Ensure `FORSA_PUBLIC_BASE_URL` is set for background/pipeline usage.
- Ensure the configured host is publicly reachable and `/health` responds.

## Related pages

- [CV Editor](/docs/features/design-resume)
- [Database Backups](/docs/getting-started/database-backups)
- [Overview](/docs/features/overview)
- [Orchestrator](/docs/features/orchestrator)
- [Ghostwriter](/docs/features/ghostwriter)
- [Self-Hosting](/docs/getting-started/self-hosting)
