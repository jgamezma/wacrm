# Spec 003 — Shop catalog as agent knowledge

| Field | Value |
|-------|--------|
| Status | **Implemented** (v1; migration `9004_shop_catalog.sql`) |
| Owner | SGC & IdeasLab (co-creation) |
| Depends on | [002 — Shop inventory connect](./002-shop-inventory-connect.md) (implemented; provider-agnostic connector, tokens + `shop_connections.scopes`) |
| Related upstream | Knowledge base (030), `retrieveKnowledge`, `buildSystemPrompt`, WhatsApp media send |
| Fork path | `docs/extensions/specs/` (this file) |

This spec is **provider-agnostic**, same as 002. The connected shop (Shopify
today; WooCommerce or others later) is the source of truth. Agents, the
catalog cache, retrieval, and WhatsApp product cards never mention a
specific backend. Adding a provider is a code change (`ShopProvider` +
register it), not a new agent path or migration.

## 1. Problem

A shop is **connected** (spec 002). The account stores an encrypted credential,
the **provider id**, and the **granted scopes**. That link is unused by the AI
reply assistant and by inbox agents.

Today the assistant only sees:

1. The account **system prompt**.
2. The optional **knowledge base** (manually uploaded FAQ/docs).
3. **Contact memory** (spec 001) and recent conversation lines.

A customer asking “do you have the blue sneakers in 42?” gets a guess, a
handoff, or a stale FAQ — not the live catalog. Operators who already linked
the shop still have to paste product facts into the knowledge base by hand.

Spec 002 deferred this: *using shop data in the AI reply assistant once
connect is stable.* Connect is stable; this spec is that follow-up — for
**any** registered shop provider, not only the first one.

## 2. Goals

1. **Capability-gated access** — the generic agent path asks “can this
   connection read products / inventory?”, not “does Shopify grant
   `read_products`?”. Each provider maps its own stored `scopes` onto
   capabilities. Missing capabilities never crash a reply; they degrade.
2. **Catalog as knowledge** — retrieve **relevant** products (and their
   inventory) for the customer’s question, the same way the knowledge base
   retrieves excerpts. Do **not** dump the whole catalog into every prompt.
3. **Show matching products** — when the customer is asking for something the
   shop sells, the agent presents those products (name, price, availability).
4. **With or without image** — a product may be sent as **text only**, or as a
   WhatsApp **image + caption** when an image URL exists and images are
   enabled. No image → text fallback. Image send failure → text fallback.
5. **One catalog contract** — sync, retrieval, prompt block, and send work
   against a normalised product/variant shape. Shopify is the first
   implementation; a later provider fills the same shape.
6. Implement under **fork-owned paths** so upstream merges stay low-conflict.

## 3. Non-goals (v1)

- Managing stock, prices, or product copy **inside** the CRM (the connected
  provider remains the source of truth).
- Meta WhatsApp Commerce / product-catalog templates (those need a Meta
  catalog link; v1 sends ordinary text / image messages sourced from the
  shop catalog).
- Checkout, carts, discounts, or collecting payment on WhatsApp.
- Multi-shop-per-account (002 still: one connection per account).
- Writing back to the shop (create/update products, adjust inventory).
- Public REST API / MCP exposure of the catalog (can follow once retrieval
  and send are stable).
- Provider webhooks (product/inventory topics) — v1 is pull-sync; webhooks
  are v2 and stay inside each provider.
- Shipping a second provider in this spec. WooCommerce (or others) is a
  later `ShopProvider` + catalog methods; no change to agent/UI contracts.

## 4. User stories

### US-1 — Catalog grounds the AI like the knowledge base

**As** an account admin  
**I want** the AI agent to search the connected shop’s products when a
customer asks about what we sell  
**So that** replies use real titles, prices, and availability instead of
invented facts or a pasted FAQ.

**Acceptance**

- Given **any** registered provider is connected and catalog use is enabled,
  when a customer asks about a product that exists in the synced catalog,
  draft and auto-reply include matching product facts in the model context
  (within a size cap). The prompt does not name the provider.
- Given no shop is connected, or catalog use is disabled, generation
  behaves exactly as today (KB + memory only) — no error.
- Given the customer’s question is unrelated to products, the agent does
  **not** attach a product list.
- The agent never invents a product, price, or stock level that was not in
  the retrieved set.

### US-2 — Inventory is honest

**As** a customer talking to the AI  
**I want** to hear whether a matching item is in stock  
**So that** I am not promised something the shop cannot sell.

**Acceptance**

- Given the connection has the **inventory** capability, retrieved variants
  include a quantity (or a clear in-stock / out-of-stock flag) from the last
  successful inventory read.
- Given it does **not**, the agent still lists products when the **products**
  capability is present, but must **not** claim a numeric stock count. Copy
  may say availability is unknown, or use only the normalised product
  status (active vs draft) if that is all we have.
- Out-of-stock matches may still be shown, but the reply must say they are
  unavailable — never offer to sell them as if they were in stock.

### US-3 — Show a product with or without an image

**As** the AI auto-reply (or a human agent sending a suggestion)  
**I want** to present a matching product as text, or as a photo with a
caption  
**So that** the customer can recognise the item on WhatsApp.

**Acceptance**

- Given a match has a public image URL **and** product images are enabled,
  the outbound turn may send a WhatsApp **image** message (`sendMediaMessage`
  kind `image`) with caption = name + price + availability (caption ≤ Meta’s
  1024-char cap).
- Given the product has **no** image, or images are disabled, the same
  product is sent as **text only** (in the reply body or as a follow-up
  text). No broken media send.
- Given the image URL fails at Meta (private CDN, 404, timeout), fall back
  to text for that product; do not fail the whole reply.
- Cap attached products per turn (suggested **1–3**). Extra matches stay in
  the text (“we also have …”) or are omitted.

### US-4 — Admin controls catalog + images

**As** an account admin  
**I want** to turn catalog knowledge and product images on or off  
**So that** a newly connected shop does not start sending photos until we
are ready.

**Acceptance**

- Settings → AI (or Shop) exposes:
  - **Use shop catalog in the agent** (default **on** once a shop is
    connected; **off** when disconnected).
  - **Send product images** (default **on**, but only has effect when catalog
    use is on).
- Saving the toggles changes draft + auto-reply behaviour without a redeploy.
- Disconnecting the shop disables catalog retrieval even if the toggle is
  still on. Provider identity does not matter.

### US-5 — Capabilities are visible; reconnect if insufficient

**As** an account admin  
**I want** to see whether this connection can read products and inventory,
and reconnect if a capability is missing  
**So that** I know why stock numbers do or do not appear.

**Acceptance**

- Shop settings shows **capabilities** (Products / Inventory), derived by
  the **connected provider** from stored `scopes`. Raw scope strings may be
  shown as secondary detail; they are provider-specific and not a secret.
- If the provider now requests more access than the stored scopes grant,
  UI prompts **Reconnect** (run that provider’s OAuth / connect again).
  Local credentials are not silently assumed to have new scopes.
- API calls that need a capability we do not have are skipped; they are
  not retried as 403 loops.

### US-6 — Human agent can insert a product (same catalog)

**As** an inbox agent  
**I want** to search the synced catalog and send a product as text or as an
image  
**So that** I can answer a product question without leaving WhatsApp for
the shop admin.

**Acceptance**

- From the composer (or a Product picker), search is account-scoped against
  the synced catalog (title / SKU / type). The picker does not mention
  which provider produced the row.
- Choosing a product offers **Send as text** and **Send with image** (image
  disabled when there is no URL).
- Sending uses the existing WhatsApp send path (text or image + caption);
  the message is stored in the thread like any other outbound.

## 5. Concepts

| Term | Meaning |
|------|---------|
| **Provider** | One commerce backend (`shop_connections.provider`): `shopify` today; `woocommerce` or others later. Same `ShopProvider` registry as 002. |
| **Granted scopes** | `shop_connections.scopes` from the last successful connect. Opaque strings **owned by that provider**. |
| **Capability** | Generic flag the agent path understands: `products` \| `inventory`. Each provider maps scopes → capabilities. |
| **Catalog** | Synced, account-scoped copy of products + variants used for retrieval. The connected provider remains source of truth. |
| **Inventory** | Per-variant quantity / availability. Requires the `inventory` capability for numeric stock. |
| **Catalog knowledge** | Retrieved product excerpts injected into `buildSystemPrompt`, parallel to KB excerpts and contact memory. Provider-blind. |
| **Product card** | One outbound WhatsApp message that presents a product: either text, or image + caption. |

```
generateReply inputs (conceptual)
├── system prompt (account)
├── knowledge excerpts (account KB)          ← existing
├── contact memory (contact_id)              ← spec 001
├── catalog matches (account shop)           ← NEW (any provider)
└── recent messages (limit from config)

auto-reply / agent send
├── text reply
└── 0–N product cards (text or image+caption)
```

```
Settings → Shop (provider picker — already in 002)
        │
        ▼
  ShopProvider.listCatalog / refreshInventory
        │  normalised products + variants
        ▼
  shop_products / shop_product_variants     ← one cache, all providers
        │
        ├── retrieveShopCatalog → AI prompt / draft chips
        └── GET /products?q=     → inbox picker
```

Adding a provider later: implement `ShopProvider` (002) plus the catalog
methods in §7.1, register it. **Do not** add per-provider tables, AI
toggles, or WhatsApp send paths.

## 6. Data model (Supabase)

Fork-owned tables (additive migration in the `9000+` band, next free number
after `9003`). The connected provider remains the source of truth; these
rows are a **searchable cache** so retrieval can be KB-like (FTS / optional
pgvector) without calling the shop on every inbound.

The cache is **provider-agnostic**: `provider` + `external_id` identify a
row. Shopify GIDs, WooCommerce numeric ids, etc. are just `external_id`
strings.

```sql
-- Illustrative; real migration: supabase/migrations/9004_shop_catalog.sql

-- Capability + sync bookkeeping on the existing connection row.
ALTER TABLE shop_connections
  ADD COLUMN IF NOT EXISTS catalog_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS catalog_sync_error text;

-- Optional agent toggles (additive on ai_configs, same pattern as
-- context_message_limit / memory_autowrite_enabled). Provider-blind.
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS shop_catalog_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shop_product_images_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE shop_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider      text NOT NULL,          -- shop_connections.provider
  external_id   text NOT NULL,          -- provider's product id (stable)
  handle        text,
  title         text NOT NULL,
  description   text,                   -- plain text; strip HTML on ingest
  product_type  text,
  vendor        text,
  tags          text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL,          -- normalised: active | draft | archived
  image_url     text,                   -- primary image; public https
  search_text   text NOT NULL,          -- denormalised blob for FTS
  embedding     vector,                 -- nullable; same as KB chunks
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id)
);

CREATE TABLE shop_product_variants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  product_id          uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  external_id         text NOT NULL,
  title               text,
  sku                 text,
  price               numeric,
  currency            text,
  inventory_quantity  integer,          -- NULL = unknown (no inventory capability / not tracked)
  inventory_tracked   boolean NOT NULL DEFAULT false,
  available           boolean,          -- NULL = unknown
  image_url           text,             -- variant image, else inherit product
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id)
);

CREATE INDEX shop_products_account_idx
  ON shop_products (account_id);
CREATE INDEX shop_product_variants_product_idx
  ON shop_product_variants (product_id);
```

FTS / semantic match functions should mirror `match_ai_knowledge_fts` /
`match_ai_knowledge_semantic`: **always filter `p_account_id`**, return a
small `k`. Only **active** (published) products are eligible for agent
retrieval unless an admin override is added later.

**RLS**

- `shop_products` / `shop_product_variants`: SELECT for
  `is_account_member(account_id)` (operational data, like contacts).
  INSERT/UPDATE/DELETE only from server sync (service role or a narrow
  admin sync route) — never accept raw catalog rows from the browser.
- `ai_configs` columns: same as existing AI settings (admin+ write).

**Prompt / send budget**

- Retrieve top **k = 5** product matches (configurable later).
- Inject at most **~2k characters** of catalog text into the prompt.
- Attach at most **3** product cards per turn.

## 7. Runtime behaviour

### 7.1 Catalog contract on `ShopProvider`

Extend the existing `ShopProvider` (or a sibling the registry also
exposes) with catalog methods. Routes, sync, retrieval, and UI call **only**
this contract — they must not import `providers/shopify.ts` (or a future
WooCommerce module) directly.

```ts
type ShopCapability = 'products' | 'inventory'

interface NormalizedProduct {
  externalId: string
  handle: string | null
  title: string
  description: string | null
  productType: string | null
  vendor: string | null
  tags: string[]
  status: 'active' | 'draft' | 'archived'
  imageUrl: string | null
  variants: NormalizedVariant[]
}

interface NormalizedVariant {
  externalId: string
  title: string | null
  sku: string | null
  price: string | null
  currency: string | null
  inventoryQuantity: number | null
  inventoryTracked: boolean
  available: boolean | null
  imageUrl: string | null
}

interface ShopProvider {
  // … connect / OAuth from spec 002 …

  /** Map this provider's stored scope strings onto generic capabilities. */
  capabilities(scopes: string[]): Set<ShopCapability>

  /** Page the remote catalog into the normalised shape. Caller persists. */
  listCatalog(input: {
    accessToken: string
    shopDomain: string | null
    scopes: string[]
  }): AsyncIterable<NormalizedProduct>

  /**
   * Optional live stock refresh for a small set of variant external ids.
   * Providers without a cheap inventory API may omit this (sync-time
   * quantities stand). Never call if `inventory` capability is absent.
   */
  refreshInventory?(input: {
    accessToken: string
    shopDomain: string | null
    variantExternalIds: string[]
  }): Promise<Array<{
    externalId: string
    inventoryQuantity: number | null
    available: boolean | null
  }>>
}
```

`capabilities()` is the only place Shopify’s `read_products` /
`read_inventory` (or WooCommerce’s equivalents) appear. The rest of the
app branches on `products` / `inventory`.

### 7.2 Sync (pull)

Trigger points:

1. After a successful shop connect / reconnect (best-effort; must not fail
   the OAuth redirect).
2. Manual **Sync catalog** in Settings → Shop.
3. Periodic job (v1: on-demand is enough if a cron/worker is not already
   in the fork; if one exists, add a conservative interval, e.g. 15–60 min).

Behaviour (generic orchestrator in `sync.ts`):

1. Load connection; resolve provider from the registry; decrypt token;
   skip if disconnected.
2. If `capabilities` lacks `products` → record `catalog_sync_error`, stop.
3. Iterate `provider.listCatalog`; upsert products + variants keyed by
   `(account_id, provider, external_id)`; delete local rows for **this**
   account+provider that the remote no longer returns.
4. If `inventory` is missing, persist `inventory_quantity` as NULL even if
   the provider sent a number (do not claim stock we were not granted).
5. Rebuild `search_text`; embed when the account has an embeddings key
   (same “lexical still works if embed fails” pattern as KB ingest).
6. Set `catalog_synced_at`. Failures are logged with a reason code; tokens
   are never logged.

### 7.3 Read path (draft + auto-reply + playground)

1. Resolve `account_id`. If no `shop_connections` row, skip.
2. If `ai_configs.shop_catalog_enabled` is false, skip.
3. `retrieveShopCatalog(db, accountId, latestUserMessage, k)` — best-effort;
   never throws into draft / auto-reply (same contract as
   `retrieveKnowledge` / `loadContactMemory`). Reads the cache only;
   provider-blind.
4. Pass matches into `buildSystemPrompt` as a **Shop catalog** block,
   labelled as reference data, not instructions (injection hygiene).
5. Generate as today.

Prompt facts per match (keep short):

- `id` (internal uuid — the model must cite this to attach a card)
- title, variant title, SKU
- price + currency
- availability (in stock N / out of stock / unknown)
- one-line description
- whether an image is available (yes/no) — do **not** put raw CDN URLs in
  the prompt unless needed; the runtime owns the URL at send time

If retrieval returns nothing, omit the block (do not say “catalog empty”
to the customer unless they asked for a product).

### 7.4 Live inventory refresh (optional but preferred)

After retrieval, if the connection has `inventory` **and** the provider
implements `refreshInventory`, refresh quantity for the **matched variant
external ids only** before building the prompt / sending. If that call
fails or the method is absent, use the cached row. This keeps inbound
latency bounded while reducing “we have 4” when the shop just sold out.

### 7.5 Product-card protocol (auto-reply)

The model already has a structured control phrase (`[[HANDOFF]]`). Add a
second, similarly strict trailer so the runtime can send cards without
parsing prose:

```
<customer-facing reply text>

[[PRODUCTS]]
{"ids":["<shop_products.id>", "..."],"with_images":true}
```

Rules:

- Unknown / foreign ids are dropped (account-scoped lookup).
- `ids` length clamped to 3.
- `with_images` is ANDed with `shop_product_images_enabled` and with
  “this product has `image_url`”.
- Trailer is stripped before the text is sent to WhatsApp.
- If the model emits `[[HANDOFF]]`, do **not** send product cards.
- Auto-reply send order: text first (existing `engineSendText`), then each
  card. A failed card must not roll back the text that already landed.
- Draft mode (inbox): show suggested cards next to the draft; the human
  chooses send text / send with image / ignore. Do not auto-send images
  from draft.

### 7.6 Inbox picker (US-6)

`GET /api/extensions/shop/products?q=` — FTS over `shop_products` for the
current account. Response is safe fields only (no tokens, no provider
secrets). Send goes through the existing `/api/whatsapp/send` text or
image path.

## 8. API / UI surface (v1)

| Surface | Notes |
|---------|--------|
| Settings → Shop | Provider picker (002) + capabilities (Products / Inventory), last sync time, **Sync catalog**, reconnect hint. |
| Settings → AI | Toggles: use catalog; send product images. Disabled (with reason) when no shop is connected. Provider-blind. |
| Inbox composer | Product search + send as text / send with image. |
| Draft reply | Suggested product chips from the same retrieval as the model. |
| `POST /api/extensions/shop/catalog/sync` | Admin+; kicks a pull-sync for the **connected** provider; returns `{ ok, product_count, inventory: boolean, error? }`. |
| `GET /api/extensions/shop/products?q=` | Member+; search synced catalog. |
| `GET /api/extensions/shop/status` | Additive fields: `capabilities`, `catalog_synced_at`, optional `scopes`. Never tokens. |

Domain code under `src/lib/extensions/shop/`:

- `catalog.ts` — retrieve, format prompt block, parse `[[PRODUCTS]]`
- `sync.ts` — pull-sync orchestration against `ShopProvider`
- `provider.ts` — add catalog methods to the contract
- `providers/shopify.ts` — **first** implementation of list/refresh +
  scope→capability mapping
- `product-send.ts` — text vs image+caption, fallback

A future `providers/woocommerce.ts` (or similar) implements the same
methods and is registered in `registry.ts`. No new routes.

Minimal call-site patches: `buildSystemPrompt`, draft + auto-reply +
playground (same three places spec 001 touched). Prefer **new files** over
rewriting `generate.ts`.

WhatsApp image send already exists (`sendMediaMessage` / composer image
draft). Product images are whatever public https URL the provider synced;
Meta `link` fetch is the v1 path. If a URL is not reachable, fall back to
text.

## 9. Fork conflict strategy

| Concern | Approach |
|---------|----------|
| Specs / docs | Only under `docs/extensions/**`. |
| Schema | New `shop_products` / `shop_product_variants` with a `provider` column; additive columns on `shop_connections` + `ai_configs`. Migration `9004` with IdeasLab header. |
| App code | Extend `src/lib/extensions/shop/` (`ShopProvider` contract + registry). New providers are new files under `providers/`. |
| UI | Additive Shop status + AI toggles + inbox picker; do not rewrite upstream WhatsApp composer beyond a slot for the picker. |
| Secrets | Continue encrypting the access token; catalog rows are not secrets but stay account-scoped. |

## 10. Security & tenancy

- Every query **account-scoped**; RLS on new tables verified in migration
  review. Retrieval RPCs take `p_account_id` and must not be callable
  across tenants.
- Never log access tokens. Capability flags and scope lists are safe to show.
- Catalog text and titles are **untrusted** in the prompt (merchant or
  attacker-controlled copy in the shop). Label as reference; same injection
  hygiene as KB / customer messages.
- Image URLs: only persist http(s) URLs from **provider sync**. Do not
  fetch attacker-controlled URLs chosen by the model. The runtime looks up
  `image_url` by id after validating the id belongs to `account_id`.
- Meta will fetch the image URL. Each provider may declare allowed image
  hosts (e.g. Shopify CDN); reject non-https and obvious SSRF targets if a
  URL is ever accepted from outside sync.
- Rate-limit sync (admin+) and product search.
- **Delete catalog on disconnect** so a later connect (same account, same
  or different provider) cannot see the previous shop’s catalog. Cascade
  via `account_id` is not enough. Sync replace already deletes missing
  products for that provider; disconnect should
  `DELETE FROM shop_products WHERE account_id = …`.

## 11. Success metrics

- A customer asking for an in-catalog item gets a reply that cites the
  real product name and (when the inventory capability is present) stock,
  without that text living in the knowledge base — regardless of which
  provider is connected.
- The same question can be answered **with** a product photo or **without**,
  according to the AI toggle / human picker — and without an image when
  the product has none.
- Disconnecting the shop stops catalog grounding on the next turn; status
  shows Not connected.
- A second provider can be added by implementing `ShopProvider` catalog
  methods; agent prompt/send code does not change.
- Upstream merges do not require rewriting these tables or the shop module.

## 12. Implementation outline (when building)

1. Extend `ShopProvider` with `capabilities` / `listCatalog` /
   `refreshInventory`; implement them on Shopify first. Reconnect UX (US-5)
   driven by capabilities, not hardcoded scope names in the UI.
2. Migration `9004`: catalog tables + RLS + FTS RPC + AI toggles +
   `catalog_synced_at`.
3. Generic pull-sync + Settings **Sync catalog**.
4. `retrieveShopCatalog` + prompt block; wire draft, auto-reply, playground.
5. `[[PRODUCTS]]` parser + image/text send with fallback; cap 3.
6. Inbox product picker (US-6) on the same search API.
7. Tests: skip when disconnected; capability gating; retrieval account
   isolation; image fallback; trailer stripped; disconnect clears rows;
   prompt does not include tokens; a **fake second provider** in unit tests
   proves the orchestrator does not call Shopify.
8. Update `.ai/architecture.md` (shop catalog cache + AI prompt inputs) and
   this spec Status → Accepted/Implemented.

## 13. Open questions

1. **Sync cadence** — on-demand + connect-time only for v1, or a cron from
   day one? Prefer on-demand + connect-time if no worker exists; add
   interval once a scheduler is in the fork.
2. **Catalog subset** — should admins restrict the agent to a provider
   collection / category (e.g. a “WhatsApp” collection) so draft products
   never go out? Useful; not required to ship US-1. Default: all **active**
   products. The allow-list id is stored as opaque provider metadata, not
   a Shopify-specific column.
3. **Variant explosion** — retrieve at variant grain (SKU / size) vs
   product grain with variants nested. Prefer **variant grain** when the
   customer names a size/SKU; otherwise product + available variants in
   the excerpt.
4. **Draft auto-images** — v1 will **not** auto-send images from draft
   (human confirms). Auto-reply may send images when the toggle is on.
5. **Second-provider fit** — 002 already notes the OAuth-shaped contract is
   provisional. If a future shop uses API keys instead of OAuth, catalog
   methods still apply; only `completeConnection` changes. Confirm when
   the second provider is chosen.

## 14. First provider — Shopify (implementation notes)

Not part of the agent contract; lives entirely in
`src/lib/extensions/shop/providers/shopify.ts`.

| Generic capability | Shopify scope |
|--------------------|---------------|
| `products` | `read_products` |
| `inventory` | `read_inventory` |

Default env today is `read_products` only. v1 should set `SHOPIFY_SCOPES`
to `read_products,read_inventory` for **new** Shopify connects; existing
Shopify shops keep stored scopes until they reconnect (US-5).

Prefer Admin GraphQL (API version already pinned in the provider, 2024-10)
so products + variants + inventory can be fetched in fewer round-trips.
Confirm `inventoryQuantity` still requires `read_inventory` at
implementation time.

Image hosts to allowlist for this provider: Shopify CDN
(`cdn.shopify.com` and current equivalents). Other providers declare their
own hosts.

## 15. Decision log

| Date | Decision |
|------|----------|
| 2026-08-18 | Spec drafted now that shop connect (002) is live. v1 = capability-gated **sync + retrieve** of products/inventory as agent knowledge (KB-shaped), plus WhatsApp product cards as **text or image+caption**. No Meta Commerce catalog, no checkout, no shop writes. |
| 2026-08-18 | **Provider-agnostic**, matching 002: one catalog cache, one retrieval/send path, one `ShopProvider` catalog contract. Shopify is the first implementation (scope map in §14), not the product. A later connector is a new provider file + registry entry. |
| 2026-08-18 | Stored scopes stay provider-specific strings; the agent path only sees generic **capabilities** (`products` / `inventory`) via `provider.capabilities(scopes)`. |
| 2026-08-18 | Local catalog cache (not live-query-every-inbound) so retrieval can reuse FTS/pgvector like the knowledge base; optional live inventory refresh only for the matched ids, behind `refreshInventory?`. |
| 2026-08-18 | Human inbox picker (US-6) is in v1 because it shares the search API and is the operator’s “with or without image” control. |
| 2026-08-18 | **Implemented.** Migration `9004`; provider contract extended with `capabilities` / `listCatalog` / `refreshInventory` (Shopify via Admin GraphQL 2024-10); `sync.ts`, `catalog.ts`, `inventory.ts`, `agent.ts`, `product-send.ts`; routes `POST /catalog/sync` + `GET /products`; toggles on Settings → AI; catalog card on Settings → Shop; inbox picker + draft suggestions. |
| 2026-08-18 | The catalog prompt block is **appended fork-side** (`appendCatalogToPrompt`) instead of adding a parameter to upstream `buildSystemPrompt`. Same result, one fewer upstream file in the merge surface. |
| 2026-08-18 | The read path does **not** consult capabilities. Sync stores `inventory_quantity = NULL` whenever inventory access is absent, and disconnect clears the cache — so "the cache has rows" already means connected, and "the quantity is not null" already means the access existed. That keeps draft/auto-reply off the admin-only `shop_connections` row (agents can read the catalog, not the credential). |
| 2026-08-18 | Sync replaces by **stamp**, not delete-then-insert: rows are written with the run's `synced_at` and older rows are deleted at the end, so a mid-sync failure leaves the previous catalog intact and searchable. |
| 2026-08-18 | The inbox picker searches with ILIKE over `search_text`, not the FTS RPC: a picker is typed one letter at a time and `plainto_tsquery` won't match "nik" against "Nike". The agent path keeps the ranked FTS/pgvector RPCs. |
| 2026-08-18 | First sync runs from the OAuth callback via `after()` (spec §7.2 trigger 1), so a freshly connected shop is usable without hunting for the Sync button. On-demand + connect-time only; no scheduler in the fork yet (open question 1). |
