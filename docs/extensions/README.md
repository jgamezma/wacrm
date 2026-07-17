# Fork extensions (SGC & IdeasLab)

Docs and specs owned by **this fork**, not by upstream `ArnasDon/wacrm`.

Keep fork-specific product docs here so merges from upstream into `docs/`
(e.g. `mcp.md`, `public-api.md`) stay clean. Prefer additive paths over
editing upstream files.

| Path | Purpose |
|------|---------|
| [`specs/`](./specs/) | Feature specs and ADRs for IdeasLab extensions |

When a fork feature needs runtime code, prefer fork-owned modules (e.g.
`src/lib/extensions/…`) and additive Supabase migrations rather than
patching upstream AI/settings files when a clean extension point exists.

## Fork-owned migrations — `9000+` band

Supabase's CLI only auto-applies `supabase/migrations/*.sql` (top level;
subfolders are ignored), so fork migrations must live there too. To keep
them from colliding with upstream's sequential numbering (`…036`, `037`,
`038`, …), number every fork migration in a **reserved `9000+` band**:

- `9001_ai_contact_memory.sql`, `9002_…`, and so on.
- Upstream keeps `03x`/`04x`; the fork keeps `90xx`. They never clash, and
  the high number sorts last so fork migrations apply after upstream's.
- Prefer **additive** changes (new tables, `ADD COLUMN IF NOT EXISTS`) over
  altering upstream tables in place; open the file with an `IdeasLab fork`
  header comment. Keep DDL idempotent (`IF NOT EXISTS`, `DROP POLICY … ;
  CREATE POLICY …`).
