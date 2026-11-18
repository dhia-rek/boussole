---
id: intro
title: Boussole — Documentation
description: Documentation index for setup, features, extractors, and common problems.
sidebar_position: 1
slug: /
---

Welcome to Boussole documentation. This site contains guides for setup, configuration, and day-to-day usage.

## Getting Started

- **[Self-Hosting Guide](/docs/getting-started/self-hosting)**
  - Docker setup instructions
  - Gmail OAuth configuration for email tracking
  - Environment variables reference
  - Demo mode deployment

- **[Database Backups](/docs/getting-started/database-backups)**
  - Automatic backup scheduling and retention
  - Manual backup creation/deletion
  - Restore workflow and troubleshooting

## Workflows

- **[Find Jobs and Apply Workflow](/docs/workflows/find-jobs-and-apply-workflow)**
  - Run pipeline first, then review discovered and ready jobs
  - Use fit assessment and score to prioritize applications
  - Mark jobs as applied to trigger webhooks and analytics

- **[Post-Application Workflow](/docs/workflows/post-application-workflow)**
  - Track events manually for direct control
  - Or configure automatic Gmail sync and inbox review
  - Move confirmed updates into in-progress tracking

## Feature Documentation

- **[Orchestrator](/docs/features/orchestrator)**
  - Job states explained (`discovered`, `ready`, `applied`, etc.)
  - The ready flow (manual vs auto)
  - PDF generation and regeneration
  - Post-application tracking overview

- **[Pipeline Run](/docs/features/pipeline-run)**
  - Run modal controls (`Automatic` vs `Manual`)
  - Presets, source/country compatibility, and advanced settings
  - Run estimate and start conditions

- **[Job Search Bar](/docs/features/job-search-bar)**
  - Open with `Cmd+K` / `Ctrl+K` or the Search button
  - Fuzzy search across title, company, and location
  - Use `@status` lock syntax to scope results quickly

- **[Keyboard Shortcuts](/docs/features/keyboard-shortcuts)**
  - Full Jobs-page shortcut reference by context
  - `?` shortcut help dialog and `Control` hint bar behavior
  - Tab-specific actions like skip, move to ready, and mark applied

- **[Multi-Select and Bulk Actions](/docs/features/multi-select-and-bulk-actions)**
  - Select many jobs using row checkboxes or select-all
  - Run bulk move, skip, and rescore actions from the floating action bar
  - Keyboard support for select, clear, and fast bulk move-to-ready

- **[Settings](/docs/features/settings)**
  - Your AI account (Claude or ChatGPT) and model
  - Webhooks, service accounts, and basic auth controls
  - Backup scheduling, scoring thresholds, and danger-zone cleanup tools

- **[CV Editor](/docs/features/design-resume)**
  - Edit your CV in the browser with a live PDF preview, one CV per language
  - AI guidance per section: tailor it, keep it word for word, or keep it private
  - One Boussole PDF layout with your photo, auto-fit to one page

- **[Applications Overview](/docs/features/overview)**
  - Applications-per-day trend
  - Conversion analytics and funnel
  - Duration window controls (`7d`, `14d`, `30d`, `90d`)

- **[Applications board](/docs/features/in-progress-board)**
  - Pre-application vs post-application workflow split
  - Kanban tracking for higher-attention opportunities
  - Drag-and-drop stage management

- **[Ghostwriter](/docs/features/ghostwriter)**
  - One persistent conversation per job
  - Streaming responses, stop, and regenerate
  - Markdown rendering and drawer behavior
  - Writing style settings impact

- **[Post-Application Tracking](/docs/features/post-application-tracking)**
  - How the Smart Router AI works
  - Gmail integration setup
  - Using the Tracking Inbox
  - Privacy and security details
  - API reference

- **[AI Agents](/docs/features/ai-agents)**
  - A LangChain Deep Agents team prepares an application pack: job analyst, CV tailor, cover-letter writer, critic
  - A preference learner remembers what you apply to and skip

## Extractors

- **[Job Sources](/docs/extractors/overview)**
- **[Welcome to the Jungle](/docs/extractors/welcome-to-the-jungle)**
- **[Company Career Pages](/docs/extractors/company-career-pages)**
- **[JobSpy](/docs/extractors/jobspy)** (LinkedIn, Indeed, Glassdoor)
- **[Manual Import](/docs/extractors/manual)**

## Quick Reference

### Main Components

- **Orchestrator**: Main application (UI, API, database)
- **Extractors**: Specialized job crawlers
- **Shared**: Common types and utilities

### Key Features

1. **Job Discovery**: Automatically find jobs from multiple sources.
2. **AI Scoring**: Rank jobs by suitability for your profile.
3. **Resume Tailoring**: Generate custom resumes for each job.
4. **PDF Export**: Create tailored one-page PDFs from the CV editor's CV, in the Boussole LaTeX layout.
5. **Application Tracking**: Monitor your applied jobs.
6. **Email Tracking**: Auto-track post-application responses.

## Contributing to Documentation

When adding user-visible behavior:

1. Update the relevant feature page in current docs.
2. Add API documentation where relevant.
3. Keep examples realistic and copy-pasteable.
4. Include diagrams for non-trivial workflows.

## Support

- Open an [issue](https://github.com/dhia-rek/boussole/issues) for documentation errors.
- Check these docs before opening support requests.
