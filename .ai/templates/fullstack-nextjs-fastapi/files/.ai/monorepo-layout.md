# Monorepo layout — Next.js + FastAPI

This project pairs a Next.js frontend with a FastAPI backend. Read this together with
`.ai/stack-frontend-nextjs.md` and `.ai/stack-backend-fastapi.md`.

## Layout

```
.
├── apps/
│   ├── web/          # Next.js frontend (see stack-frontend-nextjs.md)
│   └── api/          # FastAPI backend (see stack-backend-fastapi.md)
├── packages/
│   └── shared-types/ # types/contracts shared across web (generated from OpenAPI)
├── infra/            # IaC, docker-compose, deploy config
├── .ai/              # AI context (this dir)
└── docker-compose.yml
```

## The contract between frontend and backend

- The **backend OpenAPI spec is the source of truth** for the API.
- Generate the frontend's API types/client from that spec — never hand-maintain them.
  Regenerate whenever the backend contract changes.
- A breaking API change requires a new version (`/api/v2`), not a silent mutation
  (see `.ai/standards/api-guidelines.md`).

## Cross-cutting conventions

- **One consistent casing across the wire.** Pick `camelCase` or `snake_case` for JSON and
  apply it on both sides; document the choice in `project-context.md`.
- **Auth:** backend issues tokens; frontend stores them in `HttpOnly` cookies. Authz enforced
  server-side per resource, never trusted from the client.
- **Errors:** shared error envelope from `api-guidelines.md`; the frontend renders the
  `error.message`, never raw server internals.

## Local development

```bash
docker compose up            # db + services
# backend
cd apps/api && uv run uvicorn app.main:app --reload
# frontend
cd apps/web && pnpm dev
```

## CI/CD

- Lint, type-check, and test each app independently; block merge on either failing.
- Deploy apps independently but keep the API contract backward-compatible during rollout
  (see `.ai/workflows/deployment.md`).
