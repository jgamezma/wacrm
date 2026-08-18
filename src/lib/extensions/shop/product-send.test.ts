import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  engineSendMedia: vi.fn(),
  engineSendText: vi.fn(),
}));
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendMedia: h.engineSendMedia,
  engineSendText: h.engineSendText,
}));

import { sendProductCards } from './product-send';
import { PRODUCT_CARD_MAX, type CatalogProduct } from './catalog';

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'prod-1',
    title: 'Air Runner',
    description: null,
    productType: null,
    vendor: null,
    imageUrl: 'https://cdn.example.com/air.jpg',
    variants: [
      {
        id: 'var-1',
        externalId: 'ext-var-1',
        title: '42',
        sku: 'AIR-42',
        price: '120.00',
        currency: 'USD',
        inventoryQuantity: 4,
        available: true,
        imageUrl: null,
      },
    ],
    ...overrides,
  };
}

const ARGS = {
  accountId: 'acc-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
};

beforeEach(() => {
  h.engineSendMedia.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.1' });
  h.engineSendText.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.2' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sendProductCards', () => {
  it('sends an image with the caption when images are on and a photo exists', async () => {
    const results = await sendProductCards({
      ...ARGS,
      products: [product()],
      withImages: true,
    });

    expect(results).toEqual([{ productId: 'prod-1', outcome: 'image' }]);
    expect(h.engineSendText).not.toHaveBeenCalled();
    const call = h.engineSendMedia.mock.calls[0][0];
    expect(call.kind).toBe('image');
    expect(call.link).toBe('https://cdn.example.com/air.jpg');
    expect(call.caption).toContain('Air Runner');
    expect(call.caption).toContain('in stock (4)');
    // Badged like the text reply, so the inbox marks the card as AI-sent.
    expect(call.aiGenerated).toBe(true);
  });

  it('sends text when the account has images off', async () => {
    const results = await sendProductCards({
      ...ARGS,
      products: [product()],
      withImages: false,
    });
    expect(results).toEqual([{ productId: 'prod-1', outcome: 'text' }]);
    expect(h.engineSendMedia).not.toHaveBeenCalled();
    expect(h.engineSendText.mock.calls[0][0].text).toContain('Air Runner');
  });

  it('sends text when the product has no photo', async () => {
    await sendProductCards({
      ...ARGS,
      products: [product({ imageUrl: null })],
      withImages: true,
    });
    expect(h.engineSendMedia).not.toHaveBeenCalled();
    expect(h.engineSendText).toHaveBeenCalledTimes(1);
  });

  it('falls back to text with the same content when Meta cannot fetch the image', async () => {
    h.engineSendMedia.mockRejectedValue(new Error('media download error'));

    const results = await sendProductCards({
      ...ARGS,
      products: [product()],
      withImages: true,
    });

    expect(results).toEqual([{ productId: 'prod-1', outcome: 'text' }]);
    const imageCaption = h.engineSendMedia.mock.calls[0][0].caption;
    expect(h.engineSendText.mock.calls[0][0].text).toBe(imageCaption);
  });

  it('marks a card failed without throwing when both sends fail', async () => {
    h.engineSendMedia.mockRejectedValue(new Error('meta down'));
    h.engineSendText.mockRejectedValue(new Error('meta down'));

    await expect(
      sendProductCards({ ...ARGS, products: [product()], withImages: true }),
    ).resolves.toEqual([{ productId: 'prod-1', outcome: 'failed' }]);
  });

  it('keeps sending the remaining cards after one fails', async () => {
    h.engineSendMedia.mockRejectedValueOnce(new Error('bad url'));
    const results = await sendProductCards({
      ...ARGS,
      products: [product(), product({ id: 'prod-2' })],
      withImages: true,
    });
    expect(results.map((r) => r.outcome)).toEqual(['text', 'image']);
  });

  it('never sends more cards than the cap', async () => {
    const many = Array.from({ length: 10 }, (_, i) => product({ id: `prod-${i}` }));
    const results = await sendProductCards({
      ...ARGS,
      products: many,
      withImages: true,
    });
    expect(results).toHaveLength(PRODUCT_CARD_MAX);
    expect(h.engineSendMedia).toHaveBeenCalledTimes(PRODUCT_CARD_MAX);
  });

  it('marks its sends as AI-generated so the inbox badges them', async () => {
    await sendProductCards({
      ...ARGS,
      products: [product({ imageUrl: null })],
      withImages: true,
    });
    expect(h.engineSendText.mock.calls[0][0].aiGenerated).toBe(true);
  });
});
