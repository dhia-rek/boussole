<div align="center">

# Boussole

**One search across every board. One click to tailor your CV. One place to track it all.**

Boussole speeds up your job hunt without faking it — you still apply to every role yourself.

</div>

---

## What is Boussole?

Boussole is a self-hosted job-search workbench. It searches 10+ job boards from a single screen, scores each role against your profile with an LLM, rewrites your CV per job description, checks visa-sponsorship status, and tracks every application through to offer or rejection by watching your Gmail. It deliberately does **not** auto-apply — automated applications get flagged by recruiters and hurt your chances. Boussole gives you the speed; you keep the quality.

---

## Architecture

Boussole is an npm-workspaces monorepo.

| Workspace | Purpose |
|-----------|---------|
| `shared/` | Common TypeScript types, the settings registry, and shared message catalogs consumed by every other workspace. |
| `extractors/` | 17 independent job-source scrapers (Adzuna, Hiring Cafe, Gradcracker, Seek, JobSpy-backed boards, etc.). Each is its own workspace with a `manifest` and a `run` entrypoint. |
| `visa-sponsor-providers/` | Data providers for visa-sponsorship lookups (currently UK). |
| `orchestrator/` | The main application: an Express API + React/Vite client + SQLite store. Runs the search → score → tailor → export → track pipeline and spawns extractors. |
| `docs-site/` | Docusaurus documentation site. |
| `scripts/` | Build and release helpers. |

Runtime flow: the **orchestrator** spawns **extractors** as subprocesses, reads their progress over a `BOUSSOLE_PROGRESS` stdout protocol, scores and tailors results via the configured LLM provider, and persists everything to SQLite.

---

## Quick Start

```bash
git clone https://github.com/dhia-rek/boussole.git
cd boussole
docker compose up -d
```

Open `http://localhost:3005` and follow the onboarding wizard.

Developing locally without Docker:

```bash
npm ci
npm --workspace orchestrator run db:migrate
npm --workspace orchestrator run dev
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need. All variables are optional unless your chosen features require them.

| Variable | Required for | Description |
|----------|--------------|-------------|
| `MODEL` | LLM features | Model identifier (e.g. `google/gemini-3-flash-preview`). |
| `LLM_PROVIDER` | LLM features | Provider: `openrouter`, `openai`, `gemini`, `gemini_cli`, or `codex`. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Protected deployments | Enables basic auth; app is unauthenticated if unset. |
| `JWT_SECRET` / `JWT_EXPIRY_SECONDS` | Auth sessions | Session token secret (≥32 chars) and expiry. |
| `BOUSSOLE_PUBLIC_BASE_URL` | Tracer links | Public base URL used to build tracer links from background pipeline runs. |
| `RXRESUME_API_KEY` / `RXRESUME_URL` | Tailored resumes | Reactive Resume v5 API key and optional self-hosted URL. |
| `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` | Application tracking | Gmail OAuth credentials for the tracking inbox. |
| `UKVISAJOBS_EMAIL` / `UKVISAJOBS_PASSWORD` | UK Visa Jobs source | Login for automatic token refresh. |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Adzuna source | Adzuna developer credentials. |
| `APIFY_TOKEN` | Seek source | Apify API token for the Seek scraper actor. |
| `BRAVE_SEARCH_API_KEY` | Brave Search source | Brave Search API key. |

See [`.env.example`](./.env.example) for the full annotated list.

---

## Adding a New Extractor

Each extractor is a self-contained workspace under `extractors/`. The full step-by-step guide lives in the docs site under **Workflows → Add an Extractor** (`docs-site/docs/workflows/add-an-extractor.md`). Run the docs locally with:

```bash
npm run docs:dev
```

---

## Documentation

Run `npm run docs:dev` and browse `http://localhost:3006`, or read the Markdown directly under `docs-site/docs/`.

---

## Contributing

Contributions are welcome — code, docs, or new extractors. Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## License

Boussole is released under the [MIT License](./LICENSE).

---

<div align="center">

Built by [Dhia Rekik](https://dhiarekik.me) · [GitHub](https://github.com/dhia-rek/boussole)

</div>
