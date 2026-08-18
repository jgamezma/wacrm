import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  retrieveShopCatalog: vi.fn(),
  refreshMatchedInventory: vi.fn(),
}));
vi.mock('./catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./catalog')>()),
  retrieveShopCatalog: h.retrieveShopCatalog,
}));
vi.mock('./inventory', () => ({ refreshMatchedInventory: h.refreshMatchedInventory }));

import { loadShopCatalog, resolveCitedProducts } from './agent';
import type { CatalogProduct } from './catalog';

function product(id: string): CatalogProduct {
  return {
    id,
    title: `Product ${id}`,
    description: null,
    productType: null,
    vendor: null,
    imageUrl: null,
    variants: [],
  };
}

const db = {} as SupabaseClient;

beforeEach(() => {
  h.retrieveShopCatalog.mockReset().mockResolvedValue([product('prod-1')]);
  h.refreshMatchedInventory.mockReset().mockImplementation(async (_db, _acc, p) => p);
});

describe('loadShopCatalog', () => {
  it('does nothing at all when the account turned catalog knowledge off', async () => {
    const out = await loadShopCatalog(db, 'acc-1', {
      catalogEnabled: false,
      embeddingsApiKey: null,
      queryText: 'sneakers',
    });
    expect(out).toEqual([]);
    expect(h.retrieveShopCatalog).not.toHaveBeenCalled();
  });

  it('retrieves without a live stock call by default', async () => {
    const out = await loadShopCatalog(db, 'acc-1', {
      catalogEnabled: true,
      embeddingsApiKey: 'sk-embed',
      queryText: 'sneakers',
    });
    expect(out).toHaveLength(1);
    expect(h.retrieveShopCatalog).toHaveBeenCalledWith(db, 'acc-1', {
      embeddingsApiKey: 'sk-embed',
      queryText: 'sneakers',
    });
    expect(h.refreshMatchedInventory).not.toHaveBeenCalled();
  });

  it('tops up live stock on the send path', async () => {
    await loadShopCatalog(db, 'acc-1', {
      catalogEnabled: true,
      embeddingsApiKey: null,
      queryText: 'sneakers',
      liveInventory: true,
    });
    expect(h.refreshMatchedInventory).toHaveBeenCalled();
  });

  it('skips the stock call when nothing matched', async () => {
    h.retrieveShopCatalog.mockResolvedValue([]);
    const out = await loadShopCatalog(db, 'acc-1', {
      catalogEnabled: true,
      embeddingsApiKey: null,
      queryText: 'sneakers',
      liveInventory: true,
    });
    expect(out).toEqual([]);
    expect(h.refreshMatchedInventory).not.toHaveBeenCalled();
  });
});

describe('resolveCitedProducts', () => {
  it('resolves ids the model was actually shown, in the order it cited them', () => {
    const retrieved = [product('a'), product('b')];
    expect(resolveCitedProducts(retrieved, ['b', 'a']).map((p) => p.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('drops ids that were never retrieved — hallucinated or another tenant’s', () => {
    const retrieved = [product('a')];
    expect(resolveCitedProducts(retrieved, ['other-account-product', 'a'])).toEqual([
      retrieved[0],
    ]);
    expect(resolveCitedProducts([], ['a'])).toEqual([]);
  });
});
