# Spec 002 — Shop inventory connect

| Field | Value |
|-------|--------|
| Status | **Implemented** (v1 connect-only; provider-agnostic **shop connector**, Shopify first; migration `9003_shop_connections.sql`) |
| Owner | SGC & IdeasLab (co-creation) |
| Related upstream | Settings integrations (WhatsApp config pattern), account-scoped secrets |
| Fork path | `docs/extensions/specs/` (this file) |

## 1. Problem

Operators who sell or support products tied to a Shopify catalog need a way to link
their Shopify store to the CRM. Today there is no Shopify integration — no OAuth
connect, no stored credentials, no inventory visibility.

## 2. Goals

1. **One-click connect** — Settings shows a **Connect Shopify** button that starts
   Shopify OAuth and returns the account to a connected state.
2. **Account-scoped connection** — tokens and connection status live per tenant
   (`account_id`), with RLS.
3. **Disconnect** — a clear disconnect action that revokes/clears stored tokens.
4. Implement under **fork-owned paths** so upstream merges stay low-conflict.

## 3. Non-goals (v1)

- Full product catalog sync UI or stock management inside the inbox.
- Mapping Shopify items to WhatsApp templates, deals, or broadcasts.
- Multi-Shopify-store-per-tenant (one connection per account in v1).
- Using Shopify data in the AI reply assistant (can follow once connect is stable).
- Public REST API / MCP exposure of Shopify inventory.

## 4. User stories

### US-1 — Connect with a button

**As** an account admin  
**I want** a single **Connect Shopify** button in Settings  
**So that** I can authorize inventory access without pasting app credentials by hand.

**Acceptance**

- Given I am admin+ and Shopify is not connected, when I click **Connect Shopify**,
  I am redirected to Shopify authorize and, on success, return to Settings with
  status **Connected**.
- Given Shopify app credentials are missing from server env, the button is disabled
  (or shows a clear "not configured" message) — no broken redirect.
- OAuth `state` is bound to the current account/session and rejected if mismatched.

### US-2 — See connection status

**As** an account admin  
**I want** to see whether Shopify is connected  
**So that** I know inventory can be used later without re-testing blindly.

**Acceptance**

- Settings shows Connected / Not connected (and optionally shop domain / shop name).
- Refreshing the page preserves status from the DB.

### US-3 — Disconnect

**As** an account admin  
**I want** to disconnect Shopify  
**So that** tokens are cleared from our store when we no longer need the link.

**Acceptance**

- Disconnect clears stored tokens for the account and returns UI to Not connected.
- Best-effort revoke against Shopify if supported; local clear always succeeds.

## 5. Concepts

| Term | Meaning |
|------|---------|
| **Shopify connection** | Account-scoped OAuth tokens + metadata proving the tenant linked a Shopify shop. |
| **Inventory (v1)** | Read access via Shopify APIs after connect — v1 only establishes the link; listing inventory can be a thin follow-up once tokens exist. |
| **Connect button** | Primary Settings CTA that starts the OAuth authorize URL. |

```
Settings → Integrations / Shopify
├── Not connected → [Connect Shopify] → OAuth → callback → store tokens
└── Connected     → status + [Disconnect]
```

## 6. Data model (Supabase)

Fork-owned table (additive migration in the `9000+` band):

The connector is **provider-agnostic**: one generic table records which
`provider` a row is for (`shopify` today; `woocommerce` or others later). Adding
a provider is a code change (implement `ShopProvider` + register it), not a
migration.

```sql
-- Illustrative; real migration: supabase/migrations/9003_shop_connections.sql
CREATE TABLE shop_connections (
  account_id    uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  provider      text NOT NULL,          -- 'shopify' | 'woocommerce' | …
  shop_domain   text,                   -- nullable: not all providers are domain-scoped
  display_name  text,
  -- Encrypt at rest (same pattern as WhatsApp / AI BYO keys). Holds the
  -- provider's primary credential (e.g. a Shopify offline access token, which
  -- does not expire and carries no refresh token — hence no expiry column).
  access_token  text NOT NULL,
  scopes        text[] NOT NULL DEFAULT '{}',
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  connected_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
```

**RLS**

- SELECT / DELETE: `admin`+ for the account (connection is a settings secret).
- INSERT / UPDATE: only via server routes after OAuth callback (service role or
  admin-scoped write) — never accept raw tokens from the browser.

**Env (server-only, never committed)**

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_CLIENT_ID` | Shopify app client id |
| `SHOPIFY_CLIENT_SECRET` | Shopify app client secret |
| `SHOPIFY_REDIRECT_URI` | Callback URL registered in the Shopify app settings |
| `SHOPIFY_SCOPES` | Minimal Shopify scopes for inventory read |

## 7. Runtime behaviour

### 7.1 Connect flow

1. Admin clicks **Connect Shopify**.
2. User enters (or selects) the Shopify shop domain if it is not already known.
3. `GET /api/extensions/shopify/connect` builds authorize URL with signed `state`
   (account id + nonce + shop domain), redirects to Shopify.
4. User approves scopes needed for inventory read (document exact scopes at
   implementation time; keep the set minimal).
5. `GET /api/extensions/shopify/callback` validates `state`, exchanges `code` for
   tokens, encrypts and upserts `shopify_connections`, redirects to
   `/settings?tab=shopify` (or Integrations) with success toast.

### 7.2 Status + disconnect

- `GET /api/extensions/shopify/status` → `{ connected, shop_domain?, shop_name? }`
  (never return raw tokens).
- `POST /api/extensions/shopify/disconnect` → clear row; optional Shopify revoke.

### 7.3 Token refresh

Shopify offline access tokens generally do not expire. If the app uses an online
token flow later, refresh / reauthorize handling should be added before inventory
calls depend on it.

## 8. API / UI surface (v1)

| Surface | Notes |
|---------|--------|
| Settings → Shop | Provider picker + Connect / Disconnect + status. |
| `GET /api/extensions/shop/connect?provider=&shop=` | Start OAuth (redirect). |
| `GET /api/extensions/shop/callback` | OAuth callback (shared across providers; provider id travels in the OAuth cookie). |
| `GET /api/extensions/shop/status` | Connected flag + safe metadata + configured-providers list. |
| `POST /api/extensions/shop/disconnect` | Clear connection. |

Domain code under `src/lib/extensions/shop/`: `provider.ts` (the `ShopProvider`
contract), `providers/shopify.ts` (first implementation — OAuth, HMAC, domain
validation), `registry.ts` (known/configured providers), `connection.ts`
(encrypt/decrypt persistence), `state.ts` (CSRF state). UI under
`src/components/settings/shop-connect.tsx`, wired as an additive settings section
— do not rewrite upstream WhatsApp settings.

## 9. Fork conflict strategy

| Concern | Approach |
|---------|----------|
| Specs / docs | Only under `docs/extensions/**`. |
| Schema | New `shopify_connections` table; migration `900x` with IdeasLab header. |
| App code | New modules under `src/lib/extensions/shopify/` + new API routes. |
| UI | New settings card/tab; small additive entry in settings section list. |
| Secrets | App credentials in env; user tokens encrypted in DB (same crypto helpers as AI/WhatsApp keys if reusable). |

## 10. Security & tenancy

- Every query **account-scoped**; RLS on `shopify_connections`.
- OAuth `state` must bind account + user session + shop domain; reject CSRF /
  account mix-ups.
- Validate and normalize Shopify shop domains before redirecting.
- Never log access tokens; never expose them to the client.
- Encrypt tokens at rest; restrict connect/disconnect to **admin+**.
- Minimal Shopify scopes — inventory read only for v1.

## 11. Success metrics

- Admin can connect Shopify with one button and see Connected after callback.
- Disconnect clears the connection; status reflects Not connected after reload.
- Upstream merges do not require rewriting this table or routes.

## 12. Implementation outline (when building)

1. Migration: `shopify_connections` + RLS (`900x`).
2. Env vars + Shopify app registration docs (redirect URI).
3. OAuth connect / callback / status / disconnect routes + `src/lib/extensions/shopify/`.
4. Settings UI: Connect / Disconnect button + status.
5. Tests: state validation, shop domain validation, status payload never leaks tokens,
   disconnect clears row.
6. Update this spec Status → Accepted/Implemented; note migration number in Status.

## 13. Open questions

1. **Exact Shopify scopes** for inventory v1 — likely inventory/product read scopes,
   but confirm against the selected Shopify API surface before coding inventory reads.
2. ~~**Settings placement**~~ — resolved: dedicated `?tab=shopify` section.
3. ~~**Who may connect**~~ — resolved: admin+ (`canEditSettings`), matching the
   other settings-class integrations.

## 14. Decision log

| Date | Decision |
|------|----------|
| 2026-07-16 | Spec drafted; v1 is intentionally thin — Connect / status / Disconnect only. |
| 2026-07-16 | Store under `docs/extensions/specs/`; code under `src/lib/extensions/shopify/`. |
| 2026-07-16 | Owner set to **SGC & IdeasLab (co-creation)**. |
| 2026-07-16 | Corrected integration target to Shopify. v1 remains connect-only with OAuth, account-scoped encrypted tokens, admin+ settings access, and minimal inventory-read scopes to be confirmed before inventory API work. |
| 2026-07-17 | Generalized to a **provider-agnostic shop connector** (Shopify is the first provider) so WooCommerce/others can be added without rewriting routes, DB, or UI. Renamed the generic surface to `shop`: table `shop_connections` (with a `provider` column), routes `/api/extensions/shop/*`, lib `src/lib/extensions/shop/` (`ShopProvider` contract + `registry` + `providers/shopify.ts`), settings section **Shop** with a provider picker. Shopify OAuth specifics (HMAC-verified callback, `<shop>.myshopify.com` validation, offline token) live in the Shopify provider. Spec filename kept as-is; consider renaming to `002-shop-inventory-connect.md`. |
