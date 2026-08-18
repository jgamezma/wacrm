-- ============================================================
-- 9004_shop_catalog.sql — Shop catalog as agent knowledge (SGC & IdeasLab)
--
-- Fork-owned extension (spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md).
-- Fork-reserved 9000+ band, so it never collides with upstream's sequential
-- numbering (see 9001 for the rationale).
--
-- What this adds
--   A PROVIDER-AGNOSTIC, account-scoped *cache* of the connected shop's
--   catalog, shaped so the AI reply assistant can retrieve products the same
--   way it retrieves knowledge-base excerpts (lexical FTS, plus pgvector when
--   the account has an embeddings key). The connected shop stays the source of
--   truth; these rows are rebuilt by pull-sync.
--
--   - `shop_products` / `shop_product_variants` — the cache. A row is
--     identified by (account_id, provider, external_id): Shopify GIDs,
--     WooCommerce numeric ids, etc. are all just `external_id` strings.
--   - `shop_connections.catalog_synced_at` / `catalog_sync_error` — sync
--     bookkeeping, surfaced in Settings → Shop.
--   - `ai_configs.shop_catalog_enabled` / `shop_product_images_enabled` — the
--     two agent toggles (provider-blind, same additive pattern as
--     `context_message_limit` / `memory_autowrite_enabled`).
--
-- Design notes
--   - `inventory_quantity` is NULL when unknown. Sync writes NULL whenever the
--     connection lacks the `inventory` capability, so "we have N in stock" can
--     only ever come from access we were actually granted (spec §7.2 step 4,
--     US-2). `available` (in stock yes/no) needs no inventory scope, so it can
--     be present while the quantity is NULL.
--   - `search_text` is a denormalised blob (title, description, type, vendor,
--     tags, variant titles + SKUs) built by sync; `fts` is generated from it
--     with the language-neutral 'simple' config, exactly like
--     `ai_knowledge_chunks.fts`.
--   - `status` is normalised to active | draft | archived by the provider.
--     Only `active` products are eligible for retrieval / the picker — the
--     agent must not offer something the shop is not publishing.
--   - No CHECK on `provider`: adding a backend is a code change, not a
--     migration (same choice as 9003).
--
-- RLS
--   Operational data, like contacts: SELECT for any account member (agents need
--   the product picker; the AI path reads it too). DELETE is admin+ so the
--   disconnect route can clear the cache with the caller's own client.
--   There is deliberately NO INSERT/UPDATE policy: catalog rows are written
--   ONLY by server pull-sync via the service role, never accepted from a
--   browser (spec §6 RLS, §10).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- Sync bookkeeping on the existing connection row.
-- ------------------------------------------------------------
ALTER TABLE shop_connections
  ADD COLUMN IF NOT EXISTS catalog_synced_at timestamptz,
  -- Last failure reason (short, non-secret — never a token). NULL once a sync
  -- succeeds, so the UI can show "last sync failed: …" until it is fixed.
  ADD COLUMN IF NOT EXISTS catalog_sync_error text;

-- ------------------------------------------------------------
-- Agent toggles. Default ON: a connected shop is meant to ground replies, and
-- both only ever have an effect while a shop is connected (the read path finds
-- an empty cache otherwise).
-- ------------------------------------------------------------
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS shop_catalog_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shop_product_images_enabled boolean NOT NULL DEFAULT true;

-- ------------------------------------------------------------
-- Products.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Which backend produced this row (mirrors shop_connections.provider).
  provider      text NOT NULL,
  -- The provider's own stable product id.
  external_id   text NOT NULL,
  handle        text,
  title         text NOT NULL,
  -- Plain text: sync strips provider HTML before it is ever prompted.
  description   text,
  product_type  text,
  vendor        text,
  tags          text[] NOT NULL DEFAULT '{}',
  -- Normalised by the provider: active | draft | archived.
  status        text NOT NULL,
  -- Primary image, public https. Only ever written by sync (spec §10).
  image_url     text,
  -- Denormalised retrieval blob (see header).
  search_text   text NOT NULL,
  fts           tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  -- Same dimensionality as ai_knowledge_chunks so both use one embeddings key.
  embedding     vector(1536),
  synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS shop_products_account_idx
  ON shop_products (account_id);
CREATE INDEX IF NOT EXISTS shop_products_fts_idx
  ON shop_products USING gin (fts);
-- HNSW, not IVFFlat: a catalog cache starts empty and grows, and IVFFlat needs
-- training data to be useful (same reasoning as 030).
CREATE INDEX IF NOT EXISTS shop_products_embedding_idx
  ON shop_products USING hnsw (embedding vector_cosine_ops);

ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_products_select ON shop_products;
CREATE POLICY shop_products_select ON shop_products FOR SELECT
  USING (is_account_member(account_id));

-- Admin+ delete so `disconnect` can clear the cache under the caller's client.
DROP POLICY IF EXISTS shop_products_delete ON shop_products;
CREATE POLICY shop_products_delete ON shop_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Variants (SKU / size grain).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_product_variants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  product_id          uuid NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  external_id         text NOT NULL,
  title               text,
  sku                 text,
  -- numeric, never float: this is money (see database-guidelines).
  price               numeric,
  currency            text,
  -- NULL = unknown: no inventory capability, or the provider doesn't track it.
  inventory_quantity  integer,
  inventory_tracked   boolean NOT NULL DEFAULT false,
  -- In stock yes/no. NULL = unknown. Needs no inventory scope.
  available           boolean,
  image_url           text,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS shop_product_variants_product_idx
  ON shop_product_variants (product_id);
CREATE INDEX IF NOT EXISTS shop_product_variants_account_idx
  ON shop_product_variants (account_id);

ALTER TABLE shop_product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_product_variants_select ON shop_product_variants;
CREATE POLICY shop_product_variants_select ON shop_product_variants FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shop_product_variants_delete ON shop_product_variants;
CREATE POLICY shop_product_variants_delete ON shop_product_variants FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Retrieval RPCs. Both SECURITY DEFINER and hard-scoped to the passed
-- account_id — mirrors match_ai_knowledge_* (030) — so a service-role caller
-- can only ever read one account's catalog. Draft products are excluded: the
-- agent must not offer what the shop is not publishing.
-- ============================================================

-- Lexical: full-text rank over the denormalised search blob.
-- `plainto_tsquery` turns a raw customer message into a query safely (no
-- operator injection), with the same language-neutral 'simple' config as the
-- stored column.
CREATE OR REPLACE FUNCTION public.match_shop_products_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, rank real) AS $$
  SELECT p.id,
         ts_rank(p.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM shop_products p
  WHERE p.account_id = p_account_id
    AND p.status = 'active'
    AND p.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Semantic: cosine distance against the query embedding. `p_query_embedding`
-- is text and cast inside, so PostgREST binds it unambiguously (see 030).
CREATE OR REPLACE FUNCTION public.match_shop_products_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, distance real) AS $$
  SELECT p.id,
         (p.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM shop_products p
  WHERE p.account_id = p_account_id
    AND p.status = 'active'
    AND p.embedding IS NOT NULL
  ORDER BY p.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Lock down EXECUTE (mirrors 018 / 025 / 030): SECURITY DEFINER functions must
-- not be callable by anon.
REVOKE ALL ON FUNCTION public.match_shop_products_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_shop_products_fts(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_shop_products_semantic(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_shop_products_semantic(uuid, text, integer) TO authenticated, service_role;
