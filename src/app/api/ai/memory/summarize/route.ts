import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAiConfig } from '@/lib/ai/config'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { summarizeConversationToMemory } from '@/lib/extensions/ai-memory/summarize'

/**
 * POST /api/ai/memory/summarize  (agent+)
 *
 * Body: `{ conversation_id }`. Summarise a (usually just-closed)
 * conversation into durable contact memory. No-op unless the account
 * has memory auto-write enabled. The inbox fires this fire-and-forget
 * when an agent closes a conversation.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const conversationId =
    body && typeof body.conversation_id === 'string' ? body.conversation_id : ''
  if (!conversationId) {
    return NextResponse.json(
      { error: 'conversation_id is required' },
      { status: 400 },
    )
  }

  // RLS scopes the SSR client: a foreign / missing conversation reads as
  // not-found, so we never summarise another tenant's thread.
  const { data: conversation } = await ctx.supabase
    .from('conversations')
    .select('id, contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  // Auto-write can be on even when the assistant master switch is off, so
  // load regardless of is_active; the opt-in gate lives in summarize().
  const config = await loadAiConfig(ctx.supabase, ctx.accountId, {
    requireActive: false,
  }).catch(() => null)
  if (!config || !config.memoryAutowriteEnabled) {
    return NextResponse.json({ saved: 0, skipped: 'disabled' })
  }

  // Writes go through the service-role client (the upsert bypasses RLS;
  // the payload is account-scoped). Best-effort — never throws.
  const saved = await summarizeConversationToMemory(supabaseAdmin(), {
    accountId: ctx.accountId,
    contactId: conversation.contact_id ?? null,
    conversationId,
    config,
  })
  return NextResponse.json({ saved })
}
