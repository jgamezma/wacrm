import { describe, expect, it } from 'vitest';

import { resolveCallbackShopDomain } from './callback-shop';
import { shopifyProvider } from './providers/shopify';

const domainLess = {
  requiresShopDomain: false,
  normalizeShopDomain: () => null,
};

describe('resolveCallbackShopDomain', () => {
  it('keeps the domain when the callback echoes what we started with', () => {
    const result = resolveCallbackShopDomain(
      shopifyProvider,
      'mitienda.myshopify.com',
      'mitienda.myshopify.com',
    );
    expect(result).toEqual({
      ok: true,
      shopDomain: 'mitienda.myshopify.com',
      canonicalized: false,
    });
  });

  it("adopts the provider's canonical domain when it differs from the typed one", () => {
    // Real case: a dev store named "otraprueba-2" answers as 1f3m3k-vt.
    const result = resolveCallbackShopDomain(
      shopifyProvider,
      '1f3m3k-vt.myshopify.com',
      'otraprueba-2.myshopify.com',
    );
    expect(result).toEqual({
      ok: true,
      shopDomain: '1f3m3k-vt.myshopify.com',
      canonicalized: true,
    });
  });

  it('normalizes the callback value before trusting it', () => {
    const result = resolveCallbackShopDomain(
      shopifyProvider,
      'HTTPS://Mitienda.myshopify.com/admin',
      'mitienda.myshopify.com',
    );
    expect(result).toEqual({
      ok: true,
      shopDomain: 'mitienda.myshopify.com',
      canonicalized: false,
    });
  });

  it('rejects a domain that is not a valid host for the provider', () => {
    for (const bad of ['', 'evil.com', 'mitienda.myshopify.com.evil.com', '../x']) {
      expect(resolveCallbackShopDomain(shopifyProvider, bad, 'mitienda.myshopify.com')).toEqual(
        { ok: false },
      );
    }
  });

  it('passes the stored value through for domain-less providers', () => {
    expect(resolveCallbackShopDomain(domainLess, 'anything', null)).toEqual({
      ok: true,
      shopDomain: null,
      canonicalized: false,
    });
  });
});
