import crypto from 'crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthorizeUrl,
  buildCatalogQuery,
  isValidShopDomain,
  listShopifyCatalog,
  normalizeShopDomain,
  refreshShopifyInventory,
  safeImageUrl,
  shopifyCapabilities,
  shopifyProvider,
  toNormalizedProduct,
  verifyCallbackHmac,
} from './shopify';

const ENV = {
  SHOPIFY_CLIENT_ID: 'key-abc',
  SHOPIFY_CLIENT_SECRET: 'secret-xyz',
  SHOPIFY_REDIRECT_URI: 'https://crm.example.com/api/extensions/shop/callback',
};

function stubEnv() {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('normalizeShopDomain', () => {
  it('accepts a bare handle and appends the myshopify suffix', () => {
    expect(normalizeShopDomain('acme')).toBe('acme.myshopify.com');
  });

  it('accepts a full host / pasted URL, lowercasing and stripping path + port', () => {
    expect(normalizeShopDomain('Acme.myshopify.com')).toBe('acme.myshopify.com');
    expect(normalizeShopDomain('https://acme.myshopify.com/admin/products')).toBe(
      'acme.myshopify.com',
    );
    expect(normalizeShopDomain('acme.myshopify.com:443')).toBe('acme.myshopify.com');
    expect(normalizeShopDomain('acme.myshopify.com/../../etc')).toBe(
      'acme.myshopify.com',
    );
  });

  it.each([
    '',
    '   ',
    'evil.com',
    'acme.myshopify.com.evil.com',
    'acme.example.myshopify.com',
    'http://attacker.internal',
  ])('rejects invalid or spoofed input: %j', (bad) => {
    expect(normalizeShopDomain(bad)).toBeNull();
  });
});

describe('isValidShopDomain', () => {
  it('validates canonical hosts only', () => {
    expect(isValidShopDomain('acme.myshopify.com')).toBe(true);
    expect(isValidShopDomain('acme.example.com')).toBe(false);
    expect(isValidShopDomain('ACME.myshopify.com')).toBe(false);
  });
});

describe('buildAuthorizeUrl', () => {
  const env = {
    clientId: ENV.SHOPIFY_CLIENT_ID,
    clientSecret: ENV.SHOPIFY_CLIENT_SECRET,
    redirectUri: ENV.SHOPIFY_REDIRECT_URI,
    scopes: 'read_products',
  };

  it('targets the shop host with the required params (offline token)', () => {
    const url = new URL(buildAuthorizeUrl(env, 'acme.myshopify.com', 'st4te'));
    expect(url.origin).toBe('https://acme.myshopify.com');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    const p = url.searchParams;
    expect(p.get('client_id')).toBe(env.clientId);
    expect(p.get('scope')).toBe('read_products');
    expect(p.get('redirect_uri')).toBe(env.redirectUri);
    expect(p.get('state')).toBe('st4te');
    expect(url.search).not.toContain('grant_options');
  });

  it('never leaks the client secret into the URL', () => {
    const url = buildAuthorizeUrl(env, 'acme.myshopify.com', 's');
    expect(url).not.toContain(env.clientSecret);
  });
});

describe('verifyCallbackHmac', () => {
  function sign(params: Record<string, string>, secret: string): string {
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  }

  const params = {
    code: 'abc123',
    shop: 'acme.myshopify.com',
    state: 'st4te',
    timestamp: '1700000000',
  };

  it('accepts a genuine signature', () => {
    const hmac = sign(params, ENV.SHOPIFY_CLIENT_SECRET);
    expect(verifyCallbackHmac({ ...params, hmac }, ENV.SHOPIFY_CLIENT_SECRET)).toBe(true);
  });

  it('rejects a tampered param', () => {
    const hmac = sign(params, ENV.SHOPIFY_CLIENT_SECRET);
    expect(
      verifyCallbackHmac(
        { ...params, shop: 'evil.myshopify.com', hmac },
        ENV.SHOPIFY_CLIENT_SECRET,
      ),
    ).toBe(false);
  });

  it('rejects the wrong secret and a missing hmac', () => {
    const hmac = sign(params, 'nope');
    expect(verifyCallbackHmac({ ...params, hmac }, ENV.SHOPIFY_CLIENT_SECRET)).toBe(false);
    expect(verifyCallbackHmac({ code: 'x' }, ENV.SHOPIFY_CLIENT_SECRET)).toBe(false);
  });
});

describe('shopifyProvider (ShopProvider contract)', () => {
  it('exposes stable id/label and requires a shop domain', () => {
    expect(shopifyProvider.id).toBe('shopify');
    expect(shopifyProvider.label).toBe('Shopify');
    expect(shopifyProvider.requiresShopDomain).toBe(true);
  });

  it('isConfigured reflects env presence', () => {
    expect(shopifyProvider.isConfigured()).toBe(false);
    stubEnv();
    expect(shopifyProvider.isConfigured()).toBe(true);
  });

  it('buildAuthorizeUrl throws on an invalid domain and works on a valid one', () => {
    stubEnv();
    expect(() =>
      shopifyProvider.buildAuthorizeUrl({ state: 's', shopDomain: 'evil.com' }),
    ).toThrow();
    const url = shopifyProvider.buildAuthorizeUrl({
      state: 's',
      shopDomain: 'acme.myshopify.com',
    });
    expect(url.startsWith('https://acme.myshopify.com/admin/oauth/authorize')).toBe(true);
  });

  it('verifyCallback returns false when unconfigured', () => {
    expect(shopifyProvider.verifyCallback({ hmac: 'x' })).toBe(false);
  });
});

// --- catalog (spec 003) ------------------------------------------------------

const CTX = {
  accessToken: 'shpat_token',
  shopDomain: 'acme.myshopify.com',
  scopes: ['read_products', 'read_inventory'],
};

/** Stub `fetch` with one GraphQL body per call, in order. */
function stubGraphQL(...bodies: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function productEdge(id: string, overrides: Record<string, unknown> = {}) {
  return {
    node: {
      id,
      handle: 'air-runner',
      title: 'Air Runner',
      description: 'Lightweight',
      productType: 'Sneakers',
      vendor: 'Acme',
      tags: ['running'],
      status: 'ACTIVE',
      featuredImage: { url: 'https://cdn.shopify.com/air.jpg' },
      variants: {
        edges: [
          {
            node: {
              id: `${id}/v1`,
              title: '42',
              sku: 'AIR-42',
              price: '120.00',
              availableForSale: true,
              inventoryQuantity: 7,
              inventoryItem: { tracked: true },
              image: null,
            },
          },
        ],
      },
      ...overrides,
    },
  };
}

describe('shopifyCapabilities', () => {
  it('maps Shopify scope names onto the generic capabilities', () => {
    expect([...shopifyCapabilities(['read_products'])]).toEqual(['products']);
    expect([...shopifyCapabilities(['read_inventory'])]).toEqual(['inventory']);
    // write_* implies read_* in Shopify's model.
    expect([...shopifyCapabilities(['write_products'])]).toEqual(['products']);
    expect(shopifyCapabilities(['read_orders', 'nonsense']).size).toBe(0);
  });

  it('is tolerant of casing and stray whitespace in stored scopes', () => {
    expect(shopifyCapabilities([' READ_PRODUCTS ']).has('products')).toBe(true);
  });
});

describe('buildCatalogQuery', () => {
  it('asks for stock only when inventory access was granted', () => {
    // Requesting inventoryQuantity without read_inventory makes Shopify reject
    // the whole query — a products-only connection must not ask at all.
    expect(buildCatalogQuery(true)).toContain('inventoryQuantity');
    expect(buildCatalogQuery(false)).not.toContain('inventoryQuantity');
    expect(buildCatalogQuery(false)).toContain('availableForSale');
  });
});

describe('safeImageUrl', () => {
  it('keeps https URLs and drops everything else', () => {
    expect(safeImageUrl('https://cdn.shopify.com/a.jpg')).toBe(
      'https://cdn.shopify.com/a.jpg',
    );
    expect(safeImageUrl('http://cdn.shopify.com/a.jpg')).toBeNull();
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageUrl('not a url')).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });
});

describe('toNormalizedProduct', () => {
  it('maps a product and its variants onto the normalised shape', () => {
    const product = toNormalizedProduct(productEdge('gid://p/1').node, 'USD');
    expect(product.externalId).toBe('gid://p/1');
    expect(product.status).toBe('active');
    expect(product.imageUrl).toBe('https://cdn.shopify.com/air.jpg');
    expect(product.variants[0]).toEqual({
      externalId: 'gid://p/1/v1',
      title: '42',
      sku: 'AIR-42',
      price: '120.00',
      currency: 'USD',
      inventoryQuantity: 7,
      inventoryTracked: true,
      available: true,
      // Variant has no image of its own; the sync layer inherits the product's.
      imageUrl: null,
    });
  });

  it('treats an absent quantity as unknown, never as zero', () => {
    const node = productEdge('gid://p/1').node;
    // What a products-only connection gets back: the field was never requested.
    delete (node.variants.edges[0].node as Record<string, unknown>).inventoryQuantity;
    const product = toNormalizedProduct(node, 'USD');
    expect(product.variants[0].inventoryQuantity).toBeNull();
    expect(product.variants[0].available).toBe(true);
  });

  it('normalises the status enum, defaulting anything unpublishable to draft', () => {
    const draft = toNormalizedProduct(
      productEdge('gid://p/2', { status: 'DRAFT' }).node,
      null,
    );
    expect(draft.status).toBe('draft');
    expect(
      toNormalizedProduct(productEdge('gid://p/3', { status: 'ARCHIVED' }).node, null)
        .status,
    ).toBe('archived');
    expect(
      toNormalizedProduct(productEdge('gid://p/4', { status: 'SOMETHING_NEW' }).node, null)
        .status,
    ).toBe('draft');
  });

  it('drops a non-https product image rather than handing Meta a bad link', () => {
    const node = productEdge('gid://p/5', {
      featuredImage: { url: 'http://cdn.shopify.com/air.jpg' },
    }).node;
    expect(toNormalizedProduct(node, null).imageUrl).toBeNull();
  });
});

describe('listShopifyCatalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the cursor until the last page and yields every product', async () => {
    stubGraphQL(
      {
        data: {
          shop: { currencyCode: 'USD' },
          products: {
            pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
            edges: [productEdge('gid://p/1')],
          },
        },
      },
      {
        data: {
          shop: { currencyCode: 'USD' },
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [productEdge('gid://p/2')],
          },
        },
      },
    );

    const ids: string[] = [];
    for await (const product of listShopifyCatalog(CTX)) ids.push(product.externalId);

    expect(ids).toEqual(['gid://p/1', 'gid://p/2']);
    const secondCall = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body,
    );
    expect(secondCall.variables.cursor).toBe('cursor-1');
  });

  it('refuses to query an invalid shop domain', async () => {
    const fetchMock = stubGraphQL({ data: {} });
    // Pulling the first page is enough — the guard runs before any request.
    await expect(
      listShopifyCatalog({ ...CTX, shopDomain: 'evil.com' }).next(),
    ).rejects.toThrow(/invalid Shopify shop domain/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a GraphQL-level error instead of yielding nothing silently', async () => {
    stubGraphQL({ errors: [{ message: 'Access denied for inventoryQuantity' }] });
    await expect(listShopifyCatalog(CTX).next()).rejects.toThrow(/Access denied/);
  });
});

describe('refreshShopifyInventory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns stock per variant and ignores nodes that resolved to nothing', async () => {
    stubGraphQL({
      data: {
        nodes: [
          { id: 'gid://v/1', inventoryQuantity: 2, availableForSale: true },
          null,
          { inventoryQuantity: 9 },
        ],
      },
    });

    const out = await refreshShopifyInventory({
      ...CTX,
      variantExternalIds: ['gid://v/1', 'gid://v/missing'],
    });

    expect(out).toEqual([
      { externalId: 'gid://v/1', inventoryQuantity: 2, available: true },
    ]);
  });

  it('does not call the API for an empty id list', async () => {
    const fetchMock = stubGraphQL({ data: { nodes: [] } });
    expect(await refreshShopifyInventory({ ...CTX, variantExternalIds: [] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('shopifyProvider catalog wiring', () => {
  it('exposes the catalog contract spec 003 requires', () => {
    expect(typeof shopifyProvider.capabilities).toBe('function');
    expect(typeof shopifyProvider.listCatalog).toBe('function');
    expect(typeof shopifyProvider.refreshInventory).toBe('function');
    expect([...shopifyProvider.capabilities(['read_products'])]).toEqual(['products']);
  });
});
