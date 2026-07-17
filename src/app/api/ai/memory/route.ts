import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'

// Postgres unique-violation SQLSTATE — surfaced when two entries collide
// on (account_id, contact_id, title). Mapped to 409 so the UI can tell
// the user to edit the existing entry instead of adding a duplicate.
const UNIQUE_VIOLATION = '23505'

/**
 * GET /api/ai/memory?contact_id=…
 *
 * List a contact's durable memory entries (any member). RLS scopes the
 * read to the caller's account.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const contactId = new URL(request.url).searchParams.get('contact_id')
    if (!contactId) {
      return NextResponse.json(
        { error: 'contact_id is required' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('ai_contact_memories')
      .select('id, title, content, source, created_at, updated_at')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[ai/memory GET] error:', error)
      return NextResponse.json(
        { error: 'Failed to load contact memory' },
        { status: 500 },
      )
    }
    return NextResponse.json({ memories: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/memory  (agent+)
 *
 * Create a durable memory entry for a contact. Body:
 * `{ contact_id, title, content }`. v1 writes are manual only
 * (`source: 'manual'`).
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const content = typeof body?.content === 'string' ? body.content.trim() : ''
  if (!contactId) {
    return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
  }
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  // Confirm the contact is in the caller's account before writing — RLS
  // scopes this read, so a foreign/nonexistent id reads as "not found"
  // and we never attach memory to another tenant's contact.
  const { data: contact } = await ctx.supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  const { data, error } = await ctx.supabase
    .from('ai_contact_memories')
    .insert({
      account_id: ctx.accountId,
      contact_id: contactId,
      title,
      content,
      source: 'manual',
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select('id, title, content, source, created_at, updated_at')
    .single()
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json(
        {
          error: 'A memory with this title already exists for this contact.',
          code: 'duplicate_title',
        },
        { status: 409 },
      )
    }
    console.error('[ai/memory POST] insert error:', error)
    return NextResponse.json({ error: 'Failed to save memory' }, { status: 500 })
  }
  return NextResponse.json({ memory: data }, { status: 201 })
}
