import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from '@/lib/ai/types'
import {
  extractMemoryFacts,
  summarizeConversationToMemory,
  MAX_EXTRACTED_FACTS,
} from './summarize'

describe('extractMemoryFacts', () => {
  it('parses a clean JSON array of facts', () => {
    expect(
      extractMemoryFacts(
        '[{"title":"Language","content":"Spanish"},{"title":"Tier","content":"VIP"}]',
      ),
    ).toEqual([
      { title: 'Language', content: 'Spanish' },
      { title: 'Tier', content: 'VIP' },
    ])
  })

  it('tolerates code fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"title":"Order","content":"#123"}]\n```\nDone.'
    expect(extractMemoryFacts(raw)).toEqual([{ title: 'Order', content: '#123' }])
  })

  it('returns [] for non-arrays, invalid JSON, or the empty array', () => {
    expect(extractMemoryFacts('nothing durable here')).toEqual([])
    expect(extractMemoryFacts('[]')).toEqual([])
    expect(extractMemoryFacts('{"title":"x","content":"y"}')).toEqual([])
    expect(extractMemoryFacts('[{"title":"x"}]')).toEqual([]) // missing content
  })

  it('caps the number of facts', () => {
    const many = JSON.stringify(
      Array.from({ length: MAX_EXTRACTED_FACTS + 5 }, (_, i) => ({
        title: `t${i}`,
        content: `c${i}`,
      })),
    )
    expect(extractMemoryFacts(many)).toHaveLength(MAX_EXTRACTED_FACTS)
  })
})

// A db that throws if touched — proves the gates short-circuit before any I/O.
const explodingDb = {
  from() {
    throw new Error('db should not be touched')
  },
} as unknown as SupabaseClient

function cfg(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    contextMessageLimit: 20,
    memoryAutowriteEnabled: true,
    ...overrides,
  }
}

describe('summarizeConversationToMemory gates', () => {
  it('is a no-op (0) when auto-write is disabled, without touching the db', async () => {
    const n = await summarizeConversationToMemory(explodingDb, {
      accountId: 'a',
      contactId: 'c',
      conversationId: 'conv',
      config: cfg({ memoryAutowriteEnabled: false }),
    })
    expect(n).toBe(0)
  })

  it('is a no-op (0) for an orphan conversation (no contact), without touching the db', async () => {
    const n = await summarizeConversationToMemory(explodingDb, {
      accountId: 'a',
      contactId: null,
      conversationId: 'conv',
      config: cfg(),
    })
    expect(n).toBe(0)
  })
})
