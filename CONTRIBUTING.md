# Contributing to Boussole

Thanks for helping improve Boussole. This guide covers the contributor workflow. For setup, environment variables, and deployment, see the documentation under `docs-site/docs/`.

## What You Can Contribute

- Bug fixes and reliability improvements
- UI/UX improvements
- New extractors and integrations
- Documentation updates
- Tests and developer-experience improvements

## Local Setup

From the repository root:

```bash
npm ci
npm --workspace orchestrator run db:migrate
npm --workspace orchestrator run dev
```

For Glassdoor/Indeed/LinkedIn (python-jobspy), set up the Python venv once:

```bash
python3 -m venv extractors/jobspy/.venv
extractors/jobspy/.venv/bin/pip install -r extractors/jobspy/requirements.txt
```

Editing docs:

```bash
npm run docs:dev
```

Local URLs:

- Orchestrator UI: `http://localhost:5173`
- Orchestrator API: `http://localhost:3001`
- Docs site: `http://localhost:3006`

## Branch Naming

Branch off `main`. Use a type prefix and a short kebab-case description:

```
<type>/<short-description>
```

| Prefix | Use for |
|--------|---------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `refactor/` | Code change with no behavior change |
| `test/` | Tests only |
| `chore/` | Tooling, deps, build |

Examples: `feat/adzuna-pagination`, `fix/tracer-link-base-url`.

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <summary in imperative mood>

<optional body explaining the why>
```

Examples:

```
feat(extractors): add Naukri salary parsing
fix(orchestrator): honor BOUSSOLE_PUBLIC_BASE_URL in pipeline runs
docs: clarify Gmail OAuth setup
```

Keep the summary under ~72 characters. Explain the *why* in the body, not the *what*.

## Running the Linter (Biome)

Boussole uses [Biome](https://biomejs.org/) for linting and formatting.

```bash
# Check (CI-parity, fails on issues)
./orchestrator/node_modules/.bin/biome ci .

# Auto-format in place
./orchestrator/node_modules/.bin/biome format . --write
```

## CI-Parity Checks

Run from the repository root before opening a PR:

```bash
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

If tests fail with a `better-sqlite3` Node ABI mismatch:

```bash
npm --workspace orchestrator rebuild better-sqlite3
```

CI runs on Node 22 — verify with Node 22 if local behavior differs.

## PR Checklist

- [ ] Branch name follows the convention above
- [ ] Commits follow Conventional Commits
- [ ] PR is focused on one change or one problem
- [ ] All CI-parity checks pass locally
- [ ] User-visible changes include matching docs updates
- [ ] UI changes include a screenshot or short clip
- [ ] Server route/service changes follow [`AGENTS.md`](./AGENTS.md) standards (API contract, correlation IDs, logging, redaction, tenancy scoping)
- [ ] Tradeoffs or follow-up work are noted in the PR description

## Adding an Extractor

When adding a workspace under `extractors/`:

- Add `develop.watch` sync entries in `docker-compose.yml` if it needs live reload in container dev.
- Update the relevant `Dockerfile` stages so the extractor's `package*.json` and source are copied.
- Update `orchestrator/src/server/extractors/deployment.test.ts` so Docker/compose support is asserted.

Missing these makes the source appear in the UI but fail at runtime as "not available at runtime".
