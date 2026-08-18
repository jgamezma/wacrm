import { describe, expect, it, vi, beforeEach } from 'vitest'

// Regression cover for what the engine PERSISTS after a media send. The inbox
// renders an outbound image from the stored row, not from Meta — so a send that
// reaches WhatsApp perfectly still shows as "Photo unavailable" to the agent if
// `media_url` never made it into `messages`.

const h = vi.hoisted(() => ({
  sendMediaMessage: vi.fn(),
  inserted: null as Record<string, unknown> | null,
  conversationUpdate: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendMediaMessage: h.sendMediaMessage,
  sendTextMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain:${v}` }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'contact-1', phone: '+573001112233' },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { phone_number_id: 'pn-1', access_token: 'CIPHER' },
                error: null,
              }),
            }),
          }),
        }
      }
      // messages / conversations
      return {
        insert: (row: Record<string, unknown>) => {
          h.inserted = row
          return Promise.resolve({ error: null })
        },
        update: (payload: Record<string, unknown>) => {
          h.conversationUpdate = payload
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }),
}))

import { engineSendMedia } from './meta-send'

const ARGS = {
  accountId: 'acc-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  kind: 'image' as const,
  link: 'https://cdn.example.com/air.jpg',
  caption: 'Air Runner\n120.00 USD — in stock (4)',
}

beforeEach(() => {
  h.inserted = null
  h.conversationUpdate = null
  h.sendMediaMessage.mockReset().mockResolvedValue({ messageId: 'wamid.1' })
})

describe('engineSendMedia persistence', () => {
  it('stores the media URL so the inbox can render the image it just sent', async () => {
    await engineSendMedia(ARGS)

    expect(h.sendMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'image', link: ARGS.link }),
    )
    expect(h.inserted).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      content_type: 'image',
      content_text: ARGS.caption,
      media_url: ARGS.link,
      message_id: 'wamid.1',
      status: 'sent',
    })
  })

  it('badges an AI-sent card, and leaves deterministic flow sends unbadged', async () => {
    await engineSendMedia({ ...ARGS, aiGenerated: true })
    expect(h.inserted?.ai_generated).toBe(true)

    await engineSendMedia(ARGS)
    expect(h.inserted?.ai_generated).toBe(false)
  })

  it('previews the caption in the conversation list, falling back to the kind', async () => {
    await engineSendMedia(ARGS)
    expect(h.conversationUpdate?.last_message_text).toBe(ARGS.caption)

    await engineSendMedia({ ...ARGS, caption: undefined })
    expect(h.conversationUpdate?.last_message_text).toBe('[image]')
  })
})
