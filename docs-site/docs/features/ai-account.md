---
id: ai-account
title: AI Account (Claude or ChatGPT)
description: Each person signs in with their own Claude or ChatGPT account and picks the model Boussole uses for scoring, tailoring and the agents.
sidebar_position: 9
---

## What it is

Every AI step in Boussole runs on the AI account of the person using it. That covers scoring jobs, tailoring the CV, cover letters, Ghostwriter and the agent team. In **Settings → AI account**, each person:

- signs in with **Claude** (a Claude Pro/Max plan, or an Anthropic Console account billed per use) or **ChatGPT** (their ChatGPT plan),
- chooses which of the two Boussole uses,
- picks the model and the reasoning effort.

Boussole runs the providers' own command-line tools for this: Claude Code for Claude and Codex for ChatGPT. You sign in on Anthropic's or OpenAI's own page. Boussole never sees your password.

## Why it exists

Boussole can host several people, for example you and friends who are also looking for a job. Each workspace is private. Each person's AI work runs on their own account and is billed to their own plan, never on someone else's.

## How to use it

### Sign in with Claude

1. Open **Settings → AI account** (or the first onboarding step) and click **Sign in** on the Claude card.
2. Choose **Claude subscription** (Pro or Max) or **Anthropic Console** (pay-per-use API billing).
3. Click **Open Anthropic sign-in**. Sign in there, then copy the code the page shows.
4. Paste the code into Boussole and click **Finish**.

### Sign in with ChatGPT

1. Click **Sign in** on the ChatGPT card, then **Open OpenAI sign-in**.
2. Sign in with your ChatGPT account and type the one-time code Boussole shows (for example `ABCD-12345`).
3. Boussole finishes by itself once you approve.

The first time, OpenAI may ask you to turn on device code sign-in. That setting is in ChatGPT under **Settings → Security**.

### Choose the account and the model

- Pick which account Boussole uses. You can sign in with both and switch at any time.
- Pick the model and its effort for each provider:
  - **Claude:** Opus, Sonnet or Haiku, with an effort from `low` to `max`. The default is Opus at `medium`.
  - **ChatGPT:** the models your Codex version lists. Leave it empty to use ChatGPT's default.
- The choice is personal. Every person in the workspace list has their own.

### What the server keeps

- Each sign-in is stored by Claude Code or Codex in that workspace's private folder: `DATA_DIR/ai-accounts/<workspace>/claude` or `…/codex`. Only the server can read it.
- **Sign out** logs the tool out and deletes that folder.
- Calls run in a read-only, empty folder with no saved session. The server's own Claude or OpenAI credentials are removed from the environment, so one person's calls can never run on another person's account.
- The owner's workspace (the first account created on the server) can keep using the server's own Claude login (`claude` or `CLAUDE_CODE_OAUTH_TOKEN`). Friends' workspaces always need their own sign-in.

### Defaults and limits

| Item | Value |
| --- | --- |
| Active account | Claude |
| Claude model | `opus:medium` (or `MODEL` from the environment) |
| ChatGPT model | ChatGPT's default |
| Sign-in attempts | 10 per workspace per hour (`429` with `Retry-After` beyond that) |
| Sign-in timeout | 15 minutes |

## Common problems

### "… is not signed in for this workspace"

The chosen account isn't signed in. Sign in under **Settings → AI account**, or switch to the other account.

### ChatGPT: "Device sign-in is turned off"

Turn on device code sign-in in ChatGPT (**Settings → Security**) and start the sign-in again.

### Claude: "That code was not accepted or has expired"

Codes are single-use and short-lived. Start the sign-in again and paste the new code right away.

### "Not installed on this server"

- The Docker image includes both tools.
- For a manual install, run `npm install -g @anthropic-ai/claude-code` for Claude. Codex is installed with Boussole's dependencies.
- You can point Boussole at other copies with `CLAUDE_CLI_BIN` and `CODEX_CLI_BIN`.

### The sign-in expired

Plans and tokens expire. The account card says so. Sign in again.

## Related pages

- [Settings](/docs/features/settings)
- [AI Agents](/docs/features/ai-agents)
- [Run Boussole 24/7 on Your Server](/docs/getting-started/deploy-server)
