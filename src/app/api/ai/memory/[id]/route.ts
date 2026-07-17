import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const UNIQUE_VIOLATION = '23505'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/ai/memory/[id]  (agent+)
 *
 * Update a memory entry's title and/or content. Every mutation is
 * scoped by `account_id` so an id from another tenant can't be touched.
 */
export async function PATCH(request: Request, { params }: Params) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : undefined
  const content =
    typeof body?.content === 'string' ? body.content.trim() : undefined
  if (title === undefined && content === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  if (title !== undefined && !title) {
    return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
  }
  if (content !== undefined && !content) {
    return NextResponse.json(
      { error: 'content cannot be empty' },
      { status: 400 },
    )
  }

  const update: Record<string, string> = { updated_by: ctx.userId }
  if (title !== undefined) update.title = title
  if (content !== undefined) update.content = content

  const { data, error } = await ctx.supabase
    .from('ai_contact_memories')
    .update(update)
    .eq('account_id', ctx.accountId)
    .eq('id', id)
    .select('id, title, content, source, created_at, updated_at')
    .maybeSingle()
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
    console.error('[ai/memory/[id] PATCH] error:', error)
    return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ memory: data })
}

/**
 * DELETE /api/ai/memory/[id]  (agent+)
 */
export async function DELETE(_request: Request, { params }: Params) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id } = await params
  const { error } = await ctx.supabase
    .from('ai_contact_memories')
    .delete()
    .eq('account_id', ctx.accountId)
    .eq('id', id)
  if (error) {
    console.error('[ai/memory/[id] DELETE] error:', error)
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
