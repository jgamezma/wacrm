import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { decrypt } from '@/lib/whatsapp/encryption';
import {
  deleteConnection,
  getConnectionStatus,
  toStatusPayload,
  upsertConnection,
} from './connection';

// Keys that must NEVER appear in anything sent to the client.
const SECRET_KEYS = ['access_token', 'scopes'];

describe('toStatusPayload', () => {
  it('reports not-connected for a missing row and exposes no token fields', () => {
    const payload = toStatusPayload(null);
    expect(payload).toEqual({
      connected: false,
      provider: null,
      shop_domain: null,
      display_name: null,
      connected_at: null,
    });
    for (const k of SECRET_KEYS) expect(payload).not.toHaveProperty(k);
  });

  it('maps a row to safe fields only (incl. provider)', () => {
    const payload = toStatusPayload({
      provider: 'shopify',
      shop_domain: 'acme.myshopify.com',
      display_name: 'Acme',
      connected_at: '2026-07-16T00:00:00.000Z',
    });
    expect(payload).toEqual({
      connected: true,
      provider: 'shopify',
      shop_domain: 'acme.myshopify.com',
      display_name: 'Acme',
      connected_at: '2026-07-16T00:00:00.000Z',
    });
    for (const k of SECRET_KEYS) expect(payload).not.toHaveProperty(k);
  });
});

describe('getConnectionStatus', () => {
  it('selects only non-secret columns', async () => {
    const select = vi.fn().mockReturnValue({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    });
    const db = { from: () => ({ select }) } as unknown as SupabaseClient;
    await getConnectionStatus(db, 'acc-1');
    expect(select).toHaveBeenCalledWith(
      'provider, shop_domain, display_name, connected_at',
    );
  });
});

describe('upsertConnection', () => {
  it('encrypts the credential, records the provider, and keys on account_id', async () => {
    let captured: Record<string, unknown> | null = null;
    let onConflict: string | undefined;
    const db = {
      from: () => ({
        upsert: (payload: Record<string, unknown>, opts: { onConflict: string }) => {
          captured = payload;
          onConflict = opts.onConflict;
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;

    await upsertConnection(db, {
      accountId: 'acc-1',
      userId: 'user-1',
      provider: 'shopify',
      shopDomain: 'acme.myshopify.com',
      displayName: 'Acme',
      accessToken: 'TOKEN-PLAINTEXT',
      scopes: ['read_products'],
    });

    expect(captured).not.toBeNull();
    const row = captured as unknown as Record<string, string>;
    expect(onConflict).toBe('account_id');
    expect(row.provider).toBe('shopify');
    expect(row.shop_domain).toBe('acme.myshopify.com');

    // Ciphertext, not plaintext — but round-trips back to the original.
    expect(row.access_token).not.toBe('TOKEN-PLAINTEXT');
    expect(decrypt(row.access_token)).toBe('TOKEN-PLAINTEXT');
  });
});

describe('deleteConnection', () => {
  it('deletes the row scoped to the account', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq });
    const db = { from: () => ({ delete: del }) } as unknown as SupabaseClient;

    await deleteConnection(db, 'acc-1');
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('account_id', 'acc-1');
  });
});
