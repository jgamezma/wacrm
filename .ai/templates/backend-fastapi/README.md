# Backend — FastAPI template

Python/FastAPI backend. Extends the [base project template](../project/README.md), so you get
all the shared standards, roles, and workflows plus FastAPI-specific conventions.

## What it adds on top of `project`

- `.ai/stack-backend-fastapi.md` — tooling, project layout, and FastAPI conventions.
- `.cursor/rules/backend.mdc` — Cursor rules scoped to Python files.

## Use it

```bash
scripts/sync-template.sh init backend-fastapi /path/to/my-api
```

This applies the base `project` template first (via `extends`), then this stack's files.

## Update later

```bash
scripts/sync-template.sh update /path/to/my-api
```

See the [top-level README](../../README.md) for the full model.
