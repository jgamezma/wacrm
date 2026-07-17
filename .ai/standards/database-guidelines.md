# Database Guidelines

## Schema design

- Every table has a primary key. Prefer UUIDs (or ULIDs) for public-facing IDs.
- Use the right types: `timestamptz` for time, `numeric` for money (never float), enums for
  closed sets.
- Timestamps on every table: `created_at`, `updated_at` (`deleted_at` if soft-deleting).
- Model relationships with foreign keys and `ON DELETE` rules chosen deliberately.
- Normalize by default; denormalize only with a measured performance reason.

## Naming

- `snake_case` tables and columns. Table names plural (`users`), join tables `a_b`.
- Foreign keys: `<singular>_id` (e.g. `user_id`). Booleans: `is_`/`has_` prefix.
- Indexes: `ix_<table>_<cols>`; unique: `uq_<table>_<cols>`.

## Migrations

- **All** schema changes go through versioned migrations (Alembic / Prisma). No manual prod DDL.
- Migrations are forward-only in spirit; always provide a `down`, but never rely on it in prod.
- Make migrations backward-compatible for zero-downtime deploys:
  1. Add nullable column / new table.
  2. Backfill in a separate step.
  3. Start writing/reading.
  4. Add constraints / drop old column in a later release.
- Never edit a migration that has run in any shared environment. Add a new one.

## Queries & performance

- Index columns used in `WHERE`, `JOIN`, and `ORDER BY`. Verify with `EXPLAIN`.
- No N+1 queries — eager-load or batch. Watch ORM lazy loading.
- Paginate large result sets (keyset pagination for hot paths).
- Use transactions for multi-statement writes; keep them short.

## Safety

- Least-privilege DB credentials per service. App user is not the owner/superuser.
- Parameterized queries only — never string-interpolate user input (SQL injection).
- Back up before destructive migrations; test restores periodically.
- PII: encrypt at rest where required, and see [security-guidelines](./security-guidelines.md).
