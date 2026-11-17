# Forsa — Agent & Extractor Architecture and Engineering Standards

This document orients automated agents and contributors working in the Forsa codebase. It describes how the system is structured and the operability/privacy standards that server-side code must follow.

## System Overview

Forsa is an npm-workspaces monorepo with one runtime application (the **orchestrator**) that drives a fleet of **extractors**.

- **Orchestrator** (`orchestrator/`) — Express API + React/Vite client + SQLite. Owns the pipeline: search → score → tailor → export → track. It spawns extractors as subprocesses and persists results.
- **Extractors** (`extractors/*`) — independent job-source scrapers for a search in France (Welcome to the Jungle, company career pages, JobSpy for LinkedIn/Indeed/Glassdoor, Adzuna, Hiring Cafe, startup.jobs, Wellfound, Brave Search) plus a shared `browser-utils` helper. Each is its own workspace exposing a `manifest` (declares id, required env vars, capabilities) and a `run` entrypoint.
- **Shared** (`shared/`) — types, the settings registry, and message catalogs shared by all workspaces.

### Extractor Contract

Every extractor must:

1. Export a `manifest` describing its `id`, `requiredEnvVars`, and capabilities.
2. Expose a `run` entrypoint the orchestrator can spawn.
3. Emit progress to stdout using the `FORSA_PROGRESS ` line prefix (the orchestrator parses these lines for live progress). Gate emission behind `FORSA_EMIT_PROGRESS=1` where applicable.
4. Read configuration only from documented `FORSA_*` / source-specific environment variables.

The progress protocol is a stdout contract: the prefix string must stay identical on the emitting side (extractor) and the parsing side (`run.ts` / orchestrator). Never change one side without the other.

### Deployment Note

When adding a new extractor workspace under `extractors/`:

- Update `docker-compose.yml` `develop.watch` sync entries if it needs live reload in container dev.
- Update all relevant `Dockerfile` stages so the extractor's `package*.json` files are copied before `npm install`, and the extractor directory is copied into build/runtime images.
- Update `orchestrator/src/server/extractors/deployment.test.ts` so Docker/compose support is asserted.
- If missed, the source appears in settings/UI but fails at runtime as "not available at runtime" because the manifest is absent in the container.

---

## Server-Side Engineering Standards

Forsa uses strict operability and privacy defaults for server-side code.

### API Response Contract

For all `/api/*` routes:

- Success: `{ ok: true, data, meta?: { requestId } }`
- Error: `{ ok: false, error: { code, message, details? }, meta: { requestId } }`

Status/code mapping:

- `400 INVALID_REQUEST`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `408 REQUEST_TIMEOUT`
- `409 CONFLICT`
- `422 UNPROCESSABLE_ENTITY`
- `429 TOO_MANY_REQUESTS` (include `Retry-After`)
- `500 INTERNAL_ERROR`
- `502 UPSTREAM_ERROR`
- `503 SERVICE_UNAVAILABLE`

### Correlation IDs

- Honor inbound `x-request-id` when present; otherwise generate one.
- Always return the `x-request-id` header.
- Include the request ID in API responses (`meta.requestId`) and logs.
- Propagate context into async flows (pipeline run, per-job work) so logs include `pipelineRunId` / `jobId` when available.

### Multi-Tenancy Defaults

- Treat every server-side change as multi-tenant by default.
- Before adding or changing storage, caching, background work, API routes, SSE streams, files, or external payloads, confirm how tenant/workspace context is selected, propagated, and enforced.
- Scope database reads/writes, filesystem paths, in-memory caches, queues, locks, rate limits, and long-lived process state by tenant/workspace unless explicitly global.
- Never let module-level caches or singletons hold tenant-specific profile, settings, job, PDF, chat, or integration data unless the cache key includes the active tenant/workspace.
- Include cross-tenant regression coverage when touching shared repositories, services, auth/session handling, profile/resume flows, PDF generation, Ghostwriter/tailoring, pipeline state, or settings.

### Logging Rules

- Use the shared logger wrapper (`infra/logger.ts`) in core server paths.
- No direct `console.log` / `console.warn` / `console.error` in core paths.
- Log structured objects, not free-form dumps.
- Include context fields (`requestId`, `pipelineRunId`, `jobId`, `route`, `status`).

### SSE Standards

- Use centralized SSE helpers by default.
- Server: `orchestrator/src/server/infra/sse.ts` for setup, data writes, comments, heartbeats.
- Client (`EventSource`): `orchestrator/src/client/lib/sse.ts` for subscription/open/message/error plumbing.
- Do not duplicate raw SSE setup when these helpers apply.
- Keep feature payload types domain-local; reuse shared transport plumbing.

### Redaction and Sanitization

- Always sanitize objects before logging or returning in error `details`.
- Redact sensitive keys by default (`authorization`, `cookie`, `password`, `secret`, `token`, `apiKey`, etc.).
- Truncate large payloads and long strings.
- Never throw/log raw upstream response bodies, full webhook bodies, or large `JSON.stringify(...)` blobs.

### Webhook and LLM Payload Defaults

- Webhooks: send minimal whitelisted payloads.
- LLM prompts: send only required profile/job fields; avoid unnecessary PII.
- Document external payload behavior when adding integrations.

---

## Documentation Standards

When adding or updating user-facing docs:

- Use the feature-page structure: **What it is → Why it exists → How to use it → Common problems → Related pages**.
- Include frontmatter keys: `id`, `title`, `description`, `sidebar_position`.
- Prefer concrete, step-by-step instructions over abstract explanation.
- Include copy-pasteable examples; state defaults and constraints explicitly.
- Link related docs with `/docs/...` URLs.
- Any user-visible behavior change ships with matching docs updates.

---

## Validation

Before marking work complete, run the CI-parity checks from the repository root:

1. `./orchestrator/node_modules/.bin/biome ci .`
2. `npm run check:types:shared`
3. `npm --workspace orchestrator run check:types`
4. `npm --workspace adzuna-extractor run check:types`
5. `npm --workspace startupjobs-extractor run check:types`
6. `npm --workspace orchestrator run build:client`
7. `npm --workspace orchestrator run test:run`

If `better-sqlite3` fails with a Node ABI mismatch: `npm --workspace orchestrator rebuild better-sqlite3`.

CI runs on Node 22. For focused changes, run targeted tests first, then the full list. A change is valid only when all required checks pass without ignored failures.
