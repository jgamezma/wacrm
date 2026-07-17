# Fullstack — Next.js + FastAPI template

Monorepo with a Next.js frontend (`apps/web`) and a FastAPI backend (`apps/api`).
Extends the [base project template](../project/README.md) and reuses both stack templates'
conventions.

## What it adds on top of `project`

- `.ai/stack-backend-fastapi.md` — reused from the backend template.
- `.ai/stack-frontend-nextjs.md` — reused from the frontend template.
- `.ai/monorepo-layout.md` — how the two apps fit together and share the API contract.
- `.cursor/rules/backend.mdc` and `.cursor/rules/frontend.mdc` — both, scoped by path.

> The stack docs and Cursor rules are **not duplicated** here — the sync script resolves them
> from the backend/frontend templates by path, so there is one source of truth per file.

## Use it

```bash
scripts/sync-template.sh init fullstack-nextjs-fastapi /path/to/my-app
```

## Update later

```bash
scripts/sync-template.sh update /path/to/my-app
```

See the [top-level README](../../README.md) for the full model.
