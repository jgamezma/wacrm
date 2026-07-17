import crypto from 'crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthorizeUrl,
  isValidShopDomain,
  normalizeShopDomain,
  shopifyProvider,
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
