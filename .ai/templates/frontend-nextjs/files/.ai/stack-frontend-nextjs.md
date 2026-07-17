# Stack: Frontend — Next.js (TypeScript)

Concrete conventions for this stack. Read alongside `.ai/standards/`.

## Tooling

| Concern | Tool |
|---------|------|
| Framework | Next.js (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS (or project choice) |
| State/data | Server Components + `@tanstack/react-query` for client data |
| Forms | react-hook-form + zod |
| Lint + format | eslint + prettier |
| Unit tests | vitest + Testing Library |
| E2E | Playwright |
| Package manager | pnpm |

## Project layout

```
src/
  app/               # App Router routes, layouts, server components
  components/        # reusable UI (presentational)
  features/          # feature modules (ui + hooks + logic per feature)
  lib/               # api client, utils, config
  hooks/             # shared hooks
  types/             # shared TS types
tests/               # e2e (playwright)
```

## Conventions

- **Server Components by default;** add `"use client"` only when you need interactivity/state.
- Fetch data on the server where possible; use React Query for client-side/mutations.
- Keep business logic out of components — extract to hooks/`lib`.
- Strong typing: no `any` without a justifying comment. Validate external data with zod.
- Handle all four async states: loading, empty, error, success.
- Colocate component tests; keep components presentational and testable.

## Accessibility & performance

- Semantic HTML first; ARIA only to fill gaps. Keyboard navigable, visible focus, AA contrast.
- Watch bundle size and Core Web Vitals. Use `next/image`, dynamic imports, and streaming.

## Security

- Never expose secrets to the client; only `NEXT_PUBLIC_*` vars reach the browser.
- Store auth tokens in `HttpOnly` cookies, not `localStorage`.
- Rely on framework escaping to prevent XSS; be careful with `dangerouslySetInnerHTML`.

## Run locally

```bash
pnpm install
pnpm dev
pnpm test         # vitest
pnpm test:e2e     # playwright
pnpm lint && pnpm typecheck
```
