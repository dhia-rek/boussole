---
id: ai-agents
title: AI Agents (LangChain Deep Agents)
description: Multi-agent application packs and preference learning built on LangChain Deep Agents, running on your Claude subscription through the Claude CLI.
sidebar_position: 9
---

## What it is

Boussole ships a multi-agent layer built with [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) (`deepagents`, LangGraph under the hood). It has two parts:

- **Application agents**: for one job, an orchestrator agent chains four subagents through the Deep Agents `task` tool:
  1. **job-analyst** reads the posting: must-haves, keywords, seniority, contract type, red flags.
  2. **cv-tailor** proposes a CV headline and what to emphasise per section, following your CV's AI guidance rules.
  3. **cover-letter-writer** writes a 180–250 word letter in the posting's language, using only facts from your CV.
  4. **critic** checks every claim against your CV and the tailoring rules. The orchestrator removes or rewords anything unsupported before saving.

  The cv-tailor and cover-letter-writer run in parallel. The result is an **application pack**: analysis, headline, emphasis, cover letter, critique, fixed claims and remaining risks.
- **Preference learner**: reads your recent decisions (jobs you applied to or skipped, plus outcomes such as interview stages or rejections). It rewrites a memory file, `/memories/preferences.md`, listing what you prefer and avoid, with evidence counts. The application agents read this file.

The agents run on your own Claude subscription through the Claude Code CLI (`claude -p`). A small adapter, `ChatClaudeCli`, turns the CLI into a LangChain chat model with tool calling, so no API key is needed.

## Why it exists

The regular pipeline (search → score → tailor → export) uses one prompt per step. Some work benefits from several focused agents checking each other: a separate critic catches invented claims that a single prompt lets through.

"Learning" here means **memory**, not model training. Your decisions are summarised into a file that every later run reads. No model weights change.

## How to use it

Requirements:

- Settings → AI provider is **Claude (CLI)**, and the `claude` command is installed and signed in on the machine running Boussole.
- Your CV exists in **Design Resume**. Its AI guidance (locked sections, headline prefix, private sections) is enforced.

API (all routes are scoped to your workspace):

```bash
# Start the application agents for a job (returns 202 with the run id)
curl -X POST http://localhost:3001/api/agents/application/<jobId> \
  -H "Authorization: Bearer $TOKEN"

# Follow live progress (Server-Sent Events: stored events first, then live ones,
# then a final {"type":"run"} message)
curl -N http://localhost:3001/api/agents/runs/<runId>/events \
  -H "Authorization: Bearer $TOKEN"

# Read the run (status, events, stats, output.pack)
curl http://localhost:3001/api/agents/runs/<runId> -H "Authorization: Bearer $TOKEN"

# List runs (optionally for one job)
curl "http://localhost:3001/api/agents/runs?jobId=<jobId>&limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Cancel a run
curl -X POST http://localhost:3001/api/agents/runs/<runId>/cancel \
  -H "Authorization: Bearer $TOKEN"

# Update learned preferences from your decisions, then read them
curl -X POST http://localhost:3001/api/agents/learn -H "Authorization: Bearer $TOKEN"
curl http://localhost:3001/api/agents/memory -H "Authorization: Bearer $TOKEN"
```

Defaults and limits:

- One agent run at a time per workspace. Starting another returns `409 CONFLICT`.
- A run stops after 20 minutes (`AGENT_RUN_TIMEOUT_MS`). Each CLI call is limited to 5 minutes (`AGENT_CLI_TIMEOUT_MS`).
- An application pack takes about 13 CLI calls: the orchestrator takes 5 turns and each subagent 2. With `opus:medium` a run took about 2–3 minutes in testing (139 s); the preference learner takes 1 call (about 10 s).
- The learner needs at least 3 decisions. Its memory file is at most 2,500 characters.
- What the agents see: the job posting fields and the **AI view** of your CV. Email, phone, street address and sections you marked private are removed. Run events record only agent names, tool names and short task descriptions, never prompts or CV text.

Switching to an API model later: `ChatClaudeCli` is the only Claude-CLI-specific piece. Replacing it with an API-backed LangChain model (for example `ChatAnthropic` with an API key) where the agents are built leaves the agents, tools, memory and API unchanged.

Personal use only: the Claude CLI runs with **your** Claude login. Keep Boussole's agents for your own job search; anything that other people use needs API-key authentication.

## Common problems

### `409` "AI agents run on the Claude CLI provider"

Settings → AI provider is not **Claude (CLI)**. Switch it, or wait for another run in this workspace to finish.

### `503` "AI agents need a database update"

The database predates the agent tables. Restart Boussole: `npm run dev` (and the Docker image) runs migrations at startup.

### A run fails with "did not follow the agent reply protocol"

The model answered twice without the required JSON. Start the run again. If it keeps happening, check that `claude -p "hello"` works in a terminal.

### The run says "Interrupted: Boussole restarted"

Runs live in the server process. A restart marks unfinished runs as failed. Start them again.

## Related pages

- [Design Resume](/docs/next/features/design-resume)
- [Ghostwriter](/docs/next/features/ghostwriter)
- [Pipeline run](/docs/next/features/pipeline-run)
- [Settings](/docs/next/features/settings)
