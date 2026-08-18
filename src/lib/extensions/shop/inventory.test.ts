import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getProvider: vi.fn() }));
vi.mock('./registry', () => ({ getProvider: h.getProvider }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain:${v}` }));

import { refreshMatchedInventory } from './inventory';
import type { CatalogProduct } from './catalog';
import type { ShopCapability, ShopProvider } from './provider';

function product(): CatalogProduct {
  return {
    id: 'prod-1',
    title: 'Air Runner',
    description: null,
    productType: null,
    vendor: null,
    imageUrl: null,
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
  };
}

function makeDb(connection: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: connection, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const CONNECTION = {
  provider: 'fakeshop',
  shop_domain: null,
  access_token: 'CIPHER',
  scopes: ['catalog:read'],
};

function fakeProvider(
  capabilities: ShopCapability[],
  refreshInventory?: ReturnType<typeof vi.fn>,
) {
  return {
    id: 'fakeshop',
    capabilities: () => new Set(capabilities),
    ...(refreshInventory ? { refreshInventory } : {}),
  } as unknown as ShopProvider;
}

beforeEach(() => {
  h.getProvider.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('refreshMatchedInventory', () => {
  it('returns the cached products untouched when nothing matched', async () => {
    const out = await refreshMatchedInventory(makeDb(CONNECTION), 'acc-1', []);
    expect(out).toEqual([]);
    expect(h.getProvider).not.toHaveBeenCalled();
  });

  it('leaves stock alone when the connection has no inventory capability', async () => {
    const refresh = vi.fn();
    h.getProvider.mockReturnValue(fakeProvider(['products'], refresh));
    const products = [product()];

    expect(await refreshMatchedInventory(makeDb(CONNECTION), 'acc-1', products)).toBe(
      products,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('leaves stock alone when the provider has no live-stock call', async () => {
    h.getProvider.mockReturnValue(fakeProvider(['products', 'inventory']));
    const products = [product()];
    expect(await refreshMatchedInventory(makeDb(CONNECTION), 'acc-1', products)).toBe(
      products,
    );
  });

  it('asks only about the matched variants and merges what comes back', async () => {
    const refresh = vi.fn().mockResolvedValue([
      { externalId: 'ext-var-1', inventoryQuantity: 0, available: false },
    ]);
    h.getProvider.mockReturnValue(fakeProvider(['products', 'inventory'], refresh));

    const out = await refreshMatchedInventory(makeDb(CONNECTION), 'acc-1', [product()]);

    expect(refresh).toHaveBeenCalledWith({
      accessToken: 'plain:CIPHER',
      shopDomain: null,
      scopes: ['catalog:read'],
      variantExternalIds: ['ext-var-1'],
    });
    expect(out[0].variants[0].inventoryQuantity).toBe(0);
    expect(out[0].variants[0].available).toBe(false);
  });

  it('keeps the cached values when the provider omits a variant or fails', async () => {
    const missing = vi.fn().mockResolvedValue([
      { externalId: 'someone-else', inventoryQuantity: 99, available: true },
    ]);
    h.getProvider.mockReturnValue(fakeProvider(['products', 'inventory'], missing));
    const kept = await refreshMatchedInventory(makeDb(CONNECTION), 'acc-1', [product()]);
    expect(kept[0].variants[0].inventoryQuantity).toBe(4);

    const failing = vi.fn().mockRejectedValue(new Error('remote 503'));
    h.getProvider.mockReturnValue(fakeProvider(['products', 'inventory'], failing));
    const products = [product()];
    const fallback = await refreshMatchedInventory(makeDb(CONNECTION), 'acc-1', products);
    expect(fallback[0].variants[0].inventoryQuantity).toBe(4);
  });

  it('degrades quietly when the caller cannot read the connection row', async () => {
    // e.g. an agent's RLS client: `shop_connections` is admin-only.
    const products = [product()];
    expect(await refreshMatchedInventory(makeDb(null), 'acc-1', products)).toBe(products);
  });
});
