 <div align="center">

<img src="docs-site/static/img/logo.svg" alt="Forsa" width="80" />

# Forsa

**One search across every board. One click to tailor your CV. One place to track it all.**

Forsa speeds up your job hunt without faking it — you still apply to every role yourself.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)

</div>

<div align="center">

| Job Search | Analytics | Pipeline Board |
|:---:|:---:|:---:|
| ![Job Search](docs-site/static/img/features/ui-home.png) | ![Analytics](docs-site/static/img/features/ui-overview.png) | ![Pipeline](docs-site/static/img/features/ui-pipeline.png) |

</div>

---

## What is Forsa?

Forsa is a **self-hosted job-search workbench** built for candidates who want speed without shortcuts. It searches 17 job boards from a single screen, scores each role against your profile with an LLM, tailors your CV per job description, checks visa-sponsorship status, and tracks every application through to offer or rejection by watching your Gmail inbox — all running locally on your machine.

It deliberately **does not auto-apply**. Automated mass-applications get flagged by recruiters and damage your chances. Forsa gives you the leverage; you keep the quality.

---

## Features

### Multi-board job search
Search 17 sources simultaneously — Adzuna, Hiring Cafe, LinkedIn (via JobSpy), Glassdoor, Indeed, Seek, Gradcracker, Brave Search, and more — from a single query. Results stream in live as each extractor finishes.

![Job search interface](docs-site/static/img/features/ui-home.png)

### LLM-powered scoring & tailoring
Every result is scored against your CV and target profile using your chosen LLM provider (OpenRouter, Gemini, OpenAI, or local Codex). One click rewrites your CV for the specific job description and exports it via Reactive Resume v5.

### Application pipeline board
Track every application through a Kanban-style board: Saved → Applied → Interview → Offer / Rejected. Outcome transitions fire analytics events so you can see your funnel over time.

![In-progress board](docs-site/static/img/features/ui-pipeline.png)

### Gmail tracking inbox
Connect your Gmail account via OAuth and Forsa watches for recruiter replies automatically, advancing applications to the correct stage without any manual entry.

### AI mock interview (video + voice)
Practice interviews grounded in the actual job description and your CV. The modal uses the Web Speech API for real-time transcription and synthesis, with your webcam feed for self-review.

### Analytics dashboard
See your application funnel, pipeline run history, and per-source discovery rates at a glance.

![Overview dashboard](docs-site/static/img/features/ui-overview.png)

### Visa sponsorship check
UK-based candidates get automatic sponsorship-status lookups for each result using the official Home Office register data.

---

## Architecture

Forsa is an **npm-workspaces monorepo** with a clear separation of concerns:

```
forsa/
├── orchestrator/        # Express API + React/Vite client + SQLite (drizzle-orm)
├── shared/              # TypeScript types, settings registry, message catalogs
├── extractors/          # 17 independent job-source scrapers (each is its own workspace)
│   ├── adzuna/
│   ├── bravesearch/
│   ├── golangjobs/
│   ├── gradcracker/
│   ├── hiringcafe/
│   ├── jobindex/
│   ├── jobspy/          # Wraps LinkedIn, Glassdoor, Indeed
│   ├── naukri/
│   ├── remoteco/
│   ├── seek/
│   ├── startupjobs/
│   ├── ukvisajobs/
│   ├── wellfound/
│   ├── weworkremotely/
│   ├── workingnomads/
│   ├── wttj/
│   └── ...
├── visa-sponsor-providers/  # UK Home Office sponsorship register
└── docs-site/               # Docusaurus documentation
```

**Runtime flow:** the orchestrator spawns extractors as subprocesses, reads their progress over a `FORSA_PROGRESS` stdout protocol, scores and tailors results via the configured LLM, and persists everything to SQLite. The React client communicates with the Express API over a typed REST layer and receives live updates via SSE.

### Design decisions (the *why*)

- **No auto-apply — by design.** Forsa never submits applications. Automated submissions get flagged by recruiters/ATS and hurt the candidate. The tool maximizes speed (search, score, tailor, draft) and leaves the actual send to the user, keeping every application authentic.

- **Extractors are isolated subprocesses, not in-process modules.** Each job source is its own workspace spawned as a child process that streams progress over a stdout protocol. This gives fault isolation (one blocked/broken scraper can't crash the run), independent dependencies per source (e.g. JobSpy needs Python), and a uniform contract for adding new sources.

- **Provider-agnostic LLM layer with per-task routing.** The LLM provider is resolved per task, not globally. Scoring (high call volume) and tailoring (heavier prompts, low volume) can run on *different* providers so they draw from independent free-tier quotas and don't starve each other. Adding a provider is a strategy + client, not a rewrite.

- **Persistent LLM response cache.** Every scoring/tailoring call is cached by a hash of (provider, model, prompt, schema) in SQLite. Free-tier LLMs are rate-limited, so the pipeline is designed to be run repeatedly and incrementally — a cache hit costs zero quota, making re-runs lossless and letting a large backlog grind through across many small runs. (Disabled under test to keep tests deterministic.)

- **Resume rendering: structured JSON → LaTeX → PDF.** The base resume is a normalized JSON document, rendered through a LaTeX template compiled by Tectonic (self-contained, auto-fetches packages — no system TeX install). The tailored CV's **language adapts to each job description** (a French posting yields a French CV), and the template is tuned to fit a complete CV on one page.

- **Settings are per-tenant and read fresh per run.** Configuration lives in SQLite keyed by tenant, not in process memory, so changes take effect on the next pipeline run without a restart and the design stays multi-user-ready.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6, TailwindCSS v4, TanStack Query, Radix UI |
| **Backend** | Node.js 22, Express, TypeScript 5 |
| **Database** | SQLite via better-sqlite3 + Drizzle ORM |
| **LLM** | OpenRouter / Gemini / OpenAI / local Codex (provider-agnostic) |
| **Testing** | Vitest (1 300+ tests across all workspaces) |
| **Linting** | Biome v2 (lint + format), Knip (dead code) |
| **CI** | GitHub Actions — lint, typecheck, tests, docs build |
| **Packaging** | npm workspaces, Docker + Docker Compose |

---

## Quick Start

**Docker (recommended):**

```bash
git clone https://github.com/dhia-rek/forsa.git
cd forsa
cp .env.example .env   # fill in the LLM provider key you want to use
docker compose up -d
```

Open `http://localhost:3005` and follow the onboarding wizard.

**Local development:**

```bash
git clone https://github.com/dhia-rek/forsa.git
cd forsa
npm ci
cp .env.example .env
npm --workspace orchestrator run db:migrate
npm --workspace orchestrator run dev
```

API server → `http://localhost:3001` · Vite dev server → `http://localhost:5173`. `dev` re-applies pending migrations on every start, so pulling schema changes never breaks a running workspace.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need. Everything is optional unless a feature you enable requires it.

| Variable | Required for | Description |
|----------|--------------|-------------|
| `MODEL` | LLM features | Model identifier (e.g. `google/gemini-3-flash-preview`). |
| `LLM_PROVIDER` | LLM features | `openrouter`, `openai`, `gemini`, `gemini_cli`, or `codex`. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Protected deployments | Enables basic auth; app is open if unset. |
| `RXRESUME_API_KEY` / `RXRESUME_URL` | Tailored resumes | Reactive Resume v5 API key and optional self-hosted URL. |
| `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` | Auto tracking | Gmail OAuth credentials for the tracking inbox. |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Adzuna source | Adzuna developer credentials. |
| `BRAVE_SEARCH_API_KEY` | Brave Search source | Brave Search API key. |
| `APIFY_TOKEN` | Seek source | Apify API token for the Seek scraper. |

See [`.env.example`](./.env.example) for the full annotated list.

---

## Documentation

Run `npm run docs:dev` and browse `http://localhost:3006`, or read the Markdown directly under `docs-site/docs/`.

Topics covered: adding a new extractor, deployment guide, settings reference, Gmail OAuth setup, Reactive Resume integration.

---

## Adding a New Extractor

Each extractor is a self-contained workspace under `extractors/` with a `manifest` (declares the source name, supported countries, and required env vars) and a `run` entrypoint (streams results via the `FORSA_PROGRESS` protocol). The full guide is in the docs: **Workflows → Add an Extractor**.

---

## Contributing

Issues and pull requests are welcome — code, docs, or new extractors. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) to get started.

---

## License

Released under the [MIT License](./LICENSE).

---

<div align="center">

Built by [Dhia Rekik](https://dhiarekik.me) · [GitHub @dhia-rek](https://github.com/dhia-rek)

</div>
