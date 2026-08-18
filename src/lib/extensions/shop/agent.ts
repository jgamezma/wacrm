// ============================================================
// Catalog → agent glue (SGC & IdeasLab fork).
//
// One entry point the three generation call sites (draft, auto-reply,
// playground) use, so "does the agent know the catalog?" is answered in exactly
// one place. Everything below it is provider-blind, and this function is
// best-effort: it returns `[]` rather than throwing, so a shop problem can never
// break a reply.
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.3
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { retrieveShopCatalog, type CatalogProduct } from './catalog';
import { refreshMatchedInventory } from './inventory';

export interface LoadShopCatalogOptions {
  /** `ai_configs.shop_catalog_enabled` — false short-circuits everything. */
  catalogEnabled: boolean;
  /** Account embeddings key, enabling semantic retrieval when present. */
  embeddingsApiKey: string | null;
  /** What the customer just asked (the latest user turn). */
  queryText: string;
  /**
   * Top up stock for the matched variants before returning. Only worth it on
   * the send path (auto-reply), and only possible with a client that can read
   * the connection row — the service-role client.
   */
  liveInventory?: boolean;
}

/**
 * Retrieve the catalog products relevant to this turn, or `[]` when the account
 * has catalog knowledge off, has no shop connected (the cache is cleared on
 * disconnect), or nothing matched.
 */
export async function loadShopCatalog(
  db: SupabaseClient,
  accountId: string,
  opts: LoadShopCatalogOptions,
): Promise<CatalogProduct[]> {
  if (!opts.catalogEnabled) return [];

  const products = await retrieveShopCatalog(db, accountId, {
    embeddingsApiKey: opts.embeddingsApiKey,
    queryText: opts.queryText,
  });
  if (products.length === 0) return [];

  return opts.liveInventory
    ? refreshMatchedInventory(db, accountId, products)
    : products;
}

/**
 * Resolve the ids the model cited in its `[[PRODUCTS]]` trailer against the set
 * we actually retrieved.
 *
 * This is the account-scoping guard for product cards: an id that wasn't in the
 * retrieved set — a hallucinated uuid, or another tenant's product — has nothing
 * to match and is silently dropped. No extra query, no way to reach a row the
 * agent wasn't shown.
 */
export function resolveCitedProducts(
  retrieved: CatalogProduct[],
  citedIds: string[],
): CatalogProduct[] {
  const byId = new Map(retrieved.map((product) => [product.id, product]));
  return citedIds
    .map((id) => byId.get(id))
    .filter((product): product is CatalogProduct => !!product);
}
