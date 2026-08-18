// ============================================================
// GET /api/extensions/shop/status — connection status (SGC & IdeasLab).
//
// Returns `{ connected, provider, shop_domain, display_name, connected_at,
// configured, providers }` plus the catalog fields spec 003 adds:
// `capabilities` (what this connection can actually read, derived by the
// provider from the stored scopes), `scopes`, `catalog_synced_at`,
// `catalog_sync_error`, and `product_count`. Never returns the token — the
// status fields come from the pure `toStatusPayload` mapper, which has no token
// field. RLS (admin+ SELECT) means non-admins simply see `connected: false`.
//
// Spec: docs/extensions/specs/002-shop-inventory-connect.md §7.2
//       docs/extensions/specs/003-shop-catalog-agent-knowledge.md §8, US-5
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getConnectionStatus } from '@/lib/extensions/shop/connection';
import {
  getProvider,
  isAnyProviderConfigured,
  listConfiguredProviders,
} from '@/lib/extensions/shop/registry';

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const status = await getConnectionStatus(supabase, accountId);

    // Capabilities, not scope names: the UI (and US-5's reconnect hint) asks
    // "can this connection read products / inventory?", and only the connected
    // provider can answer that from its own scope vocabulary.
    const provider = status.provider ? getProvider(status.provider) : null;
    const capabilities = provider
      ? Array.from(provider.capabilities(status.scopes))
      : [];

    // How much catalog is cached. Members can SELECT products, so this is a
    // cheap head-count under the caller's own client.
    const { count } = await supabase
      .from('shop_products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('status', 'active');

    return NextResponse.json({
      ...status,
      capabilities,
      product_count: count ?? 0,
      configured: isAnyProviderConfigured(),
      providers: listConfiguredProviders(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
