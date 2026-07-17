# Stack: Backend — FastAPI (Python)

Concrete conventions for this stack. Read alongside `.ai/standards/`.

## Tooling

| Concern | Tool |
|---------|------|
| Runtime | Python 3.12+ |
| Framework | FastAPI |
| Server | uvicorn (gunicorn+uvicorn workers in prod) |
| Package/deps | uv (or Poetry) — pinned lockfile |
| Lint + format | ruff |
| Types | mypy (strict) — type hints on all signatures |
| Tests | pytest, pytest-asyncio, httpx, factory_boy |
| ORM | SQLAlchemy 2.x (async) |
| Migrations | Alembic |
| Validation | Pydantic v2 |

## Project layout

```
app/
  main.py            # FastAPI app factory, router wiring
  api/               # routers (thin — HTTP in/out only)
    v1/
  core/              # config, security, settings
  models/            # SQLAlchemy models
  schemas/           # Pydantic request/response models
  services/          # business logic (framework-agnostic)
  repositories/      # data access
  db/                # session, base, migrations (alembic/)
tests/
```

## Conventions

- **Layering:** routers → services → repositories. Routers never touch the DB directly.
- **Schemas ≠ models:** never return SQLAlchemy models from endpoints; map to Pydantic response
  schemas.
- **Async all the way:** async endpoints, async DB session. Don't block the event loop.
- **Dependency injection:** use FastAPI `Depends` for DB session, current user, settings.
- **Config:** Pydantic `Settings` from env; no hard-coded secrets (see security-guidelines).
- **Errors:** raise typed domain errors; map to HTTP via exception handlers. Consistent error
  envelope per `api-guidelines.md`.

## API rules

Follow `.ai/standards/api-guidelines.md`. FastAPI generates OpenAPI — keep response models and
status codes accurate so the docs stay truthful.

## Database

Follow `.ai/standards/database-guidelines.md`. All schema changes via Alembic; migrations
backward-compatible for zero-downtime deploys.

## Testing

- Unit-test services with no DB.
- Integration-test routers with `httpx.AsyncClient` against a transactional test DB.
- Every endpoint: happy path + at least one 4xx path.

## Run locally

```bash
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
uv run pytest
```
