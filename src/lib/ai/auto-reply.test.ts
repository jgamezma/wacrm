import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  loadShopCatalog: vi.fn(),
  sendProductCards: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendMedia: h.engineSendMedia,
}))
// Shop catalog (fork extension). `resolveCitedProducts` stays real — it is the
// guard that keeps an id the model never saw from becoming a send.
vi.mock('@/lib/extensions/shop/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/extensions/shop/agent')>()),
  loadShopCatalog: h.loadShopCatalog,
}))
vi.mock('@/lib/extensions/shop/product-send', () => ({
  sendProductCards: h.sendProductCards,
}))
vi.mock('@/lib/extensions/ai-memory/memory', () => ({
  loadContactMemory: vi.fn().mockResolvedValue([]),
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    contextMessageLimit: 20,
    memoryAutowriteEnabled: false,
    shopCatalogEnabled: true,
    shopProductImagesEnabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.loadShopCatalog.mockResolvedValue([])
  h.sendProductCards.mockReset().mockResolvedValue([])
})

// --- shop catalog (fork extension — spec 003) --------------------------------

const CATALOG_PRODUCT = {
  id: 'prod-1',
  title: 'Air Runner',
  description: null,
  productType: null,
  vendor: null,
  imageUrl: 'https://cdn.example.com/air.jpg',
  variants: [],
}

describe('dispatchInboundToAiReply — shop catalog', () => {
  it('grounds the reply in matching products and teaches the card protocol', async () => {
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    await dispatchInboundToAiReply(ARGS)

    // Live stock is refreshed here: this reply is about to reach the customer.
    expect(h.loadShopCatalog).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ catalogEnabled: true, liveInventory: true }),
    )
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Air Runner')
    expect(systemPrompt).toContain('[[PRODUCTS]]')
  })

  it('strips the trailer from the message and sends the cited cards after it', async () => {
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    h.generateReply.mockResolvedValue({
      text: 'Yes, we have it!\n\n[[PRODUCTS]]\n{"ids":["prod-1"],"with_images":true}',
      handoff: false,
    })

    await dispatchInboundToAiReply(ARGS)

    // The control phrase must never reach a customer.
    const sent = h.engineSendText.mock.calls[0][0].text as string
    expect(sent).toBe('Yes, we have it!')
    expect(sent).not.toContain('[[PRODUCTS]]')

    expect(h.sendProductCards).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [CATALOG_PRODUCT],
        withImages: true,
      }),
    )
  })

  it('honours the account image toggle even when the model asked for photos', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ shopProductImagesEnabled: false }))
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    h.generateReply.mockResolvedValue({
      text: 'Sure.\n[[PRODUCTS]]\n{"ids":["prod-1"],"with_images":true}',
      handoff: false,
    })

    await dispatchInboundToAiReply(ARGS)
    expect(h.sendProductCards).toHaveBeenCalledWith(
      expect.objectContaining({ withImages: false }),
    )
  })

  it('drops ids that were never retrieved', async () => {
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    h.generateReply.mockResolvedValue({
      text: 'Sure.\n[[PRODUCTS]]\n{"ids":["someone-elses-product"]}',
      handoff: false,
    })

    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.sendProductCards).not.toHaveBeenCalled()
  })

  it('sends the cards alone when the reply is only a card request', async () => {
    // "show me the photo" — the model answers with the product, not prose. That
    // is a real reply: the card's caption carries name, price, and stock.
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    h.generateReply.mockResolvedValue({
      text: '[[PRODUCTS]]\n{"ids":["prod-1"],"with_images":true}',
      handoff: false,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendProductCards).toHaveBeenCalledWith(
      expect.objectContaining({ products: [CATALOG_PRODUCT], withImages: true }),
    )
    // A card-only turn must not pause the thread.
    expect(h.state.updatePayload).toBeNull()
    expect(h.state.rpcCalls).toHaveLength(1)
  })

  it('still hands off when there is neither text nor a resolvable product', async () => {
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    h.generateReply.mockResolvedValue({
      text: '[[PRODUCTS]]\n{"ids":["not-a-retrieved-id"]}',
      handoff: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendProductCards).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('sends no cards when the model hands off', async () => {
    h.loadShopCatalog.mockResolvedValue([CATALOG_PRODUCT])
    h.generateReply.mockResolvedValue({
      text: '[[PRODUCTS]]\n{"ids":["prod-1"]}',
      handoff: true,
    })

    await dispatchInboundToAiReply(ARGS)
    expect(h.sendProductCards).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips the catalog entirely when the account turned it off', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ shopCatalogEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadShopCatalog).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ catalogEnabled: false }),
    )
    expect(h.sendProductCards).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})
