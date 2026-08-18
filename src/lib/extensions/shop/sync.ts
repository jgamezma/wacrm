// ============================================================
// Shop catalog pull-sync (SGC & IdeasLab fork).
//
// Generic orchestrator: it loads the account's connection, resolves the
// provider from the registry, and drives `ShopProvider.listCatalog` into the
// local cache. It contains NO provider-specific knowledge — swap Shopify for a
// future backend and this file does not change (the unit tests prove it by
// driving a fake provider).
//
// Replace semantics without a delete-then-insert window: every row written by
// one run is stamped with that run's `synced_at`, and rows still carrying an
// older stamp are deleted at the end. So a mid-sync failure leaves the previous
// catalog intact and searchable rather than half-erased.
//
// Writes need the service role — catalog tables have no INSERT/UPDATE policy
// (migration 9004), which is what keeps browser-supplied product rows
// impossible. Callers pass `shopAdminClient()`.
//
// Spec: docs/extensions/specs/003-shop-catalog-agent-knowledge.md §7.2
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { loadEmbeddingsKey } from '@/lib/ai/config';
import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings';
import { decrypt } from '@/lib/whatsapp/encryption';

import { getProvider } from './registry';
import type {
  CatalogReadContext,
  NormalizedProduct,
  ShopProvider,
} from './provider';

/** Products persisted per round-trip. Small enough that one failed batch is
 *  cheap to lose, large enough to keep a big catalog to few requests. */
const UPSERT_BATCH_SIZE = 25;

/** Cap on the denormalised retrieval blob per product. Bounds both the row size
 *  and what we hand the embeddings API. */
const SEARCH_TEXT_MAX_CHARS = 4000;

/** Outcome of one sync run — shaped for the `/catalog/sync` response. */
export interface CatalogSyncResult {
  ok: boolean;
  productCount: number;
  /** Whether this connection may read stock numbers at all. */
  inventory: boolean;
  /** Short, non-secret reason when `ok` is false. */
  error?: string;
}

interface ConnectionRow {
  provider: string;
  shop_domain: string | null;
  access_token: string;
  scopes: string[] | null;
}

/**
 * Denormalised text a product is retrieved by: everything a customer might name
 * — title, description, type, vendor, tags, and each variant's title + SKU.
 * Pure, so the retrieval blob is unit-testable without a DB.
 */
export function buildSearchText(product: NormalizedProduct): string {
  const parts: Array<string | null> = [
    product.title,
    product.description,
    product.productType,
    product.vendor,
    ...product.tags,
  ];
  for (const variant of product.variants) {
    parts.push(variant.title, variant.sku);
  }
  const text = parts
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join('\n')
    .replace(/\s+\n/g, '\n');
  return text.length > SEARCH_TEXT_MAX_CHARS
    ? text.slice(0, SEARCH_TEXT_MAX_CHARS)
    : text;
}

/**
 * Coerce a provider price onto something Postgres `numeric` accepts, or null.
 * A single odd value (a formatted string, an empty field) must not fail the
 * whole batch insert.
 */
export function toNumericString(price: string | null): string | null {
  if (!price) return null;
  const trimmed = price.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/** Persist one batch of products + their variants. Returns products written. */
async function persistBatch(
  db: SupabaseClient,
  args: {
    accountId: string;
    providerId: string;
    products: NormalizedProduct[];
    hasInventory: boolean;
    embeddingsKey: string | null;
    syncedAt: string;
  },
): Promise<number> {
  const { accountId, providerId, products, hasInventory, embeddingsKey, syncedAt } =
    args;
  if (products.length === 0) return 0;

  const searchTexts = products.map(buildSearchText);

  // Embed for semantic retrieval when the account has a key. A failure must not
  // stop the catalog from being stored — lexical FTS still works without
  // embeddings (same contract as knowledge-base ingest).
  let embeddings: number[][] | null = null;
  if (embeddingsKey) {
    try {
      embeddings = await embedTexts(embeddingsKey, searchTexts);
    } catch (err) {
      console.error(
        '[shop sync] embedding a batch failed; storing it lexical-only:',
        err,
      );
    }
  }

  const productRows = products.map((product, i) => ({
    account_id: accountId,
    provider: providerId,
    external_id: product.externalId,
    handle: product.handle,
    title: product.title,
    description: product.description,
    product_type: product.productType,
    vendor: product.vendor,
    tags: product.tags,
    status: product.status,
    image_url: product.imageUrl,
    search_text: searchTexts[i],
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
    synced_at: syncedAt,
  }));

  const { data: written, error: prodErr } = await db
    .from('shop_products')
    .upsert(productRows, { onConflict: 'account_id,provider,external_id' })
    .select('id, external_id');
  if (prodErr) throw prodErr;

  const idByExternal = new Map<string, string>();
  for (const row of (written ?? []) as Array<{ id: string; external_id: string }>) {
    idByExternal.set(row.external_id, row.id);
  }

  const variantRows = products.flatMap((product) => {
    const productId = idByExternal.get(product.externalId);
    if (!productId) return [];
    return product.variants.map((variant) => ({
      account_id: accountId,
      provider: providerId,
      product_id: productId,
      external_id: variant.externalId,
      title: variant.title,
      sku: variant.sku,
      price: toNumericString(variant.price),
      currency: variant.currency,
      // Never persist a stock number we were not granted access to, even if the
      // provider volunteered one (spec §7.2 step 4, US-2).
      inventory_quantity: hasInventory ? variant.inventoryQuantity : null,
      inventory_tracked: variant.inventoryTracked,
      available: variant.available,
      // Fall back to the product photo so the send path has one field to read.
      image_url: variant.imageUrl ?? product.imageUrl,
      synced_at: syncedAt,
    }));
  });

  if (variantRows.length > 0) {
    const { error: varErr } = await db
      .from('shop_product_variants')
      .upsert(variantRows, { onConflict: 'account_id,provider,external_id' });
    if (varErr) throw varErr;
  }

  return productRows.length;
}

/** Record why a sync failed so Settings can show it until it is fixed. */
async function recordSyncError(
  db: SupabaseClient,
  accountId: string,
  reason: string,
): Promise<void> {
  const { error } = await db
    .from('shop_connections')
    .update({ catalog_sync_error: reason.slice(0, 500) })
    .eq('account_id', accountId);
  if (error) console.error('[shop sync] could not record the sync error:', error);
}

/**
 * Pull the connected shop's catalog into the local cache.
 *
 * Owns its failures: it never throws, it returns `{ ok: false, error }` and
 * persists the reason on the connection row — a failed sync is an operator
 * problem to see in Settings, not an exception for the caller to render.
 *
 * @param db service-role client (catalog tables are server-write only)
 * @param accountId tenant whose connection is synced
 */
export async function syncShopCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogSyncResult> {
  let provider: ShopProvider | null = null;
  try {
    const { data, error } = await db
      .from('shop_connections')
      .select('provider, shop_domain, access_token, scopes')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return { ok: false, productCount: 0, inventory: false, error: 'not_connected' };
    }

    const connection = data as ConnectionRow;
    provider = getProvider(connection.provider);
    if (!provider) {
      const reason = `unknown provider "${connection.provider}"`;
      await recordSyncError(db, accountId, reason);
      return { ok: false, productCount: 0, inventory: false, error: reason };
    }

    const scopes = connection.scopes ?? [];
    const capabilities = provider.capabilities(scopes);
    const hasInventory = capabilities.has('inventory');
    if (!capabilities.has('products')) {
      // Nothing to read. Reconnecting with wider access is the fix (US-5), so
      // say so rather than retrying into 403s.
      const reason = 'missing_products_capability';
      await recordSyncError(db, accountId, reason);
      return { ok: false, productCount: 0, inventory: hasInventory, error: reason };
    }

    const ctx: CatalogReadContext = {
      accessToken: decrypt(connection.access_token),
      shopDomain: connection.shop_domain,
      scopes,
    };

    // Optional: embeddings are a nice-to-have here, so a corrupt key downgrades
    // the catalog to lexical search instead of failing the sync.
    const { key: embeddingsKey } = await loadEmbeddingsKey(db, accountId);

    const syncedAt = new Date().toISOString();
    let productCount = 0;
    let batch: NormalizedProduct[] = [];

    for await (const product of provider.listCatalog(ctx)) {
      batch.push(product);
      if (batch.length >= UPSERT_BATCH_SIZE) {
        productCount += await persistBatch(db, {
          accountId,
          providerId: provider.id,
          products: batch,
          hasInventory,
          embeddingsKey,
          syncedAt,
        });
        batch = [];
      }
    }
    if (batch.length > 0) {
      productCount += await persistBatch(db, {
        accountId,
        providerId: provider.id,
        products: batch,
        hasInventory,
        embeddingsKey,
        syncedAt,
      });
    }

    // Replace, don't accumulate: anything this run didn't touch is gone from the
    // shop. Products cascade to their variants; the second delete catches
    // variants that vanished from a product that still exists.
    const { error: delProdErr } = await db
      .from('shop_products')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', provider.id)
      .lt('synced_at', syncedAt);
    if (delProdErr) throw delProdErr;

    const { error: delVarErr } = await db
      .from('shop_product_variants')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', provider.id)
      .lt('synced_at', syncedAt);
    if (delVarErr) throw delVarErr;

    const { error: stampErr } = await db
      .from('shop_connections')
      .update({ catalog_synced_at: syncedAt, catalog_sync_error: null })
      .eq('account_id', accountId);
    if (stampErr) throw stampErr;

    return { ok: true, productCount, inventory: hasInventory };
  } catch (err) {
    // Tokens never reach here: providers put only status codes and their own
    // messages in `ShopProviderError`.
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[shop sync] failed:', reason);
    await recordSyncError(db, accountId, reason);
    return { ok: false, productCount: 0, inventory: false, error: reason };
  }
}

/**
 * Drop the account's cached catalog. Called on disconnect so a later connect —
 * same account, same or different provider — can never surface the previous
 * shop's products (spec §10). Variants cascade from products.
 *
 * Works with the caller's RLS client: migration 9004 grants admin+ DELETE.
 */
export async function clearShopCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { error } = await db.from('shop_products').delete().eq('account_id', accountId);
  if (error) throw error;
}
