import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getProvider: vi.fn(),
  embedTexts: vi.fn(),
  loadEmbeddingsKey: vi.fn(),
}));

vi.mock('./registry', () => ({ getProvider: h.getProvider }));
vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));
vi.mock('@/lib/ai/config', () => ({ loadEmbeddingsKey: h.loadEmbeddingsKey }));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}));

import { buildSearchText, syncShopCatalog, toNumericString } from './sync';
import type {
  NormalizedProduct,
  ShopCapability,
  ShopProvider,
} from './provider';

function normalizedProduct(
  overrides: Partial<NormalizedProduct> = {},
): NormalizedProduct {
  return {
    externalId: 'ext-1',
    handle: 'air-runner',
    title: 'Air Runner',
    description: 'Lightweight running shoe',
    productType: 'Sneakers',
    vendor: 'Acme',
    tags: ['running'],
    status: 'active',
    imageUrl: 'https://cdn.example.com/air.jpg',
    variants: [
      {
        externalId: 'ext-var-1',
        title: '42',
        sku: 'AIR-42',
        price: '120.00',
        currency: 'USD',
        inventoryQuantity: 7,
        inventoryTracked: true,
        available: true,
        imageUrl: null,
      },
    ],
    ...overrides,
  };
}

/**
 * A provider that is emphatically not Shopify: the orchestrator has to work
 * against the contract alone, so a second backend is a new file, not a rewrite.
 */
function fakeProvider(
  capabilities: ShopCapability[],
  products: NormalizedProduct[] = [normalizedProduct()],
) {
  const listCatalog = vi.fn(async function* () {
    for (const product of products) yield product;
  });
  const provider = {
    id: 'fakeshop',
    label: 'FakeShop',
    requiresShopDomain: false,
    capabilities: vi.fn(() => new Set(capabilities)),
    listCatalog,
  } as unknown as ShopProvider;
  return { provider, listCatalog };
}

interface Recorded {
  productUpserts: Array<Record<string, unknown>[]>;
  variantUpserts: Array<Record<string, unknown>[]>;
  deletes: Array<{ table: string; filters: Array<[string, unknown]> }>;
  connectionUpdates: Array<Record<string, unknown>>;
}

function makeDb(connection: Record<string, unknown> | null) {
  const rec: Recorded = {
    productUpserts: [],
    variantUpserts: [],
    deletes: [],
    connectionUpdates: [],
  };

  function deleteChain(table: string) {
    const filters: Array<[string, unknown]> = [];
    const self: Record<string, unknown> = {};
    for (const method of ['eq', 'lt']) {
      self[method] = (col: string, val: unknown) => {
        filters.push([col, val]);
        return self;
      };
    }
    rec.deletes.push({ table, filters });
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve);
    return self;
  }

  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: connection, error: null }),
        }),
      }),
      upsert: (rows: Record<string, unknown>[]) => {
        if (table === 'shop_products') {
          rec.productUpserts.push(rows);
          return {
            select: async () => ({
              data: rows.map((row) => ({
                id: `uuid-${row.external_id}`,
                external_id: row.external_id,
              })),
              error: null,
            }),
          };
        }
        rec.variantUpserts.push(rows);
        return Promise.resolve({ error: null });
      },
      delete: () => deleteChain(table),
      update: (payload: Record<string, unknown>) => {
        rec.connectionUpdates.push(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { db: db as unknown as SupabaseClient, rec };
}

const CONNECTION = {
  provider: 'fakeshop',
  shop_domain: null,
  access_token: 'CIPHER',
  scopes: ['catalog:read'],
};

beforeEach(() => {
  h.getProvider.mockReset();
  h.embedTexts.mockReset();
  h.loadEmbeddingsKey.mockReset().mockResolvedValue({ key: null, corrupt: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('buildSearchText', () => {
  it('blends everything a customer might name, variants included', () => {
    const text = buildSearchText(normalizedProduct());
    for (const fragment of ['Air Runner', 'Sneakers', 'Acme', 'running', '42', 'AIR-42']) {
      expect(text).toContain(fragment);
    }
  });

  it('caps the blob so one product cannot blow the row or the embed call', () => {
    const text = buildSearchText(
      normalizedProduct({ description: 'x'.repeat(10_000) }),
    );
    expect(text.length).toBeLessThanOrEqual(4000);
  });
});

describe('toNumericString', () => {
  it('passes decimals through and rejects anything Postgres would choke on', () => {
    expect(toNumericString('120.00')).toBe('120.00');
    expect(toNumericString('-3')).toBe('-3');
    expect(toNumericString('$120')).toBeNull();
    expect(toNumericString('')).toBeNull();
    expect(toNumericString(null)).toBeNull();
  });
});

describe('syncShopCatalog', () => {
  it('reports not_connected without touching a provider', async () => {
    const { db } = makeDb(null);
    const result = await syncShopCatalog(db, 'acc-1');
    expect(result).toEqual({
      ok: false,
      productCount: 0,
      inventory: false,
      error: 'not_connected',
    });
    expect(h.getProvider).not.toHaveBeenCalled();
  });

  it('stops — and records why — when the connection cannot read products', async () => {
    const { provider, listCatalog } = fakeProvider([]);
    h.getProvider.mockReturnValue(provider);
    const { db, rec } = makeDb(CONNECTION);

    const result = await syncShopCatalog(db, 'acc-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing_products_capability');
    // No retry loop into 403s: the fix is a reconnect (US-5).
    expect(listCatalog).not.toHaveBeenCalled();
    expect(rec.connectionUpdates[0]).toEqual({
      catalog_sync_error: 'missing_products_capability',
    });
  });

  it('drives whichever provider the connection names — no Shopify anywhere', async () => {
    const { provider, listCatalog } = fakeProvider(['products', 'inventory']);
    h.getProvider.mockReturnValue(provider);
    const { db, rec } = makeDb(CONNECTION);

    const result = await syncShopCatalog(db, 'acc-1');

    expect(h.getProvider).toHaveBeenCalledWith('fakeshop');
    expect(listCatalog).toHaveBeenCalledWith({
      accessToken: 'plain:CIPHER',
      shopDomain: null,
      scopes: ['catalog:read'],
    });
    expect(result).toEqual({ ok: true, productCount: 1, inventory: true });

    const [product] = rec.productUpserts[0];
    expect(product.account_id).toBe('acc-1');
    expect(product.provider).toBe('fakeshop');
    expect(product.external_id).toBe('ext-1');
    expect(product.status).toBe('active');
    expect(product.search_text).toContain('Air Runner');
    expect(product.embedding).toBeNull();

    const [variant] = rec.variantUpserts[0];
    expect(variant.product_id).toBe('uuid-ext-1');
    expect(variant.price).toBe('120.00');
    expect(variant.inventory_quantity).toBe(7);
    // Variants inherit the product photo so the send path reads one field.
    expect(variant.image_url).toBe('https://cdn.example.com/air.jpg');
  });

  it('refuses to store a stock number without the inventory capability', async () => {
    // The provider volunteered a quantity; we were not granted access to it.
    const { provider } = fakeProvider(['products']);
    h.getProvider.mockReturnValue(provider);
    const { db, rec } = makeDb(CONNECTION);

    const result = await syncShopCatalog(db, 'acc-1');

    expect(result.inventory).toBe(false);
    const [variant] = rec.variantUpserts[0];
    expect(variant.inventory_quantity).toBeNull();
    // The in-stock flag needs no inventory scope, so it survives.
    expect(variant.available).toBe(true);
  });

  it('replaces by stamp: rows this run did not touch are deleted, then it stamps', async () => {
    const { provider } = fakeProvider(['products']);
    h.getProvider.mockReturnValue(provider);
    const { db, rec } = makeDb(CONNECTION);

    await syncShopCatalog(db, 'acc-1');

    const syncedAt = rec.productUpserts[0][0].synced_at as string;
    for (const table of ['shop_products', 'shop_product_variants']) {
      const del = rec.deletes.find((d) => d.table === table);
      expect(del?.filters).toEqual([
        ['account_id', 'acc-1'],
        ['provider', 'fakeshop'],
        ['synced_at', syncedAt],
      ]);
    }
    expect(rec.connectionUpdates.at(-1)).toEqual({
      catalog_synced_at: syncedAt,
      catalog_sync_error: null,
    });
  });

  it('embeds when the account has a key, and stays lexical when embedding fails', async () => {
    h.loadEmbeddingsKey.mockResolvedValue({ key: 'sk-embed', corrupt: false });
    h.embedTexts.mockResolvedValueOnce([[0.5, 0.25]]);
    const { provider } = fakeProvider(['products']);
    h.getProvider.mockReturnValue(provider);
    const first = makeDb(CONNECTION);
    await syncShopCatalog(first.db, 'acc-1');
    expect(first.rec.productUpserts[0][0].embedding).toBe('[0.5,0.25]');

    h.embedTexts.mockRejectedValueOnce(new Error('quota'));
    const second = makeDb(CONNECTION);
    const result = await syncShopCatalog(second.db, 'acc-1');
    expect(result.ok).toBe(true);
    expect(second.rec.productUpserts[0][0].embedding).toBeNull();
  });

  it('records a provider failure and leaves the previous catalog stamped as-is', async () => {
    const provider = {
      id: 'fakeshop',
      capabilities: () => new Set<ShopCapability>(['products']),
      listCatalog: () => {
        throw new Error('FakeShop API failed (503)');
      },
    } as unknown as ShopProvider;
    h.getProvider.mockReturnValue(provider);
    const { db, rec } = makeDb(CONNECTION);

    const result = await syncShopCatalog(db, 'acc-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('FakeShop API failed (503)');
    expect(rec.deletes).toHaveLength(0);
    expect(rec.connectionUpdates).toEqual([
      { catalog_sync_error: 'FakeShop API failed (503)' },
    ]);
  });

  it('never lets a credential reach the recorded error', async () => {
    const provider = {
      id: 'fakeshop',
      capabilities: () => new Set<ShopCapability>(['products']),
      listCatalog: () => {
        throw new Error('remote refused the request');
      },
    } as unknown as ShopProvider;
    h.getProvider.mockReturnValue(provider);
    const { db, rec } = makeDb(CONNECTION);

    await syncShopCatalog(db, 'acc-1');
    const recorded = JSON.stringify(rec.connectionUpdates);
    expect(recorded).not.toContain('CIPHER');
    expect(recorded).not.toContain('plain:');
  });
});
