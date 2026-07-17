-- ============================================================
-- 9002_ai_memory_autowrite.sql — AI memory auto-write (IdeasLab fork)
--
-- Fork-owned extension (spec: docs/extensions/specs/001-ai-agent-memory.md,
-- §7.2 write path). Fork-reserved 9000+ band (see 9001).
--
-- Adds the opt-in switch for the AI summarising a conversation into
-- durable contact memory when the thread ends (agent closes it, or the
-- auto-reply bot hands off). OFF by default — silent AI writes are
-- opt-in per account (spec decision: auto-write default off). Extracted
-- entries are stored with `source = 'ai_suggested'` (see 9001) so they
-- are visually distinguishable and reviewable/deletable in the UI.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS memory_autowrite_enabled boolean NOT NULL DEFAULT false;
