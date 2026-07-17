-- ============================================================
-- 9001_ai_contact_memory.sql — AI contact memory (IdeasLab fork)
--
-- Fork-owned extension (spec: docs/extensions/specs/001-ai-agent-memory.md).
-- Numbered in the fork-reserved 9000+ band so it never collides with
-- upstream's sequential migrations (…036, 037, …). Still auto-applied by
-- the Supabase CLI, which globs supabase/migrations/*.sql.
--
-- Two additive changes, designed to merge cleanly against upstream:
--
--   1. `ai_configs.context_message_limit` — how many recent text
--      messages the assistant reads when drafting / auto-replying.
--      Was a server env only (`AI_CONTEXT_MESSAGE_LIMIT`); now an
--      admin-editable per-account setting. The env var is kept as an
--      optional emergency *ceiling* (see resolveContextMessageLimit).
--      Bounded 5–100 to protect token spend on the account's BYO key.
--
--   2. `ai_contact_memories` — durable, account-scoped notes tied to a
--      contact (preferences, prior context), independent of any one
--      conversation. Injected into the prompt alongside the knowledge
--      base so the assistant carries context across conversations.
--
-- Design notes
--   - Memory is keyed by `contact_id` (+ denormalized `account_id` so
--     RLS never needs a join, mirroring `ai_knowledge_chunks`). Both
--     FKs ON DELETE CASCADE — deleting a contact (or account) drops its
--     memory.
--   - `source` records origin for audit/filtering. v1 writes are
--     'manual' only; 'ai_suggested' / 'import' reserved for later.
--   - UNIQUE NULLS NOT DISTINCT (account_id, contact_id, title) keeps
--     one entry per titled fact per contact (upsert-by-title), and
--     collapses untitled entries to a single slot.
--
-- RLS
--   Operational-data class, mirroring `contacts` / `contact_notes`
--   (NOT settings-class): any member (viewer+) may READ memory for
--   contacts they can already see; agent+ may create / update / delete.
--   The draft path runs under the RLS-scoped SSR client; the auto-reply
--   bot runs under the service-role client (a webhook has no
--   auth.uid()), which bypasses RLS — it filters by account_id +
--   contact_id itself.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Configurable conversation-context window.
-- ============================================================
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS context_message_limit integer NOT NULL DEFAULT 20
    CHECK (context_message_limit BETWEEN 5 AND 100);

-- ============================================================
-- 2. Per-contact durable memory.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_contact_memories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Short label for UI lists (e.g. "Preferred language", "Last order").
  title        text,
  -- Body injected into the prompt.
  content      text NOT NULL,
  -- Origin for audit / filtering. v1 writes 'manual' only.
  source       text NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual', 'ai_suggested', 'import')),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_contact_memories_account_contact_title
    UNIQUE NULLS NOT DISTINCT (account_id, contact_id, title)
);

CREATE INDEX IF NOT EXISTS ai_contact_memories_contact_id_idx
  ON ai_contact_memories (contact_id);

-- Load path filters account_id + contact_id and orders by updated_at
-- (most-recent-first) — this composite index covers it.
CREATE INDEX IF NOT EXISTS ai_contact_memories_account_contact_updated_idx
  ON ai_contact_memories (account_id, contact_id, updated_at DESC);

ALTER TABLE ai_contact_memories ENABLE ROW LEVEL SECURITY;

-- SELECT: any member (viewer+) can read memory for contacts they can
-- already see — same bar as reading `contacts`.
DROP POLICY IF EXISTS ai_contact_memories_select ON ai_contact_memories;
CREATE POLICY ai_contact_memories_select ON ai_contact_memories FOR SELECT
  USING (is_account_member(account_id));

-- INSERT / UPDATE / DELETE: agent+ (operational data, like `contacts`).
DROP POLICY IF EXISTS ai_contact_memories_insert ON ai_contact_memories;
CREATE POLICY ai_contact_memories_insert ON ai_contact_memories FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_contact_memories_update ON ai_contact_memories;
CREATE POLICY ai_contact_memories_update ON ai_contact_memories FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS ai_contact_memories_delete ON ai_contact_memories;
CREATE POLICY ai_contact_memories_delete ON ai_contact_memories FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- Keep updated_at fresh on every write.
CREATE OR REPLACE FUNCTION public.update_ai_contact_memories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_contact_memories_updated_at ON ai_contact_memories;
CREATE TRIGGER ai_contact_memories_updated_at
  BEFORE UPDATE ON ai_contact_memories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_contact_memories_updated_at();
