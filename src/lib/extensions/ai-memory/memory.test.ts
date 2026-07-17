import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  formatContactMemory,
  loadContactMemory,
  MEMORY_MAX_CHARS,
  MEMORY_MAX_ENTRIES,
} from './memory'

// Chainable stub matching loadContactMemory's exact call chain:
// from().select().eq().eq().order().limit() → { data, error }.
function fakeDb(
  result: { data: unknown; error: unknown },
  spy?: (op: string, arg?: unknown) => void,
): SupabaseClient {
  const chain = {
    from: (t: string) => {
      spy?.('from', t)
      return chain
    },
    select: () => chain,
    eq: (col: string, val: unknown) => {
      spy?.('eq', { col, val })
      return chain
    },
    order: (col: string, opts: unknown) => {
      spy?.('order', { col, opts })
      return chain
    },
    limit: (n: number) => {
      spy?.('limit', n)
      return Promise.resolve(result)
    },
  }
  return chain as unknown as SupabaseClient
}

describe('formatContactMemory', () => {
  it('renders titled entries as "Title: content" and untitled as bare content', () => {
    expect(
      formatContactMemory([
        { title: 'Preferred language', content: 'Spanish' },
        { title: null, content: 'VIP since 2024' },
      ]),
    ).toEqual(['Preferred language: Spanish', 'VIP since 2024'])
  })

  it('skips entries with empty/whitespace content', () => {
    expect(
      formatContactMemory([
        { title: 'x', content: '   ' },
        { title: 'y', content: 'kept' },
      ]),
    ).toEqual(['y: kept'])
  })

  it('stops adding once the character budget would be exceeded', () => {
    const big = 'a'.repeat(MEMORY_MAX_CHARS - 10)
    const out = formatContactMemory([
      { title: null, content: big }, // fits
      { title: null, content: 'this one would overflow the budget' },
    ])
    expect(out).toEqual([big])
  })
})

describe('loadContactMemory', () => {
  it('returns [] without touching the db when contactId is null', async () => {
    let called = false
    const db = fakeDb({ data: [], error: null }, () => {
      called = true
    })
    expect(await loadContactMemory(db, 'acct', null)).toEqual([])
    expect(called).toBe(false)
  })

  it('scopes by account + contact and caps the row count', async () => {
    const ops: { op: string; arg?: unknown }[] = []
    const db = fakeDb(
      { data: [{ title: 'T', content: 'C' }], error: null },
      (op, arg) => ops.push({ op, arg }),
    )
    const out = await loadContactMemory(db, 'acct-1', 'contact-1')
    expect(out).toEqual(['T: C'])
    expect(ops).toContainEqual({ op: 'from', arg: 'ai_contact_memories' })
    expect(ops).toContainEqual({ op: 'eq', arg: { col: 'account_id', val: 'acct-1' } })
    expect(ops).toContainEqual({ op: 'eq', arg: { col: 'contact_id', val: 'contact-1' } })
    expect(ops).toContainEqual({ op: 'limit', arg: MEMORY_MAX_ENTRIES })
  })

  it('degrades to [] (never throws) when the query errors', async () => {
    const db = fakeDb({ data: null, error: { message: 'boom' } })
    expect(await loadContactMemory(db, 'acct', 'contact')).toEqual([])
  })
})
