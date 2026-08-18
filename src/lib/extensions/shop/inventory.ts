// ============================================================
// Live inventory refresh for retrieved products (SGC & IdeasLab fork).
//
// After retrieval and before the prompt is built, top up stock for the handful
// of variants that actually matched — not the catalog. That keeps inbound
// latency bounded (one small request) while avoiding the "we have 4" reply for
// something the shop sold out of an hour ago.
//
// Entirely optional, on three counts: the connection may lack the `inventory`
// capability, the provider may not implement `refreshInventory`, and the call
// may fail. Each case falls back to the cached quantities. Never throws.
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.4
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';

import type { CatalogProduct } from './catalog';
import { getProvider } from './registry';

/** Upper bound on variants asked about in one refresh. Retrieval returns ~5
 *  products; this only bites on products with very many variants. */
const MAX_VARIANTS_PER_REFRESH = 50;

interface ConnectionRow {
  provider: string;
  shop_domain: string | null;
  access_token: string;
  scopes: string[] | null;
}

/**
 * Return `products` with live stock where the provider could supply it.
 *
 * @param db a client that can read `shop_connections` — the service-role client
 *   on the auto-reply path. With an RLS client the row is admin-only, so
 *   non-admin callers simply get the cached quantities back unchanged.
 */
export async function refreshMatchedInventory(
  db: SupabaseClient,
  accountId: string,
  products: CatalogProduct[],
): Promise<CatalogProduct[]> {
  if (products.length === 0) return products;

  try {
    const { data, error } = await db
      .from('shop_connections')
      .select('provider, shop_domain, access_token, scopes')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !data) return products;

    const connection = data as ConnectionRow;
    const provider = getProvider(connection.provider);
    if (!provider?.refreshInventory) return products;

    const scopes = connection.scopes ?? [];
    if (!provider.capabilities(scopes).has('inventory')) return products;

    const externalIds = products
      .flatMap((product) => product.variants.map((variant) => variant.externalId))
      .filter(Boolean)
      .slice(0, MAX_VARIANTS_PER_REFRESH);
    if (externalIds.length === 0) return products;

    const fresh = await provider.refreshInventory({
      accessToken: decrypt(connection.access_token),
      shopDomain: connection.shop_domain,
      scopes,
      variantExternalIds: externalIds,
    });
    if (fresh.length === 0) return products;

    const byExternalId = new Map(fresh.map((row) => [row.externalId, row]));
    return products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => {
        const update = byExternalId.get(variant.externalId);
        if (!update) return variant;
        return {
          ...variant,
          inventoryQuantity: update.inventoryQuantity,
          // Keep the cached flag when the provider didn't say — dropping to
          // "unknown" would be less informative than the last known value.
          available: update.available ?? variant.available,
        };
      }),
    }));
  } catch (err) {
    console.error('[shop inventory] live refresh failed, using cached stock:', err);
    return products;
  }
}
