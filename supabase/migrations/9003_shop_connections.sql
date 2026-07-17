-- ============================================================
-- 9003_shop_connections.sql — Shop connector (SGC & IdeasLab)
--
-- Fork-owned extension (spec: docs/extensions/specs/002-shop-inventory-connect.md).
-- Co-creation of SGC & IdeasLab. Numbered in the fork-reserved 9000+ band so
-- it never collides with upstream's sequential migrations (…036, 037, …).
-- Still auto-applied by the Supabase CLI, which globs supabase/migrations/*.sql
-- and orders lexicographically (036… sorts before 9001…), so the fork band
-- always runs last.
--
-- What this adds
--   `shop_connections` — one account-scoped commerce-shop link per tenant. The
--   connector is PROVIDER-AGNOSTIC: `provider` records which backend the row is
--   for ('shopify' today; 'woocommerce' or others later). v1 establishes the
--   link (connect / status / disconnect); listing inventory is a thin follow-up
--   once tokens exist.
--
-- Design notes
--   - Keyed by `account_id` (PRIMARY KEY, one shop per account in v1),
--     denormalized so RLS never needs a join. FK ON DELETE CASCADE — deleting
--     an account drops its connection.
--   - `provider` is free text (no CHECK constraint) so adding a new provider is
--     a code change, not a migration. `shop_domain` is nullable because not
--     every provider is domain-scoped the way Shopify is.
--   - `access_token` is stored ENCRYPTED at rest (AES-256-GCM via
--     ENCRYPTION_KEY, the same crypto helper used for WhatsApp / AI BYO keys).
--     The column type is plain `text`; the ciphertext string lives here, never
--     plaintext. It holds the provider's primary credential (e.g. a Shopify
--     offline access token — those do not expire and carry no refresh token,
--     so there is no expiry/refresh column).
--   - `scopes` records the granted OAuth scopes for audit / future gating.
--
-- RLS
--   Settings-class, mirroring `ai_knowledge_documents` (admin+ writes) — a
--   connection is an account secret, NOT operational data. SELECT / DELETE /
--   INSERT / UPDATE are all admin+. Writes happen only through the server
--   OAuth routes after a verified callback; the browser never sends raw tokens.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS shop_connections (
  account_id    uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- Which commerce backend this row links: 'shopify' | 'woocommerce' | … .
  provider      text NOT NULL,
  -- Provider shop host where applicable, e.g. "acme.myshopify.com". Nullable —
  -- not every provider is domain-scoped.
  shop_domain   text,
  -- Human-friendly shop/store name for display in Settings.
  display_name  text,
  -- Encrypted at rest (same pattern as WhatsApp / AI BYO keys). Never plaintext.
  access_token  text NOT NULL,
  -- OAuth scopes granted at connect time (audit / future capability gating).
  scopes        text[] NOT NULL DEFAULT '{}',
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  connected_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE shop_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ only — the connection is a settings-class secret, not data
-- an agent/viewer needs to read.
DROP POLICY IF EXISTS shop_connections_select ON shop_connections;
CREATE POLICY shop_connections_select ON shop_connections FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- INSERT / UPDATE / DELETE: admin+ (settings-class, like ai_knowledge_*).
-- Written only by the server OAuth callback / disconnect routes.
DROP POLICY IF EXISTS shop_connections_insert ON shop_connections;
CREATE POLICY shop_connections_insert ON shop_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shop_connections_update ON shop_connections;
CREATE POLICY shop_connections_update ON shop_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shop_connections_delete ON shop_connections;
CREATE POLICY shop_connections_delete ON shop_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.update_shop_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shop_connections_updated_at ON shop_connections;
CREATE TRIGGER shop_connections_updated_at
  BEFORE UPDATE ON shop_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shop_connections_updated_at();
