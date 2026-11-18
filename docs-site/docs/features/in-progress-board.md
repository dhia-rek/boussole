---
id: in-progress-board
title: Applications Board
description: Kanban board of every application, from the moment you apply to interviews, offer or close, with follow-up hints.
sidebar_position: 3
---

## What it is

The Applications board (sidebar → **Applications**) is a kanban view of every job you applied to.

![Applications board kanban lanes](/img/features/in-progress-board.png)

It groups jobs into lanes:

- Applied: waiting for a reply. Each card shows how long ago you applied, and after 7 days without a reply it shows **"No reply yet — follow up?"**.
- Recruiter Screen
- Assessment
- Team Match
- Technical Interview
- Final Round
- Offer
- Closed

## Why it exists

Boussole uses two operational modes:

- **Pre-application tracking** (`Jobs` page): large volume, pipeline and readiness focused.
- **Post-application tracking** (`Applications`): smaller volume, higher attention per job.

Once a job enters the post-application phase, each opportunity usually needs tighter follow-up, interview prep, and deliberate stage management. A kanban board is better for that than a large list.

## How to use it

1. Open **Applications**.
2. Review jobs by lane to see current stage distribution.
3. Drag a card to a new lane to log a stage transition.
4. Open a card to view full job details and timeline.
5. Use sorting (Recent / Title / Company) to prioritize review.

### How jobs get on the board

- **Mark applied** on a job (from **How to apply** on the job's Overview, or **Mark Applied**). The job appears in **Applied** right away, with the channel you used ("Applied via LinkedIn", "Applied via email · to recrutement@…") on its timeline.
- When a reply comes in, drag the card to the next lane, or log the step on the job's **Timeline**. Logging a reply or interview on an applied job moves it forward automatically.
- The Tracking Inbox can move jobs for you when it matches a recruiter email.

### API examples

```bash
# List in-progress jobs
curl "http://localhost:3001/api/jobs?status=in_progress&view=list"
```

```bash
# Move a job to technical interview
curl -X POST "http://localhost:3001/api/jobs/<jobId>/stage-events" \
  -H "content-type: application/json" \
  -d '{
    "toStage": "technical_interview",
    "metadata": {
      "actor": "user",
      "eventType": "status_update",
      "eventLabel": "Moved to Technical Interview"
    }
  }'
```

## Common problems

### Board is empty

- Confirm jobs have status `in_progress`.
- Confirm stage events exist for applied jobs expected on the board.

### A card appears in an unexpected lane

- The board uses the latest stage event as source of truth.
- Check timeline events for out-of-order or mistaken transitions.

### Drag-and-drop move failed

- Network/API error can roll back optimistic UI movement.
- Retry move and check server logs for validation errors.

## Related pages

- [Overview](/docs/features/overview)
- [Orchestrator](/docs/features/orchestrator)
- [Post-Application Tracking](/docs/features/post-application-tracking)
