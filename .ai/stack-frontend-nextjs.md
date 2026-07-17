# Stack: Next.js (TypeScript) — wacrm

Concrete conventions for this stack. Read alongside `.ai/standards/`. This file is
project-owned (customized from the library's `stack-frontend-nextjs.md` to match wacrm).

> **Before writing Next.js code:** this repo runs **Next.js 16**, which has breaking changes
> vs. older versions. Read the relevant guide in `node_modules/next/dist/docs/` first and
> heed deprecation notices (see `AGENTS.md`).

## Tooling (as actually used here)

| Concern | Tool |
|---------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| UI / styling | React 19, Tailwind CSS v4, shadcn-style components (`components.json`) |
| Data / backend | Supabase (Postgres + RLS, Auth, Storage, Realtime, pgvector) |
| Client data | React Server Components + client hooks (`src/hooks`) |
| i18n | next-intl (`src/i18n`, `messages/`) |
| Lint + format | eslint (`eslint.config.mjs`) + prettier |
| Unit tests | vitest (`vitest.config.ts`) + Testing Library |
| Package manager | **npm** (`package-lock.json`) |

## Project layout

```
src/
  app/               # App Router: (auth), (dashboard), api/ route handlers, join/
    api/             # backend — route handlers, incl. webhooks and /api/v1 public API
  components/        # reusable UI (presentational)
  lib/               # domain logic per feature (inbox, contacts, broadcast, automations,
                     #   flows, ai, whatsapp, webhooks, auth, account, api-keys, storage,
                     #   supabase, rate-limit, …) — keep business logic here, not in components
  hooks/             # shared client hooks
  i18n/              # next-intl config
  types/             # shared TS types
  middleware.ts      # route guarding / auth
supabase/migrations/ # versioned SQL migrations (RLS lives here)
mcp-server/          # standalone MCP server (separate package)
messages/            # i18n message catalogs
```

## Conventions

- **Server Components by default;** add `"use client"` only when interactivity/state is needed.
- Fetch data on the server where possible; use client hooks (`src/hooks`) for client-side/realtime.
- **Keep business logic in `src/lib/<feature>`, not in components.** Colocate tests (`*.test.ts`).
- Strong typing: no `any` without a justifying comment. Validate external data (webhooks,
  API bodies) at the boundary.
- Handle all four async states: loading, empty, error, success.
- Every data access is **account-scoped**; rely on Supabase **RLS** — never bypass it with the
  service role in request paths serving user data.

## Accessibility & performance

- Semantic HTML first; ARIA only to fill gaps. Keyboard navigable, visible focus, AA contrast.
- Watch bundle size and Core Web Vitals. Use `next/image`, dynamic imports, and streaming.

## Security

- Never expose secrets to the client; only `NEXT_PUBLIC_*` vars reach the browser.
- Auth via Supabase (HttpOnly cookies) — no tokens in `localStorage`.
- User AI provider keys are stored **encrypted**; treat them as secrets end-to-end.
- Webhooks must verify signatures and be **idempotent** (dedupe by `wamid`).
- Rely on framework escaping to prevent XSS; be careful with `dangerouslySetInnerHTML`.

## Run locally

```bash
npm install
npm run dev          # next dev
npm test             # vitest run
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run format       # prettier --write .
```
