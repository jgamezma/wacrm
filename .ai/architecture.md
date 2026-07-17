# Architecture

> **Project-owned file.** Keep it current as the system evolves. The sync script never
> overwrites it.

## System overview

wacrm is a single **Next.js 16 (App Router)** application backed by **Supabase**. The web app
serves both the UI (React Server + Client Components) and the backend (Route Handlers under
`src/app/api`). WhatsApp is integrated via Meta's Graph API for sending and inbound webhooks.
A separate **MCP server** (`mcp-server/`) exposes the CRM to AI assistants.

```
              ┌────────────────────────── Next.js 16 app ──────────────────────────┐
 WhatsApp ───▶│  /api/webhooks/whatsapp ─▶ inbox/automations ─▶ Supabase (Postgres) │
 (Meta Graph) │  (dashboard) UI  ◀─ Realtime ─┤  Auth · Storage · RLS · pgvector    │◀── users
   ▲          │  /api/v1 (public REST, API keys)                                     │
   └── send ──┤  /api/ai  (BYO OpenAI/Anthropic, encrypted keys)                     │
              └─────────────────────────────────────────────────────────────────────┘
                        ▲
              mcp-server/ (Model Context Protocol) ── AI assistants (Claude, Cursor)
```

## Components

| Component | Responsibility | Tech |
|-----------|----------------|------|
| Web UI | Inbox, contacts, pipelines, broadcasts, automations, dashboard | Next.js App Router, React 19, Tailwind v4 |
| API (route handlers) | Server logic, webhooks, public `/api/v1` | Next.js Route Handlers under `src/app/api` |
| Domain logic | Feature logic kept out of components | `src/lib/*` (inbox, contacts, broadcast, automations, flows, ai, whatsapp, webhooks, auth, account, api-keys, storage) |
| Data | Persistence, auth, realtime, vector search | Supabase (Postgres + RLS, Auth, Storage, Realtime, pgvector) |
| WhatsApp integration | Send/receive, templates, status, registration | Meta Graph API + inbound webhooks (`src/lib/whatsapp`, `src/lib/webhooks`) |
| AI assistant | Reply drafting, auto-reply, knowledge-base retrieval | BYO OpenAI/Anthropic (`src/lib/ai`), encrypted keys |
| MCP server | Drive the CRM from AI assistants (read-only default, opt-in writes) | `mcp-server/` (Model Context Protocol) |
| i18n | Localized UI | `next-intl` (`src/i18n`, `messages/`) |

## Data model

Postgres, defined by versioned migrations in `supabase/migrations/` (upstream `001_…`→
`036_…`; fork-owned migrations use a reserved `9000+` band, e.g. `9001_…`, to avoid
collisions with upstream numbering).
Everything is **account-scoped** and protected by **Row Level Security**. Core entities:
accounts + members (sharing, invitations, presence), contacts (tags, custom fields, phone
dedup), conversations + messages + message actions, pipelines + deals, broadcasts +
recipients (wamid, incremental counts), automations + flows (+ media), message templates
(Meta integration), whatsapp_config (phone-number registration), api_keys, notifications.
AI: `ai_configs` (BYO key, `context_message_limit`), `ai_knowledge_*` (KB + pgvector),
and — fork extension — `ai_contact_memories` (durable per-contact notes injected into
the reply prompt; see `docs/extensions/specs/001-ai-agent-memory.md`).

## Key flows

1. **Inbound message:** Meta webhook → `/api/webhooks/whatsapp` → persist message →
   evaluate automations/flows → update inbox → Realtime pushes to connected agents.
2. **Outbound reply:** agent (or AI draft) sends → `src/lib/whatsapp` → Meta Graph API →
   status webhooks correlate by `wamid` → delivery/read state updated.
3. **Broadcast:** select Meta template + audience → per-recipient variable substitution →
   send in batches → track delivery/read via status webhooks (incremental counters).
4. **AI reply:** load conversation + knowledge base → hybrid retrieval (Postgres FTS, or
   pgvector when an embeddings key is set) → draft with BYO provider key.
5. **Auth / tenancy:** Supabase Auth session → account resolved → RLS scopes every query;
   `src/middleware.ts` guards routes.

## Technology choices

| Area | Choice | Why |
|------|--------|-----|
| Framework | Next.js 16 (App Router) | One app for UI + API; Server Components; streaming |
| Language | TypeScript (strict) | Safety across UI, API, and domain logic |
| Data/auth | Supabase (Postgres, Auth, Storage, Realtime, pgvector) | Batteries-included backend with RLS multi-tenancy |
| Styling | Tailwind CSS v4 | Utility-first, consistent with template |
| i18n | next-intl | Localized, self-hostable |
| Testing | Vitest (+ Testing Library) | Fast unit tests colocated with code |

## Cross-cutting concerns

- **AuthN/AuthZ:** Supabase Auth + **RLS is the security boundary**; roles owner/admin/
  agent/viewer; public API via scoped, revocable API keys. Route guarding in `middleware.ts`.
- **Multi-tenancy:** every read/write is account-scoped; never serve user data with the
  service role bypassing RLS.
- **Rate limiting:** `src/lib/rate-limit.ts` (see tests) — applied to sensitive/public paths.
- **Secrets:** env vars (`.env.local.example`); user AI keys encrypted at rest.
- **Observability / errors:** handle unhappy paths explicitly (Meta API failures, webhook
  retries, downstream timeouts); webhooks must be idempotent (dedupe by `wamid`).

## Architecture Decision Records (ADRs)

- **ADR-001** — Single Next.js app for UI + API (no separate backend service): simpler
  self-host and one deploy artifact; API lives in Route Handlers.
- **ADR-002** — Supabase RLS as the tenancy boundary: isolation enforced in the database,
  not only in app code.
- **ADR-003** — BYO, encrypted AI keys: no per-seat AI cost and customer data stays theirs.
- **ADR-004** — MCP server for AI-assistant access: read-only by default, writes opt-in.

## Known risks & tech debt

- WhatsApp Business API limits (24h window, template approval, quality rating) constrain
  messaging; broadcast logic must respect them.
- Webhook idempotency is critical — duplicate inbound events must not fragment conversations
  (see upstream fix history around duplicate conversations).
- RLS must be verified on every new table/migration; a missing policy is a tenant leak.
