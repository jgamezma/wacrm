// ============================================================
// AI contact memory — durable per-contact notes for the reply
// assistant (IdeasLab fork extension).
//
// Spec: docs/extensions/specs/001-ai-agent-memory.md
//
// Fork-owned: lives under `src/lib/extensions/**` so upstream merges
// stay low-conflict. The only upstream touch-points are the two call
// sites that load memory (draft route + auto-reply) and the additive
// `memory` arg on `buildSystemPrompt`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Most-recently-updated entries to load for one generation. Bounds how
 * much per-contact context reaches the model.
 */
export const MEMORY_MAX_ENTRIES = 20

/**
 * Hard cap on total characters injected into the prompt. A budget, not
 * a per-entry limit — entries are added newest-first until the next one
 * would exceed it, so memory can never blow the context window (or the
 * account's token bill on their BYO key).
 */
export const MEMORY_MAX_CHARS = 4000

interface MemoryRow {
  title: string | null
  content: string
}

/**
 * Format DB rows into prompt-ready strings, newest-first, within the
 * character budget. Titled entries render as `Title: content`; untitled
 * entries as bare content. Empty/whitespace bodies are skipped.
 *
 * Pure and side-effect-free so it's unit-testable without a DB.
 */
export function formatContactMemory(rows: MemoryRow[]): string[] {
  const out: string[] = []
  let total = 0
  for (const row of rows) {
    const body = row.content?.trim()
    if (!body) continue
    const label = row.title?.trim()
    const entry = label ? `${label}: ${body}` : body
    // Stop once the budget is reached rather than truncating mid-entry —
    // a half-fact is worse than a dropped one.
    if (total + entry.length > MEMORY_MAX_CHARS) break
    out.push(entry)
    total += entry.length
  }
  return out
}

/**
 * Load a contact's durable memory as prompt-ready strings, ordered
 * most-recently-updated first and capped by `MEMORY_MAX_ENTRIES` /
 * `MEMORY_MAX_CHARS`.
 *
 * Best-effort by design (mirrors `retrieveKnowledge`): it NEVER throws
 * into the reply path — a failed memory read degrades to "no memory",
 * it must not take down a draft or an auto-reply. Returns `[]` when the
 * conversation has no linked contact (orphan thread).
 *
 * Works with any client: the RLS-scoped SSR client from the draft
 * route, or the service-role admin client from the webhook (which
 * bypasses RLS, so the `account_id` filter here is the tenancy guard).
 */
export async function loadContactMemory(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null,
): Promise<string[]> {
  if (!contactId) return []
  try {
    const { data, error } = await db
      .from('ai_contact_memories')
      .select('title, content')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false })
      .limit(MEMORY_MAX_ENTRIES)
    if (error) throw error
    return formatContactMemory((data ?? []) as MemoryRow[])
  } catch (err) {
    console.error('[ai memory] load failed:', err)
    return []
  }
}
