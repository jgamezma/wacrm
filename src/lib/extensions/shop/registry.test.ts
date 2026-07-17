import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getProvider,
  isAnyProviderConfigured,
  listConfiguredProviders,
} from './registry';

const SHOPIFY_ENV = {
  SHOPIFY_CLIENT_ID: 'key-abc',
  SHOPIFY_CLIENT_SECRET: 'secret-xyz',
  SHOPIFY_REDIRECT_URI: 'https://crm.example.com/api/extensions/shop/callback',
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getProvider', () => {
  it('resolves a known provider and returns null for unknown', () => {
    expect(getProvider('shopify')?.id).toBe('shopify');
    expect(getProvider('woocommerce')).toBeNull();
    expect(getProvider('')).toBeNull();
  });
});

describe('listConfiguredProviders / isAnyProviderConfigured', () => {
  it('reports nothing configured when env is empty', () => {
    expect(listConfiguredProviders()).toEqual([]);
    expect(isAnyProviderConfigured()).toBe(false);
  });

  it('includes Shopify (client-safe info only) once its env is set', () => {
    for (const [k, v] of Object.entries(SHOPIFY_ENV)) vi.stubEnv(k, v);
    const list = listConfiguredProviders();
    expect(list).toEqual([
      { id: 'shopify', label: 'Shopify', requiresShopDomain: true },
    ]);
    // No secret leaks into the descriptor.
    expect(JSON.stringify(list)).not.toContain('secret-xyz');
    expect(isAnyProviderConfigured()).toBe(true);
  });
});
